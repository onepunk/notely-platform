/**
 * Domain Configuration Wrapper
 *
 * Wraps the existing configure-domains.sh script for API access.
 * Generates platform configuration files.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Generates platform configuration
 * @param {string} workspacePath - Path to the platform workspace
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Configuration result
 */
export async function generateConfiguration(workspacePath, options) {
  const {
    baseDomain,
    deploymentMode = 'production', // dev, staging, production
    apply = false,
    skipRestart = true,
  } = options;

  if (!baseDomain) {
    return {
      success: false,
      error: 'baseDomain is required',
    };
  }

  const scriptPath = path.join(workspacePath, 'scripts', 'configure-domains.sh');

  // Check if script exists
  try {
    await fs.access(scriptPath);
  } catch {
    return {
      success: false,
      error: 'configure-domains.sh not found',
      path: scriptPath,
    };
  }

  // Build command
  const args = [
    `--base-domain ${baseDomain}`,
    `--${deploymentMode}`,
  ];

  if (apply) {
    args.push('--apply');
  }
  if (skipRestart) {
    args.push('--skip-restart');
  }

  try {
    const command = `cd "${workspacePath}" && bash "${scriptPath}" ${args.join(' ')} 2>&1`;
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000, // 1 minute timeout
      env: { ...process.env, NOTELY_CONFIG_ENV: deploymentMode },
    });

    // Parse output for configuration summary
    const config = parseConfigOutput(stdout);

    return {
      success: true,
      baseDomain,
      deploymentMode,
      domains: {
        api: `api.${baseDomain}`,
        portal: `portal.${baseDomain}`,
        calendar: `calendar.${baseDomain}`,
        ws: `ws.${baseDomain}`,
        get: `get.${baseDomain}`,
      },
      output: stdout,
      config,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr,
    };
  }
}

/**
 * Parses the configure-domains.sh output for configuration values
 * @param {string} output - Script output
 * @returns {Object} Parsed configuration
 */
function parseConfigOutput(output) {
  const config = {};

  // Extract port information
  const httpsPortMatch = output.match(/HTTPS:\s*(\d+)/);
  const httpPortMatch = output.match(/HTTP:\s*(\d+)/);

  if (httpsPortMatch) config.httpsPort = parseInt(httpsPortMatch[1], 10);
  if (httpPortMatch) config.httpPort = parseInt(httpPortMatch[1], 10);

  // Extract domain information
  const domainPatterns = {
    api: /API:\s*([^\s]+)/,
    portal: /Portal:\s*([^\s]+)/,
    calendar: /Calendar:\s*([^\s]+)/,
    ws: /WebSocket:\s*([^\s]+)/,
    downloads: /Downloads:\s*([^\s]+)/,
  };

  for (const [key, pattern] of Object.entries(domainPatterns)) {
    const match = output.match(pattern);
    if (match) config[`${key}Domain`] = match[1];
  }

  return config;
}

/**
 * Validates domain configuration
 * @param {string} baseDomain - Domain to validate
 * @returns {Object} Validation result
 */
export function validateDomain(baseDomain) {
  const issues = [];

  // Basic domain format validation
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

  if (!baseDomain) {
    issues.push('Domain is required');
  } else if (!domainRegex.test(baseDomain)) {
    issues.push('Invalid domain format');
  }

  // Check for common issues
  if (baseDomain?.includes('localhost')) {
    issues.push('localhost is not valid for production');
  }
  if (baseDomain?.includes('_')) {
    issues.push('Underscores are not allowed in domain names');
  }
  if (baseDomain?.startsWith('-') || baseDomain?.endsWith('-')) {
    issues.push('Domain cannot start or end with a hyphen');
  }

  return {
    valid: issues.length === 0,
    domain: baseDomain,
    issues,
    subdomains: issues.length === 0 ? [
      `api.${baseDomain}`,
      `portal.${baseDomain}`,
      `calendar.${baseDomain}`,
      `ws.${baseDomain}`,
      `get.${baseDomain}`,
    ] : [],
  };
}

/**
 * Gets current configuration from .env file
 * @param {string} workspacePath - Path to workspace
 * @returns {Promise<Object>} Current configuration
 */
export async function getCurrentConfig(workspacePath) {
  const envPath = path.join(workspacePath, '.env');

  try {
    const content = await fs.readFile(envPath, 'utf-8');
    const config = {};

    for (const line of content.split('\n')) {
      if (line.startsWith('#') || !line.includes('=')) continue;
      const [key, ...valueParts] = line.split('=');
      config[key] = valueParts.join('=');
    }

    return {
      exists: true,
      config,
    };
  } catch (error) {
    return {
      exists: false,
      error: error.message,
    };
  }
}

export default {
  generateConfiguration,
  validateDomain,
  getCurrentConfig,
};
