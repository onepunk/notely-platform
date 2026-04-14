/**
 * OAuth2 Utilities
 *
 * Helper functions for OAuth2 flow including state generation,
 * redirect validation, and exchange codes.
 */

const crypto = require('crypto');
const shared = require('@notely/shared');
const logger = shared.logger;

// Whitelist of allowed redirect paths for portal
const ALLOWED_PORTAL_PATHS = [
  '/',           // Root page
  '/dashboard',
  '/settings',
  '/meetings',
  '/calendar',
  '/profile',
  '/notes',
  '/admin',
  '/oauth/callback',
  '/login'
];

const TOKEN_HASH_ALGORITHM = 'sha256';

function hashToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }
  return crypto.createHash(TOKEN_HASH_ALGORITHM).update(token).digest('hex');
}

function buildHashedKey(prefix, token) {
  const tokenHash = hashToken(token);
  return {
    key: `${prefix}:${tokenHash}`,
    tokenHash
  };
}

function buildLegacyKey(prefix, token) {
  return `${prefix}:${token}`;
}

async function migrateLegacyKey(redis, hashedKey, legacyKey) {
  const legacyValue = await redis.get(legacyKey);

  if (legacyValue === null) {
    return null;
  }

  try {
    const ttl = await redis.ttl(legacyKey);
    if (ttl > 0) {
      await redis.setEx(hashedKey, ttl, legacyValue);
    } else {
      await redis.set(hashedKey, legacyValue);
    }
  } catch (error) {
    logger.warn('Failed to migrate legacy Redis key', {
      legacyKey,
      hashedKey,
      error: error.message
    });
  } finally {
    await redis.del(legacyKey);
  }

  return legacyValue;
}

/**
 * Generate a cryptographically secure state parameter
 * @returns {string} Base64URL-encoded random state
 */
function generateState() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a one-time exchange code for desktop authentication
 * @returns {string} Base64URL-encoded random code
 */
function generateExchangeCode() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Validate return_to parameter to prevent open redirect attacks
 * @param {string} returnTo - The redirect URL or path to validate
 * @param {string} clientType - 'portal' or 'desktop'
 * @returns {string} Validated and safe return_to value
 * @throws {Error} If validation fails
 */
function validateReturnTo(returnTo, clientType = 'portal') {
  if (!returnTo || typeof returnTo !== 'string') {
    throw new Error('return_to parameter is required');
  }

  // For desktop: Allow notely:// protocol only
  if (clientType === 'desktop') {
    if (!returnTo.startsWith('notely://auth/callback')) {
      throw new Error('Invalid desktop redirect URL. Must start with notely://auth/callback');
    }
    return returnTo;
  }

  // For portal: Validate web paths
  // 1. Reject absolute URLs
  if (returnTo.startsWith('http://') || returnTo.startsWith('https://')) {
    throw new Error('Absolute URLs not allowed in return_to parameter');
  }

  // 2. Reject custom protocols (except notely://)
  if (returnTo.includes('://') && !returnTo.startsWith('notely://')) {
    throw new Error('Invalid protocol in return_to parameter');
  }

  // 3. Must be relative path starting with /
  if (!returnTo.startsWith('/')) {
    throw new Error('return_to must be a relative path starting with /');
  }

  // 4. Extract base path (remove query params and hash)
  const basePath = returnTo.split('?')[0].split('#')[0];

  // 5. Check against whitelist
  const isAllowed = ALLOWED_PORTAL_PATHS.some(allowedPath =>
    basePath.startsWith(allowedPath)
  );

  if (!isAllowed) {
    throw new Error(`return_to path "${basePath}" is not in whitelist. Allowed paths: ${ALLOWED_PORTAL_PATHS.join(', ')}`);
  }

  // 6. Prevent path traversal
  if (basePath.includes('..') || basePath.includes('//')) {
    throw new Error('Path traversal detected in return_to parameter');
  }

  return returnTo;
}

/**
 * Store OAuth state in Redis
 * @param {object} redis - Redis client
 * @param {string} state - State parameter
 * @param {object} data - Data to store (codeVerifier, clientType, returnTo, etc.)
 * @param {number} ttlSeconds - TTL in seconds (default: 600 = 10 minutes)
 */
