/**
 * Secrets Generation Wrapper
 *
 * Wraps the existing generate-secrets.sh script for API access.
 * Provides JSON output for the installer wizard.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);

/**
 * Generates cryptographically secure secrets
 * @param {string} workspacePath - Path to the platform workspace
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generation result with secrets
 */
export async function generateSecrets(workspacePath, options = {}) {
  const {
    mode = 'dev', // dev, staging, production
    generateAll = true,
    preserveOAuth = true,
  } = options;

  const scriptsDir = path.join(workspacePath, 'scripts');
  const configDir = path.join(workspacePath, 'config');
  const secretsFile = path.join(configDir, `secrets.${mode}.env`);

  // Check if generate-secrets.sh exists
  const scriptPath = path.join(scriptsDir, 'generate-secrets.sh');
  try {
    await fs.access(scriptPath);
  } catch {
    // Script doesn't exist, generate secrets directly
    return generateSecretsDirectly(secretsFile, options);
  }

  // Build command arguments
  let args = [];
  if (!generateAll) {
    args.push('--missing-only');
  }
  if (!preserveOAuth) {
    args.push('--force');
  }

  try {
    // Run the script with JSON output if supported
    const { stdout, stderr } = await execAsync(
      `cd "${workspacePath}" && bash "${scriptPath}" ${args.join(' ')} --json-output 2>&1 || true`
    );

    // Parse JSON output if available
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    // Fall back to direct generation if script doesn't support JSON
    return generateSecretsDirectly(secretsFile, options);
  } catch (error) {
    // Fall back to direct generation on error
    console.error('Script execution failed, using direct generation:', error.message);
    return generateSecretsDirectly(secretsFile, options);
  }
}

/**
 * Generates secrets directly without using the shell script
 * @param {string} outputPath - Path to write secrets file
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated secrets
 */
async function generateSecretsDirectly(outputPath, options = {}) {
  const secrets = {
    // Core security secrets
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: crypto.randomBytes(64).toString('hex'),
    JWT_KEY_ID: crypto.randomBytes(8).toString('hex'),

    // Database passwords
    POSTGRES_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_AUTH_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_USERS_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_CALENDAR_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_MEETINGS_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_TRANSCRIPTS_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_NOTES_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_SUMMARIES_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_ADMIN_SERVICE_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_ACTIONS_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_PORTAL_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_SUPPORT_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),
    POSTGRES_EMAIL_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),

    // Redis password
    REDIS_PASSWORD: crypto.randomBytes(30).toString('base64').substring(0, 40),

    // Webhook secrets
    ACS_JOINER_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    TEAMS_ACS_CALLBACK_SECRET: crypto.randomBytes(32).toString('hex'),
    TEAMS_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),

    // Service API keys
    GATEWAY_SERVICE_API_KEY: crypto.randomBytes(32).toString('hex'),
    INTERNAL_API_KEY: crypto.randomBytes(32).toString('hex'),

    // CrowdSec keys
    CROWDSEC_API_KEY: crypto.randomBytes(32).toString('hex'),
    CROWDSEC_BOUNCER_API_KEY: crypto.randomBytes(32).toString('hex'),
  };

  // Generate RSA key pair for JWT
  const { privateKey, publicKey } = await generateRSAKeyPair();
  secrets.JWT_PRIVATE_KEY = escapeForEnv(privateKey);
  secrets.JWT_PUBLIC_KEY = escapeForEnv(publicKey);

  // Merge with custom OAuth if provided
  if (options.oauth) {
    if (options.oauth.microsoft) {
      secrets.MICROSOFT_CLIENT_ID = options.oauth.microsoft.clientId || '';
      secrets.MICROSOFT_CLIENT_SECRET = options.oauth.microsoft.clientSecret || '';
      secrets.MICROSOFT_TENANT = options.oauth.microsoft.tenant || 'common';
    }
    if (options.oauth.google) {
      secrets.GOOGLE_CLIENT_ID = options.oauth.google.clientId || '';
      secrets.GOOGLE_CLIENT_SECRET = options.oauth.google.clientSecret || '';
    }
  }

  // Write secrets file
  await writeSecretsFile(outputPath, secrets, options.mode || 'dev');

  return {
    success: true,
    path: outputPath,
    generated: Object.keys(secrets).length,
    message: 'Secrets generated successfully',
  };
}

/**
 * Generates RSA key pair for JWT signing
 * @returns {Promise<{privateKey: string, publicKey: string}>}
 */
async function generateRSAKeyPair() {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      'rsa',
      {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      },
      (err, publicKey, privateKey) => {
        if (err) reject(err);
        else resolve({ privateKey, publicKey });
      }
    );
  });
}

/**
 * Escapes multiline strings for .env files
 * @param {string} value - String to escape
 * @returns {string} Escaped string
 */
function escapeForEnv(value) {
  return value.replace(/\n/g, '\\n').replace(/\r/g, '');
}

/**
 * Writes secrets to a .env file
 * @param {string} filePath - Output file path
 * @param {Object} secrets - Secrets object
 * @param {string} mode - Deployment mode
 */
async function writeSecretsFile(filePath, secrets, mode) {
  const timestamp = new Date().toISOString();
  let content = `# Notely Platform Secrets - AUTO-GENERATED
# Generated: ${timestamp}
# Mode: ${mode}
#
# NEVER commit this file to version control!

`;

  for (const [key, value] of Object.entries(secrets)) {
    content += `${key}=${value}\n`;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { mode: 0o600 });
}

/**
 * Validates existing secrets file
 * @param {string} secretsPath - Path to secrets file
 * @returns {Promise<Object>} Validation result
 */
export async function validateSecrets(secretsPath) {
  try {
    const content = await fs.readFile(secretsPath, 'utf-8');
    const lines = content.split('\n');

    const secrets = {};
    const issues = [];

    for (const line of lines) {
      if (line.startsWith('#') || !line.includes('=')) continue;

      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=');
      secrets[key] = value;

      // Check for placeholder values
      if (value.includes('your_') || value.includes('placeholder')) {
        issues.push({ key, issue: 'Contains placeholder value' });
      }

      // Check minimum lengths for security secrets
      if (key === 'JWT_SECRET' && value.length < 64) {
        issues.push({ key, issue: `Too short (${value.length} chars, need 64+)` });
      }
      if (key === 'ENCRYPTION_KEY' && value.length < 128) {
        issues.push({ key, issue: `Too short (${value.length} chars, need 128+)` });
      }
    }

    return {
      valid: issues.length === 0,
      secretCount: Object.keys(secrets).length,
      issues,
      secrets: Object.keys(secrets),
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      exists: false,
    };
  }
}

export default { generateSecrets, validateSecrets };
