/**
 * Desktop Session Model
 * Manages desktop OAuth sessions and refresh tokens
 */

const crypto = require('crypto');
const shared = require('@notely/shared');

const db = shared.database;
const cache = shared.cache;
const logger = shared.logger;

// Use existing global_auth.sessions table for now
// Can be migrated to dedicated desktop_sessions table later if needed
const TABLE_NAME = 'global_auth.sessions';
const CACHE_PREFIX = 'desktop_session:';
const REFRESH_TOKEN_CACHE_PREFIX = 'desktop_refresh:';

/**
 * Hash a refresh token for secure storage
 */
function hashRefreshToken(refreshToken) {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

/**
 * Create a new desktop session
 * @param {object} session - Session data
 * @param {string} session.userId - User ID
 * @param {string} session.accessToken - Access token (JWT)
 * @param {string} session.refreshToken - Refresh token (JWT)
 * @param {Date} session.accessExpiresAt - Access token expiry
 * @param {Date} session.refreshExpiresAt - Refresh token expiry
 * @param {string} session.deviceId - Device identifier
 * @param {string} session.deviceName - Device name
 * @returns {Promise<object>} Created session with ID
 */
async function createDesktopSession(session) {
  const {
    userId,
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    deviceId,
    deviceName
  } = session;

  if (!userId || !accessToken || !refreshToken) {
    throw new Error('Missing required session fields');
  }

  try {
    // Store access token session in database
    const result = await db.query(
      `INSERT INTO ${TABLE_NAME} (user_id, token, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, token, expires_at, created_at`,
      [userId, accessToken, accessExpiresAt]
    );

    const sessionRecord = result.rows[0];

    // Hash refresh token before storing
    const refreshTokenHash = hashRefreshToken(refreshToken);

    // Store refresh token metadata in cache with extended TTL
    const refreshTokenData = {
      sessionId: sessionRecord.id,
      userId,
      deviceId,
      deviceName,
      tokenHash: refreshTokenHash,
      expiresAt: refreshExpiresAt.toISOString(),
      createdAt: new Date().toISOString()
    };

    // Calculate TTL in seconds (refresh token lifetime)
    const ttlSeconds = Math.floor((refreshExpiresAt.getTime() - Date.now()) / 1000);

    // Store in cache with refresh token hash as key
    await cache.setCache(
      `${REFRESH_TOKEN_CACHE_PREFIX}${refreshTokenHash}`,
      refreshTokenData,
      ttlSeconds
    );

    // Also cache session metadata by session ID
    await cache.setCache(
      `${CACHE_PREFIX}${sessionRecord.id}`,
      {
        userId,
        deviceId,
        deviceName,
        refreshTokenHash
      },
      ttlSeconds
    );

    logger.info('Desktop session created', {
      sessionId: sessionRecord.id,
      userId,
      deviceId
    });

    return {
      id: sessionRecord.id,
      userId: sessionRecord.user_id,
      deviceId,
      deviceName,
      expiresAt: sessionRecord.expires_at,
      createdAt: sessionRecord.created_at
    };
  } catch (error) {
    logger.error('Error creating desktop session', {
      error: error.message,
      userId,
      deviceId
    });
    throw error;
  }
}

/**
 * Find session by refresh token
 * @param {string} refreshToken - Refresh token (JWT)
 * @returns {Promise<object|null>} Session data or null
 */
async function findSessionByRefreshToken(refreshToken) {
  try {
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const cacheKey = `${REFRESH_TOKEN_CACHE_PREFIX}${refreshTokenHash}`;

    // Look up refresh token metadata in cache
    const refreshData = await cache.getCache(cacheKey);

    if (!refreshData) {
      logger.warn('Refresh token not found in cache', { tokenHash: refreshTokenHash.substring(0, 8) });
      return null;
    }

    // Check if token has expired
    const expiresAt = new Date(refreshData.expiresAt);
    if (expiresAt < new Date()) {
      logger.warn('Refresh token expired', {
        tokenHash: refreshTokenHash.substring(0, 8),
        expiresAt: refreshData.expiresAt
      });

      // Clean up expired token
      await cache.deleteCache(cacheKey);
      return null;
    }

    // Return session data
    return {
      id: refreshData.sessionId,
      userId: refreshData.userId,
      deviceId: refreshData.deviceId,
      deviceName: refreshData.deviceName,
      tokenHash: refreshData.tokenHash,
      expiresAt: refreshData.expiresAt,
      createdAt: refreshData.createdAt
    };
  } catch (error) {
    logger.error('Error finding session by refresh token', { error: error.message });
    throw error;
  }
}

/**
 * Rotate refresh token (update with new token after refresh)
 * @param {string} sessionId - Session ID
 * @param {string} newRefreshToken - New refresh token (JWT)
 * @param {Date} newExpiresAt - New expiry timestamp
 * @param {string} oldRefreshToken - Old refresh token to revoke
 * @returns {Promise<void>}
 */
async function rotateRefreshToken(sessionId, newRefreshToken, newExpiresAt, oldRefreshToken) {
  try {
    // Get session metadata
    const sessionData = await cache.getCache(`${CACHE_PREFIX}${sessionId}`);

    if (!sessionData) {
      throw new Error('Session not found');
    }

    // Delete old refresh token
    if (oldRefreshToken) {
      const oldTokenHash = hashRefreshToken(oldRefreshToken);
      await cache.deleteCache(`${REFRESH_TOKEN_CACHE_PREFIX}${oldTokenHash}`);
    }

    // Store new refresh token
    const newTokenHash = hashRefreshToken(newRefreshToken);
    const ttlSeconds = Math.floor((newExpiresAt.getTime() - Date.now()) / 1000);

    const refreshTokenData = {
      sessionId,
      userId: sessionData.userId,
      deviceId: sessionData.deviceId,
      deviceName: sessionData.deviceName,
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt.toISOString(),
      createdAt: new Date().toISOString()
    };

    await cache.setCache(
      `${REFRESH_TOKEN_CACHE_PREFIX}${newTokenHash}`,
      refreshTokenData,
      ttlSeconds
    );

    // Update session metadata
    sessionData.refreshTokenHash = newTokenHash;
    await cache.setCache(`${CACHE_PREFIX}${sessionId}`, sessionData, ttlSeconds);

    logger.info('Refresh token rotated', {
      sessionId,
      userId: sessionData.userId,
      deviceId: sessionData.deviceId
    });
  } catch (error) {
    logger.error('Error rotating refresh token', { error: error.message, sessionId });
    throw error;
  }
}

/**
 * Revoke a session (logout)
 * @param {string} sessionId - Session ID
 * @param {string} reason - Reason for revocation
 * @returns {Promise<void>}
 */
async function revokeSession(sessionId, reason = 'logout') {
  try {
    // Get session metadata to find refresh token
    const sessionData = await cache.getCache(`${CACHE_PREFIX}${sessionId}`);

    // Delete from database
    await db.query(`DELETE FROM ${TABLE_NAME} WHERE id = $1`, [sessionId]);

    // Delete from cache
    await cache.deleteCache(`${CACHE_PREFIX}${sessionId}`);

    // Delete refresh token if it exists
    if (sessionData?.refreshTokenHash) {
      await cache.deleteCache(`${REFRESH_TOKEN_CACHE_PREFIX}${sessionData.refreshTokenHash}`);
    }

    logger.info('Desktop session revoked', {
      sessionId,
      reason,
      userId: sessionData?.userId,
      deviceId: sessionData?.deviceId
    });
  } catch (error) {
    logger.error('Error revoking session', { error: error.message, sessionId });
    throw error;
  }
}

/**
 * List all sessions for a user
 * @param {string} userId - User ID
 * @returns {Promise<array>} Array of session objects
 */
async function listSessionsForUser(userId) {
  try {
    const result = await db.query(
      `SELECT id, user_id, expires_at, created_at
       FROM ${TABLE_NAME}
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );

    // Enrich with cached metadata if available
    const sessions = await Promise.all(
      result.rows.map(async (row) => {
        const metadata = await cache.getCache(`${CACHE_PREFIX}${row.id}`);
        return {
          id: row.id,
          userId: row.user_id,
          deviceId: metadata?.deviceId,
          deviceName: metadata?.deviceName,
          expiresAt: row.expires_at,
          createdAt: row.created_at
        };
      })
    );

    return sessions;
  } catch (error) {
    logger.error('Error listing sessions for user', { error: error.message, userId });
    throw error;
  }
}

module.exports = {
  TABLE_NAME,
  createDesktopSession,
  findSessionByRefreshToken,
  rotateRefreshToken,
  revokeSession,
  listSessionsForUser,
  hashRefreshToken // Export for testing
};
