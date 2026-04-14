const shared = require('@notely/shared');

const logger = shared.logger.child({ module: 'auth-signup-policy' });

// CRITICAL: ADMIN_CONFIG_SERVICE_URL must be set - no fallbacks allowed
if (!process.env.ADMIN_CONFIG_SERVICE_URL) {
  logger.error('ADMIN_CONFIG_SERVICE_URL not configured in environment');
  throw new Error('ADMIN_CONFIG_SERVICE_URL environment variable is required');
}

const httpClient = shared.httpClient.createClient({
  baseURL: process.env.ADMIN_CONFIG_SERVICE_URL,
  timeout: parseInt(process.env.ADMIN_CONFIG_FETCH_TIMEOUT_MS || '3000', 10),
  retry: 1,
  retryNonIdempotent: false
});

const CACHE_TTL_MS = parseInt(process.env.ADMIN_CONFIG_CACHE_TTL_MS || '15000', 10);

let cachedConfig = null;
let cacheExpiresAt = 0;

const SIGNUP_POLICY_PATH = '/api/public/config/signup-policy';

async function fetchSignupPolicy(force = false) {
  const now = Date.now();

  if (!force && cachedConfig && now < cacheExpiresAt) {
    return cachedConfig;
  }

  try {
    const response = await httpClient.get(SIGNUP_POLICY_PATH, {
      headers: {
        'X-Service-Name': process.env.SERVICE_NAME || 'auth'
      },
      // These endpoints are idempotent - allow retries on 5xx
      retry: 2,
      retryNonIdempotent: true
    });

    if (response.status !== 200 || typeof response.data !== 'object' || response.data === null) {
      throw new Error(`Unexpected public signup policy response status: ${response.status}`);
    }

    cachedConfig = {
      signupsEnabled:
        typeof response.data.signupsEnabled === 'boolean' ? response.data.signupsEnabled : false,
      requireBetaToken:
        typeof response.data.requireBetaToken === 'boolean' ? response.data.requireBetaToken : true,
      requireEmailVerification:
        typeof response.data.requireEmailVerification === 'boolean'
          ? response.data.requireEmailVerification
          : false
    };
    cacheExpiresAt = now + CACHE_TTL_MS;

    return cachedConfig;
  } catch (error) {
    logger.error('Failed to fetch public signup policy', {
      error: error.message
    });

    if (cachedConfig) {
      logger.warn('Using stale signup policy cache due to fetch failure');
      return cachedConfig;
    }

    throw new shared.errors.AppError('Failed to load signup policy - registration denied', 503);
  }
}

async function ensureSignupsEnabled({ context } = {}) {
  const signupPolicy = await fetchSignupPolicy();

  if (signupPolicy && Object.prototype.hasOwnProperty.call(signupPolicy, 'signupsEnabled')) {
    if (!signupPolicy.signupsEnabled) {
      logger.info('Sign-ups disabled via admin configuration', context || {});
      throw new shared.errors.ForbiddenError('Sign-ups are currently disabled');
    }
  }

  return true;
}

/**
 * Check if signups are enabled (non-throwing)
 * @returns {Promise<boolean>} True if signups are enabled
 */
async function areSignupsEnabled() {
  const signupPolicy = await fetchSignupPolicy();

  if (signupPolicy && Object.prototype.hasOwnProperty.call(signupPolicy, 'signupsEnabled')) {
    return signupPolicy.signupsEnabled;
  }

  return true;  // Default to enabled if config unavailable
}

async function isBetaTokenRequired() {
  const policy = await fetchSignupPolicy();
  return policy.requireBetaToken === true;
}

module.exports = {
  ensureSignupsEnabled,
  areSignupsEnabled,
  isBetaTokenRequired,
  refresh: () => fetchSignupPolicy(true),
  getCachedConfig: () => cachedConfig
};
