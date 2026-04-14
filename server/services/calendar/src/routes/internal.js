/**
 * Internal Routes
 * Service-to-service communication endpoints
 */

const express = require('express');
const router = express.Router();

const shared = require('@notely/shared');
const logger = shared.logger;
const db = shared.database;

const connectionModel = require('../models/connectionModel');
const eventModel = require('../models/eventModel');
const microsoftGraphService = require('../services/microsoftGraphService');

/**
 * GET /internal/health
 * Detailed health check for internal monitoring
 */
router.get('/health', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();
    const stats = await db.getStats();

    res.json({
      status: 'healthy',
      service: 'calendar',
      timestamp: new Date().toISOString(),
      database: {
        status: dbHealth.status,
        pool: stats,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

/**
 * POST /internal/sync/:userId
 * Trigger sync for a specific user (called by scheduler/cron)
 */
router.post('/sync/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const connection = await connectionModel.getByUserId(userId);

    if (!connection || !connection.is_connected) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No active calendar connection for user',
      });
    }

    // Check if token needs refresh
    let accessToken = connection.access_token;

    if (new Date(connection.token_expires_at) < new Date()) {
      logger.info('Refreshing token for sync', { userId });

      try {
        const refreshed = await microsoftGraphService.refreshAccessToken(connection.refresh_token);

        await connectionModel.updateTokens(
          userId,
          refreshed.accessToken,
          refreshed.refreshToken,
          refreshed.expiresAt
        );

        accessToken = refreshed.accessToken;
      } catch (refreshError) {
        logger.error('Token refresh failed during sync', {
          error: refreshError.message,
          userId,
        });

        await connectionModel.updateSyncStatus(userId, 'error', 'Token refresh failed');

        return res.status(401).json({
          error: 'Token Refresh Failed',
          message: refreshError.message,
        });
      }
    }

    // Perform sync
    await connectionModel.updateSyncStatus(userId, 'syncing');

    const startDateTime = new Date();
    startDateTime.setHours(0, 0, 0, 0);

    const endDateTime = new Date(startDateTime);
    endDateTime.setDate(endDateTime.getDate() + 7);

    const graphResult = await microsoftGraphService.getCalendarEvents(accessToken, {
      startDateTime: startDateTime.toISOString(),
      endDateTime: endDateTime.toISOString(),
      maxResults: 200,
    });

    await eventModel.upsertEvents(userId, connection.id, graphResult.events);
    await eventModel.deleteOldEvents(userId, startDateTime);
    await connectionModel.updateSyncStatus(userId, 'synced');

    logger.info('Internal sync completed', {
      userId,
      eventCount: graphResult.events.length,
    });

    res.json({
      success: true,
      eventCount: graphResult.events.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Internal sync error', {
      error: error.message,
      userId,
    });

    await connectionModel.updateSyncStatus(userId, 'error', error.message);

    res.status(500).json({
      error: 'Sync Failed',
      message: error.message,
    });
  }
});

/**
 * GET /internal/connections/stale
 * Get connections that need token refresh (for background job)
 */
router.get('/connections/stale', async (req, res) => {
  try {
    const connections = await connectionModel.getConnectionsNeedingRefresh();

    res.json({
      count: connections.length,
      connections: connections.map((c) => ({
        userId: c.user_id,
        expiresAt: c.token_expires_at,
        lastSync: c.last_sync_at,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get stale connections',
      message: error.message,
    });
  }
});

/**
 * POST /internal/refresh-tokens
 * Refresh tokens for all stale connections (called by cron)
 */
router.post('/refresh-tokens', async (req, res) => {
  try {
    const connections = await connectionModel.getConnectionsNeedingRefresh();

    const results = {
      total: connections.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    for (const connection of connections) {
      try {
        const refreshed = await microsoftGraphService.refreshAccessToken(connection.refresh_token);

        await connectionModel.updateTokens(
          connection.user_id,
          refreshed.accessToken,
          refreshed.refreshToken,
          refreshed.expiresAt
        );

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          userId: connection.user_id,
          error: error.message,
        });

        // Mark connection as having an error
        await connectionModel.updateSyncStatus(
          connection.user_id,
          'error',
          'Token refresh failed'
        );
      }
    }

    logger.info('Token refresh batch completed', results);

    res.json(results);
  } catch (error) {
    res.status(500).json({
      error: 'Batch refresh failed',
      message: error.message,
    });
  }
});

/**
 * GET /internal/stats
 * Get service statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const connectionStats = await db.query(`
      SELECT
        COUNT(*) as total_connections,
        COUNT(*) FILTER (WHERE is_connected = TRUE) as active_connections,
        COUNT(*) FILTER (WHERE sync_status = 'error') as error_connections,
        COUNT(*) FILTER (WHERE token_expires_at < NOW()) as expired_tokens
      FROM calendar.outlook_connections
    `);

    const eventStats = await db.query(`
      SELECT
        COUNT(*) as total_events,
        COUNT(DISTINCT user_id) as users_with_events
      FROM calendar.cached_events
    `);

    res.json({
      connections: connectionStats.rows[0],
      events: eventStats.rows[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get stats',
      message: error.message,
    });
  }
});

module.exports = router;