async function storeOAuthState(redis, state, data, ttlSeconds = 600) {
  const key = `oauth:state:${state}`;
  await redis.setEx(key, ttlSeconds, JSON.stringify({
    ...data,
    createdAt: Date.now()
  }));
  logger.debug('OAuth state stored', { state, ttl: ttlSeconds });
}

/**
 * Retrieve and delete OAuth state from Redis (one-time use)
 * @param {object} redis - Redis client
 * @param {string} state - State parameter
 * @returns {object|null} Stored data or null if not found
 */
async function consumeOAuthState(redis, state) {
  const key = `oauth:state:${state}`;
  const data = await redis.get(key);

  if (!data) {
    logger.warn('OAuth state not found or expired', { state });
    return null;
  }

  // Delete immediately (one-time use)
  await redis.del(key);

  try {
    return JSON.parse(data);
  } catch (error) {
    logger.error('Failed to parse OAuth state', { error: error.message, state });
    return null;
  }
}

/**
 * Store exchange code in Redis for desktop authentication
 * @param {object} redis - Redis client
 * @param {string} code - Exchange code
 * @param {object} data - Data to store (userId, accessToken, refreshToken, desktopSessionId)
 * @param {number} ttlSeconds - TTL in seconds (default: 60)
 */
async function storeExchangeCode(redis, code, data, ttlSeconds = 60) {
  const key = `oauth:exchange:${code}`;
  await redis.setEx(key, ttlSeconds, JSON.stringify({
    ...data,
    createdAt: Date.now()
  }));
  logger.debug('Exchange code stored', { code: code.substring(0, 10) + '...', ttl: ttlSeconds });
}

/**
 * Retrieve and delete exchange code from Redis (one-time use)
 * @param {object} redis - Redis client
 * @param {string} code - Exchange code
 * @returns {object|null} Stored data or null if not found
 */
async function consumeExchangeCode(redis, code) {
  const key = `oauth:exchange:${code}`;
  const data = await redis.get(key);

  if (!data) {
    logger.warn('Exchange code not found or expired', { code: code.substring(0, 10) + '...' });
    return null;
  }

  // Delete immediately (one-time use)
  await redis.del(key);

  try {
    return JSON.parse(data);
  } catch (error) {
    logger.error('Failed to parse exchange code data', { error: error.message });
    return null;
  }
}

/**
 * Mark refresh token as used (for replay detection)
 * @param {object} redis - Redis client
 * @param {string} token - Refresh token
 * @param {number} ttlSeconds - TTL in seconds (should match refresh token expiry)
 */
async function markRefreshTokenUsed(redis, token, ttlSeconds = 7 * 24 * 60 * 60) {
  const { key, tokenHash } = buildHashedKey('refresh:used', token);
  const safeTtl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 7 * 24 * 60 * 60;

  await redis.setEx(key, safeTtl, 'used');
  await redis.del(buildLegacyKey('refresh:used', token));

  logger.debug('Refresh token marked as used', {
    tokenHash: tokenHash.substring(0, 20),
    ttl: safeTtl
  });
}

/**
 * Check if refresh token has been used before (replay detection)
 * @param {object} redis - Redis client
 * @param {string} token - Refresh token
 * @returns {boolean} True if token was already used
 */
async function isRefreshTokenUsed(redis, token) {
  const { key } = buildHashedKey('refresh:used', token);
  const result = await redis.get(key);

  if (result !== null) {
    return true;
  }

  const legacyKey = buildLegacyKey('refresh:used', token);
  const migrated = await migrateLegacyKey(redis, key, legacyKey);

  return migrated !== null;
}

/**
 * Store refresh token rotation mapping (for audit trail)
 * @param {object} redis - Redis client
 * @param {string} oldToken - Old refresh token
 * @param {string} newToken - New refresh token
 * @param {number} ttlSeconds - TTL in seconds
 */
async function storeTokenRotation(redis, oldToken, newToken, ttlSeconds = 7 * 24 * 60 * 60) {
  const { key, tokenHash } = buildHashedKey('refresh:rotation', oldToken);
  const newTokenHash = hashToken(newToken);

  await redis.setEx(key, ttlSeconds, newTokenHash);
  await redis.del(buildLegacyKey('refresh:rotation', oldToken));

  logger.debug('Refresh token rotation recorded', {
    fromHash: tokenHash.substring(0, 20),
    toHash: newTokenHash.substring(0, 20)
  });
}

