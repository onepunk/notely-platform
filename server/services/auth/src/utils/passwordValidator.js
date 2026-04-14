/**
 * Password Validation Utility
 *
 * Validates passwords against configurable complexity requirements.
 * Fetches requirements from admin-config service.
 */

const shared = require('@notely/shared');
const logger = shared.logger;

// Default password requirements (fallback if admin-config unavailable)
const DEFAULT_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true
};

// Cache for security config
let securityConfigCache = null;
let securityConfigCacheTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Fetch security config from admin-config service
 */
async function fetchSecurityConfig() {
  const now = Date.now();

  // Return cached config if still valid
  if (securityConfigCache && (now - securityConfigCacheTime) < CACHE_TTL_MS) {
    return securityConfigCache;
  }

  try {
    const adminConfigUrl = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3210';
    const response = await fetch(`${adminConfigUrl}/api/admin/config/security`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Internal service call - use service key if available
        'x-service-key': process.env.INTERNAL_SERVICE_KEY || ''
      },
      timeout: 5000
    });

    if (response.ok) {
      const data = await response.json();
      securityConfigCache = data;
      securityConfigCacheTime = now;
      return data;
    }
  } catch (error) {
    logger.warn('Failed to fetch security config, using defaults', { error: error.message });
  }

  return null;
}

/**
 * Get password complexity requirements
 */
async function getPasswordRequirements() {
  const config = await fetchSecurityConfig();
  return config?.passwordComplexity || DEFAULT_REQUIREMENTS;
}

/**
 * Validate a password against complexity requirements
 * @param {string} password - The password to validate
 * @param {object} requirements - Optional override for requirements
 * @returns {object} - { valid: boolean, errors: string[], checks: object }
 */
function validatePassword(password, requirements = DEFAULT_REQUIREMENTS) {
  const errors = [];
  const checks = {
    minLength: { required: requirements.minLength, met: false, label: `At least ${requirements.minLength} characters` },
    uppercase: { required: requirements.requireUppercase, met: false, label: 'One uppercase letter (A-Z)' },
    lowercase: { required: requirements.requireLowercase, met: false, label: 'One lowercase letter (a-z)' },
    number: { required: requirements.requireNumbers, met: false, label: 'One number (0-9)' },
    special: { required: requirements.requireSpecialChars, met: false, label: 'One special character (!@#$%^&*...)' }
  };

  // Check minimum length
  if (password && password.length >= requirements.minLength) {
    checks.minLength.met = true;
  } else if (requirements.minLength > 0) {
    errors.push(`Password must be at least ${requirements.minLength} characters`);
  }

  // Check uppercase
  if (/[A-Z]/.test(password)) {
    checks.uppercase.met = true;
  } else if (requirements.requireUppercase) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Check lowercase
  if (/[a-z]/.test(password)) {
    checks.lowercase.met = true;
  } else if (requirements.requireLowercase) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Check numbers
  if (/[0-9]/.test(password)) {
    checks.number.met = true;
  } else if (requirements.requireNumbers) {
    errors.push('Password must contain at least one number');
  }

  // Check special characters
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    checks.special.met = true;
  } else if (requirements.requireSpecialChars) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
    checks
  };
}

/**
 * Validate password asynchronously with fetched requirements
 * @param {string} password - The password to validate
 * @returns {Promise<object>} - { valid: boolean, errors: string[], checks: object }
 */
async function validatePasswordAsync(password) {
  const requirements = await getPasswordRequirements();
  return validatePassword(password, requirements);
}

/**
 * Clear the security config cache (useful for testing or after config updates)
 */
function clearCache() {
  securityConfigCache = null;
  securityConfigCacheTime = 0;
}

module.exports = {
  validatePassword,
  validatePasswordAsync,
  getPasswordRequirements,
  clearCache,
  DEFAULT_REQUIREMENTS
};
