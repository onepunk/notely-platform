/**
 * Wizard Step Routes
 *
 * Handles each of the 9 installation wizard steps.
 */

import { Router } from 'express';
import { checkPrerequisites, startPlatform, getContainerStatus } from '../lib/docker.js';
import { validateDomain, generateConfiguration, getCurrentConfig } from '../lib/config.js';
import { generateSecrets, validateSecrets } from '../lib/secrets.js';
import { generateDomainCertificates, validateCertificate, installUserCertificates } from '../lib/ssl-generator.js';
import { cancelInactivityTimer } from '../lib/shutdown.js';
import path from 'path';
import fs from 'fs/promises';

const router = Router();
const workspacePath = process.env.WORKSPACE_PATH || '/workspace';

/**
 * Step 1: Prerequisites Check
 * Validates Docker, disk space, memory, and port availability
 */
router.get('/step/1/prerequisites', async (req, res) => {
  try {
    const result = await checkPrerequisites();

    res.json({
      step: 1,
      name: 'Prerequisites',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 2: Deployment Mode Selection
 * Returns available deployment modes and their configurations
 */
router.get('/step/2/deployment-modes', async (req, res) => {
  res.json({
    step: 2,
    name: 'Deployment Mode',
    modes: [
      {
        id: 'production',
        name: 'Production',
        description: 'Standard HTTPS ports (443/80), optimized for production',
        ports: { https: 443, http: 80 },
        recommended: true,
      },
      {
        id: 'staging',
        name: 'Staging',
        description: 'Non-standard ports (9443/9080) for staging environments',
        ports: { https: 9443, http: 9080 },
      },
      {
        id: 'dev',
        name: 'Development',
        description: 'Non-standard ports (8443/8081) for development',
        ports: { https: 8443, http: 8081 },
      },
    ],
  });
});

router.post('/step/2/deployment-mode', async (req, res) => {
  const { mode } = req.body;

  if (!['production', 'staging', 'dev'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid deployment mode' });
  }

  // Store in installation state
  req.app.locals.installationState = {
    ...req.app.locals.installationState,
    deploymentMode: mode,
    completedSteps: [...(req.app.locals.installationState?.completedSteps || []), 2],
  };

  res.json({
    success: true,
    mode,
    message: `Deployment mode set to ${mode}`,
  });
});

/**
 * Step 3: Domain Configuration
 * Validates and configures the base domain
 */
router.post('/step/3/validate-domain', async (req, res) => {
  const { baseDomain } = req.body;

  const validation = validateDomain(baseDomain);
  res.json({
    step: 3,
    name: 'Domain Configuration',
    ...validation,
  });
});

router.post('/step/3/configure-domain', async (req, res) => {
  const { baseDomain } = req.body;
  const deploymentMode = req.app.locals.installationState?.deploymentMode || 'production';

  try {
    const result = await generateConfiguration(workspacePath, {
      baseDomain,
      deploymentMode,
      apply: true,
      skipRestart: true,
    });

    if (result.success) {
      req.app.locals.installationState = {
        ...req.app.locals.installationState,
        baseDomain,
        domains: result.domains,
        completedSteps: [...(req.app.locals.installationState?.completedSteps || []), 3],
      };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 4: SSL Certificates
 * Options: self-signed, bring-your-own, or (future) Let's Encrypt
 */
router.get('/step/4/ssl-options', async (req, res) => {
  res.json({
    step: 4,
    name: 'SSL Certificates',
    options: [
      {
        id: 'self-signed',
        name: 'Generate Self-Signed',
        description: 'Auto-generate certificates for initial setup. Replace with real certificates later.',
        recommended: true,
      },
      {
        id: 'bring-your-own',
        name: 'Upload Certificates',
        description: 'Upload your own SSL certificate and private key files.',
      },
      {
        id: 'skip',
        name: 'Skip (Configure Later)',
        description: 'Skip SSL configuration. Platform will start without HTTPS.',
      },
    ],
  });
});

router.post('/step/4/generate-ssl', async (req, res) => {
  const baseDomain = req.app.locals.installationState?.baseDomain;

  if (!baseDomain) {
    return res.status(400).json({ error: 'Base domain not configured. Complete step 3 first.' });
  }

  try {
    const sslDir = path.join(workspacePath, 'services', 'nginx', 'ssl', 'certs');
    const result = await generateDomainCertificates(baseDomain, path.dirname(sslDir));

    if (result.success) {
      req.app.locals.installationState = {
        ...req.app.locals.installationState,
        sslMethod: 'self-signed',
        completedSteps: [...(req.app.locals.installationState?.completedSteps || []), 4],
      };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/step/4/upload-ssl', async (req, res) => {
  const { certificate, privateKey } = req.body;

  if (!certificate || !privateKey) {
    return res.status(400).json({ error: 'Both certificate and privateKey are required' });
  }

  try {
    const sslDir = path.join(workspacePath, 'services', 'nginx', 'ssl');
    const result = await installUserCertificates(
      Buffer.from(privateKey),
      Buffer.from(certificate),
      sslDir
    );

    if (result.success) {
      req.app.locals.installationState = {
        ...req.app.locals.installationState,
        sslMethod: 'bring-your-own',
        completedSteps: [...(req.app.locals.installationState?.completedSteps || []), 4],
      };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 5: Database & Redis Configuration
 * Generates secure passwords or accepts custom credentials
 */
router.post('/step/5/generate-secrets', async (req, res) => {
  const { customPasswords = {} } = req.body;
  const deploymentMode = req.app.locals.installationState?.deploymentMode || 'production';

  try {
    const result = await generateSecrets(workspacePath, {
      mode: deploymentMode,
      generateAll: true,
      ...customPasswords,
    });

    if (result.success) {
      req.app.locals.installationState = {
        ...req.app.locals.installationState,
        secretsGenerated: true,
        completedSteps: [...(req.app.locals.installationState?.completedSteps || []), 5],
      };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/step/5/validate-secrets', async (req, res) => {
  const deploymentMode = req.app.locals.installationState?.deploymentMode || 'production';
  const secretsPath = path.join(workspacePath, 'config', `secrets.${deploymentMode}.env`);

  try {
    const result = await validateSecrets(secretsPath);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 6: OAuth Configuration
 * Microsoft and Google OAuth credentials (optional)
 */
router.get('/step/6/oauth-requirements', async (req, res) => {
  const baseDomain = req.app.locals.installationState?.baseDomain;
  const deploymentMode = req.app.locals.installationState?.deploymentMode || 'production';

  // Determine port suffix
  let portSuffix = '';
  if (deploymentMode === 'dev') portSuffix = ':8443';
  if (deploymentMode === 'staging') portSuffix = ':9443';

  res.json({
    step: 6,
    name: 'OAuth Configuration',
    providers: [
      {
        id: 'microsoft',
        name: 'Microsoft (Azure AD)',
        required: false,
        redirectUris: baseDomain ? [
          `https://api.${baseDomain}${portSuffix}/api/auth/microsoft/callback`,
          `https://api.${baseDomain}${portSuffix}/api/outlook/callback`,
          `https://api.${baseDomain}${portSuffix}/api/calendar/microsoft/callback`,
        ] : [],
        instructions: 'Register an app in Azure Portal > Azure Active Directory > App registrations',
      },
      {
        id: 'google',
        name: 'Google',
        required: false,
        redirectUris: baseDomain ? [
          `https://api.${baseDomain}${portSuffix}/api/auth/google/callback`,
          `https://api.${baseDomain}${portSuffix}/api/calendar/google/callback`,
        ] : [],
        instructions: 'Create credentials in Google Cloud Console > APIs & Services > Credentials',
      },
    ],
  });
});

router.post('/step/6/configure-oauth', async (req, res) => {
  const { microsoft, google } = req.body;
  const deploymentMode = req.app.locals.installationState?.deploymentMode || 'production';
  const secretsPath = path.join(workspacePath, 'config', `secrets.${deploymentMode}.env`);

  try {
    // Read existing secrets
    let content = '';
    try {
      content = await fs.readFile(secretsPath, 'utf-8');
    } catch {
      return res.status(400).json({ error: 'Secrets file not found. Complete step 5 first.' });
    }

    // Update OAuth values
    const updates = {};
    if (microsoft) {
      if (microsoft.clientId) updates.MICROSOFT_CLIENT_ID = microsoft.clientId;
      if (microsoft.clientSecret) updates.MICROSOFT_CLIENT_SECRET = microsoft.clientSecret;
      if (microsoft.tenant) updates.MICROSOFT_TENANT = microsoft.tenant;
    }
    if (google) {
      if (google.clientId) updates.GOOGLE_CLIENT_ID = google.clientId;
      if (google.clientSecret) updates.GOOGLE_CLIENT_SECRET = google.clientSecret;
    }

    // Apply updates to secrets file
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (content.match(regex)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
    }

    await fs.writeFile(secretsPath, content, { mode: 0o600 });

    req.app.locals.installationState = {
      ...req.app.locals.installationState,
      oauthConfigured: true,
      completedSteps: [...(req.app.locals.installationState?.completedSteps || []), 6],
    };

    res.json({
      success: true,
      configured: Object.keys(updates),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 7: Admin Account
 * Create initial admin user credentials
 */
router.post('/step/7/admin-account', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate password strength
  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }

  // Store admin credentials (will be used during first startup)
  req.app.locals.installationState = {
    ...req.app.locals.installationState,
    adminEmail: email,
    adminPasswordSet: true,
    completedSteps: [...(req.app.locals.installationState?.completedSteps || []), 7],
  };

  // Write admin setup file
  const adminSetupPath = path.join(workspacePath, 'config', 'admin-setup.json');
  try {
    await fs.writeFile(
      adminSetupPath,
      JSON.stringify({ email, passwordHash: `pending:${Buffer.from(password).toString('base64')}` }),
      { mode: 0o600 }
    );

    res.json({
      success: true,
      email,
      message: 'Admin account configured',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 8: Review & Deploy
 * Shows configuration summary and starts deployment
 */
router.get('/step/8/summary', async (req, res) => {
  const state = req.app.locals.installationState || {};

  res.json({
    step: 8,
    name: 'Review & Deploy',
    configuration: {
      deploymentMode: state.deploymentMode,
      baseDomain: state.baseDomain,
      domains: state.domains,
      sslMethod: state.sslMethod,
      secretsGenerated: state.secretsGenerated,
      oauthConfigured: state.oauthConfigured,
      adminEmail: state.adminEmail,
    },
    completedSteps: state.completedSteps || [],
    readyToDeploy:
      state.deploymentMode &&
      state.baseDomain &&
      state.secretsGenerated,
  });
});

router.post('/step/8/deploy', async (req, res) => {
  const state = req.app.locals.installationState || {};

  if (!state.deploymentMode || !state.baseDomain || !state.secretsGenerated) {
    return res.status(400).json({
      error: 'Prerequisites not met',
      required: ['deploymentMode', 'baseDomain', 'secretsGenerated'],
    });
  }

  try {
    // Regenerate configuration with apply
    await generateConfiguration(workspacePath, {
      baseDomain: state.baseDomain,
      deploymentMode: state.deploymentMode,
      apply: true,
      skipRestart: false,
    });

    // Start the platform
    const result = await startPlatform(workspacePath, {
      deploymentMode: state.deploymentMode,
      build: true,
      detach: true,
    });

    if (result.success) {
      req.app.locals.installationState = {
        ...req.app.locals.installationState,
        deployed: true,
        deployedAt: new Date().toISOString(),
        completedSteps: [...(state.completedSteps || []), 8],
      };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 9: Complete
 * Shows completion status and shuts down installer
 */
router.get('/step/9/status', async (req, res) => {
  const state = req.app.locals.installationState || {};

  // Check container status
  let containerStatus;
  try {
    containerStatus = await getContainerStatus(workspacePath);
  } catch {
    containerStatus = { error: 'Unable to check container status' };
  }

  // Determine port suffix for URLs
  let portSuffix = '';
  if (state.deploymentMode === 'dev') portSuffix = ':8443';
  if (state.deploymentMode === 'staging') portSuffix = ':9443';

  res.json({
    step: 9,
    name: 'Installation Complete',
    success: state.deployed,
    deployedAt: state.deployedAt,
    urls: state.baseDomain ? {
      portal: `https://portal.${state.baseDomain}${portSuffix}`,
      api: `https://api.${state.baseDomain}${portSuffix}`,
      documentation: `https://docs.${state.baseDomain}${portSuffix}`,
    } : {},
    containerStatus,
    adminEmail: state.adminEmail,
  });
});

router.post('/step/9/shutdown-installer', async (req, res) => {
  const state = req.app.locals.installationState || {};

  if (!state.deployed) {
    return res.status(400).json({
      error: 'Platform not deployed. Complete deployment first.',
    });
  }

  // Cancel inactivity timer
  cancelInactivityTimer();

  res.json({
    success: true,
    message: 'Installer will shut down in 5 seconds',
  });

  // Shutdown after short delay
  setTimeout(() => {
    console.log('Installation complete. Shutting down installer...');
    process.exit(0);
  }, 5000);
});

export default router;