/**
 * Blacklist an access token (for immediate revocation)
 * @param {object} redis - Redis client
 * @param {string} token - Access token to blacklist
 * @param {number} ttlSeconds - TTL in seconds (should match token expiry)
 */
async function blacklistToken(redis, token, ttlSeconds = 15 * 60) {
  const { key, tokenHash } = buildHashedKey('token:blacklist', token);
  const safeTtl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 15 * 60;

  await redis.setEx(key, safeTtl, 'revoked');
  await redis.del(buildLegacyKey('token:blacklist', token));

  logger.info('Token blacklisted', {
    tokenHash: tokenHash.substring(0, 20),
    ttl: safeTtl
  });
}

/**
 * Check if a token is blacklisted
 * @param {object} redis - Redis client
 * @param {string} token - Token to check
 * @returns {boolean} True if token is blacklisted
 */
async function isTokenBlacklisted(redis, token) {
  const { key } = buildHashedKey('token:blacklist', token);
  const result = await redis.get(key);

  if (result !== null) {
    return true;
  }

  const legacyKey = buildLegacyKey('token:blacklist', token);
  const migrated = await migrateLegacyKey(redis, key, legacyKey);

  return migrated !== null;
}

/**
 * Revoke all refresh tokens for a user (in case of security breach)
 * @param {object} redis - Redis client
 * @param {string} userId - User ID
 */
async function revokeAllUserSessions(redis, userId) {
  logger.error('SECURITY: Revoking all sessions for user due to refresh token replay', { userId });

  // Mark user as having all tokens revoked
  const revokeKey = `user:revoked:${userId}`;
  await redis.setEx(revokeKey, 7 * 24 * 60 * 60, Date.now().toString()); // 7 days

  // Find and delete all refresh tokens for this user
  // Pattern: refresh:token:{userId}:*
  const pattern = `refresh:token:${userId}:*`;

  // Scan for keys matching the pattern
  let cursor = '0';
  let deletedCount = 0;

  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    const keys = result.keys;

    if (keys && keys.length > 0) {
      await redis.del(keys);
      deletedCount += keys.length;
    }
  } while (cursor !== '0');

  logger.info('All user sessions revoked', { userId, tokensDeleted: deletedCount });
}

/**
 * Check if a user has been flagged for session revocation
 * @param {object} redis - Redis client
 * @param {string} userId - User ID
 * @returns {boolean} True if user sessions have been revoked
 */
async function isUserSessionsRevoked(redis, userId) {
  const revokeKey = `user:revoked:${userId}`;
  const result = await redis.get(revokeKey);
  return result !== null;
}

/**
 * Store refresh token with user mapping
 * @param {object} redis - Redis client
 * @param {string} refreshToken - Refresh token
 * @param {string} userId - User ID
 * @param {number} ttlSeconds - TTL in seconds (default 7 days)
 */
async function storeRefreshToken(redis, refreshToken, userId, ttlSeconds = 7 * 24 * 60 * 60) {
  const tokenHash = hashToken(refreshToken);
  const key = `refresh:token:${userId}:${tokenHash}`;

  await redis.setEx(key, ttlSeconds, JSON.stringify({
    userId,
    issuedAt: Date.now(),
    tokenHash
  }));

  const revokeKey = `user:revoked:${userId}`;
  try {
    const removed = await redis.del(revokeKey);
    if (removed) {
      logger.info('User revocation cleared after new login', { userId });
    }
  } catch (error) {
    logger.warn('Failed to clear user revocation flag', { userId, error: error.message });
  }

  logger.info('Refresh token stored', {
    userId,
    ttl: ttlSeconds,
    tokenHash: tokenHash.substring(0, 20)
  });
}

module.exports = {
  generateState,
  generateExchangeCode,
  validateReturnTo,
  storeOAuthState,
  consumeOAuthState,
  storeExchangeCode,
  consumeExchangeCode,
  markRefreshTokenUsed,
  isRefreshTokenUsed,
  storeTokenRotation,
  blacklistToken,
  isTokenBlacklisted,
  revokeAllUserSessions,
  isUserSessionsRevoked,
  storeRefreshToken,
  ALLOWED_PORTAL_PATHS
};
