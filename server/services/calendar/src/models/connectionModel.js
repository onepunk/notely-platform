/**
 * Outlook Connection Model
 * Database operations for managing Microsoft OAuth connections
 */

const shared = require('@notely/shared');
const db = shared.database;
const logger = shared.logger;

/**
 * Get connection by user ID
 */
async function getByUserId(userId) {
  try {
    const result = await db.query(
      `SELECT * FROM calendar.outlook_connections WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting connection by user ID', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Create or update a connection
 */
async function upsertConnection(userId, data) {
  try {
    const result = await db.query(
      `INSERT INTO calendar.outlook_connections (
        user_id,
        access_token,
        refresh_token,
        token_expires_at,
        microsoft_user_id,
        microsoft_email,
        is_connected,
        sync_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        microsoft_user_id = EXCLUDED.microsoft_user_id,
        microsoft_email = EXCLUDED.microsoft_email,
        is_connected = EXCLUDED.is_connected,
        sync_status = EXCLUDED.sync_status,
        sync_error = NULL,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        data.accessToken,
        data.refreshToken,
        data.tokenExpiresAt,
        data.microsoftUserId,
        data.microsoftEmail,
        true,
        'pending',
      ]
    );

    logger.info('Connection upserted', { userId });
    return result.rows[0];
  } catch (error) {
    logger.error('Error upserting connection', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Update tokens after refresh
 */
async function updateTokens(userId, accessToken, refreshToken, expiresAt) {
  try {
    const result = await db.query(
      `UPDATE calendar.outlook_connections
       SET access_token = $2,
           refresh_token = COALESCE($3, refresh_token),
           token_expires_at = $4,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, accessToken, refreshToken, expiresAt]
    );

    if (result.rows.length === 0) {
      throw new Error('Connection not found');
    }

    logger.debug('Tokens updated', { userId });
    return result.rows[0];
  } catch (error) {
    logger.error('Error updating tokens', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Update sync status
 */
async function updateSyncStatus(userId, status, errorMessage = null) {
  try {
    const result = await db.query(
      `UPDATE calendar.outlook_connections
       SET sync_status = $2,
           sync_error = $3,
           last_sync_at = CASE WHEN $2 = 'synced' THEN NOW() ELSE last_sync_at END,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, status, errorMessage]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error updating sync status', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Disconnect (soft delete)
 */
async function disconnect(userId) {
  try {
    const result = await db.query(
      `UPDATE calendar.outlook_connections
       SET is_connected = FALSE,
           access_token = '',
           refresh_token = '',
           sync_status = 'disconnected',
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId]
    );

    logger.info('Connection disconnected', { userId });
    return result.rows[0];
  } catch (error) {
    logger.error('Error disconnecting', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Hard delete connection
 */
async function deleteConnection(userId) {
  try {
    await db.query(
      `DELETE FROM calendar.outlook_connections WHERE user_id = $1`,
      [userId]
    );

    logger.info('Connection deleted', { userId });
  } catch (error) {
    logger.error('Error deleting connection', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Get connections that need token refresh (expiring within 10 minutes)
 */
async function getConnectionsNeedingRefresh() {
  try {
    const result = await db.query(
      `SELECT * FROM calendar.outlook_connections
       WHERE is_connected = TRUE
         AND token_expires_at < NOW() + INTERVAL '10 minutes'
       ORDER BY token_expires_at ASC
       LIMIT 100`
    );

    return result.rows;
  } catch (error) {
    logger.error('Error getting connections needing refresh', {
      error: error.message,
    });
    throw error;
  }
}

module.exports = {
  getByUserId,
  upsertConnection,
  updateTokens,
  updateSyncStatus,
  disconnect,
  deleteConnection,
  getConnectionsNeedingRefresh,
};
