/**
 * Outlook Calendar Routes
 * Handles Microsoft OAuth flow and calendar event retrieval
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const shared = require('@notely/shared');
const logger = shared.logger;

const authMiddleware = require('../middleware/auth');
const connectionModel = require('../models/connectionModel');
const eventModel = require('../models/eventModel');
const microsoftGraphService = require('../services/microsoftGraphService');

// OAuth state storage (in production, use Redis)
const pendingOAuthStates = new Map();
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * GET /api/outlook/status
 * Check if user has connected their calendar
 */
router.get('/status', authMiddleware, async (req, res, next) => {
  try {
    const connection = await connectionModel.getByUserId(req.userId);

    if (!connection || !connection.is_connected) {
      return res.json({
        success: true,
        data: {
          connected: false,
          syncStatus: null,
          lastSyncTime: null,
          errorMessage: null,
        },
      });
    }

    // Check if token needs refresh
    const tokenExpired = new Date(connection.token_expires_at) < new Date();

    res.json({
      success: true,
      data: {
        connected: true,
        syncStatus: connection.sync_status,
        lastSyncTime: connection.last_sync_at,
        errorMessage: connection.sync_error,
        microsoftEmail: connection.microsoft_email,
        tokenExpired,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/outlook/auth
 * Get OAuth authorization URL to start the connection flow
 */
router.get('/auth', authMiddleware, async (req, res, next) => {
  try {
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state with user info
    pendingOAuthStates.set(state, {
      userId: req.userId,
      createdAt: Date.now(),
    });

    // Clean up old states
    cleanupOldStates();

    // Build redirect URI
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI ||
      `${process.env.API_BASE_URL}/api/outlook/callback`;

    const authUrl = await microsoftGraphService.getAuthorizationUrl(redirectUri, state);

    res.json({
      success: true,
      data: {
        authUrl,
        redirectUri,
      },
    });
  } catch (error) {
    logger.error('Failed to generate auth URL', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/outlook/callback
 * OAuth callback handler
 */
router.get('/callback', async (req, res) => {
  const { code, state, error: oauthError, error_description } = req.query;

  // Build the portal redirect URL
  const portalUrl = process.env.PORTAL_URL || 'https://portal.yourdomain.com';

  if (oauthError) {
    logger.error('OAuth error from Microsoft', {
      error: oauthError,
      description: error_description,
    });
    return res.redirect(`${portalUrl}/outlook-connected?success=false&error=${encodeURIComponent(error_description || oauthError)}`);
  }

  if (!state || !pendingOAuthStates.has(state)) {
    logger.warn('Invalid or expired OAuth state');
    return res.redirect(`${portalUrl}/outlook-connected?success=false&error=invalid_state`);
  }

  const stateData = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);

  // Check state expiry
  if (Date.now() - stateData.createdAt > STATE_EXPIRY_MS) {
    logger.warn('OAuth state expired');
    return res.redirect(`${portalUrl}/outlook-connected?success=false&error=state_expired`);
  }

  try {
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI ||
      `${process.env.API_BASE_URL}/api/outlook/callback`;

    // Exchange code for tokens
    const tokens = await microsoftGraphService.exchangeCodeForTokens(code, redirectUri);

    // Get user profile from Microsoft
    const profile = await microsoftGraphService.getUserProfile(tokens.accessToken);

    // Save connection to database
    await connectionModel.upsertConnection(stateData.userId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      microsoftUserId: profile.id,
      microsoftEmail: profile.email,
    });

    logger.info('Calendar connected successfully', {
      userId: stateData.userId,
      microsoftEmail: profile.email,
    });

    // Trigger initial sync in background
    syncEventsBackground(stateData.userId).catch((err) => {
      logger.error('Background sync failed', { error: err.message });
    });

    res.redirect(`${portalUrl}/outlook-connected?success=true`);
  } catch (error) {
    logger.error('OAuth callback error', {
      error: error.message,
      stack: error.stack,
    });
    res.redirect(`${portalUrl}/outlook-connected?success=false&error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * GET /api/outlook/events
 * Get calendar events for the authenticated user
 */
router.get('/events', authMiddleware, async (req, res, next) => {
  try {
    const {
      startTime,
      endTime,
      maxResults = 100,
      forceRefresh = false,
      timezone = 'UTC',
    } = req.query;

    // Validate required parameters
    if (!startTime || !endTime) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'startTime and endTime are required',
      });
    }

    // Get connection
    const connection = await connectionModel.getByUserId(req.userId);

    if (!connection || !connection.is_connected) {
      return res.status(404).json({
        error: 'Not Connected',
        message: 'Calendar not connected. Please connect your Microsoft calendar first.',
      });
    }

    // Check if we should use cached events
    const shouldRefresh = forceRefresh === 'true' || forceRefresh === true;

    if (!shouldRefresh) {
      // Try to get from cache
      const cachedEvents = await eventModel.getEventsInRange(
        req.userId,
        new Date(startTime),
        new Date(endTime)
      );

      if (cachedEvents.length > 0) {
        return res.json({
          success: true,
          data: {
            events: cachedEvents.map(formatEvent),
            source: 'cache',
            syncedAt: cachedEvents[0]?.synced_at,
          },
        });
      }
    }

    // Fetch from Microsoft Graph
    let accessToken = connection.access_token;

    // Refresh token if expired
    if (new Date(connection.token_expires_at) < new Date()) {
      logger.info('Refreshing expired token', { userId: req.userId });

      try {
        const refreshed = await microsoftGraphService.refreshAccessToken(connection.refresh_token);

        await connectionModel.updateTokens(
          req.userId,
          refreshed.accessToken,
          refreshed.refreshToken,
          refreshed.expiresAt
        );

        accessToken = refreshed.accessToken;
      } catch (refreshError) {
        logger.error('Token refresh failed', { error: refreshError.message });

        await connectionModel.updateSyncStatus(req.userId, 'error', 'Token refresh failed');

        return res.status(401).json({
          error: 'Token Expired',
          message: 'Unable to refresh Microsoft token. Please reconnect your calendar.',
        });
      }
    }

    // Fetch events from Microsoft
    await connectionModel.updateSyncStatus(req.userId, 'syncing');

    const graphResult = await microsoftGraphService.getCalendarEvents(accessToken, {
      startDateTime: startTime,
      endDateTime: endTime,
      maxResults: parseInt(maxResults, 10),
      timezone,
    });

    // Cache events
    await eventModel.upsertEvents(req.userId, connection.id, graphResult.events);

    await connectionModel.updateSyncStatus(req.userId, 'synced');

    res.json({
      success: true,
      data: {
        events: graphResult.events.map(formatEventFromGraph),
        source: 'microsoft',
        syncedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Failed to get events', {
      error: error.message,
      userId: req.userId,
    });

    if (error.response?.status === 401) {
      await connectionModel.updateSyncStatus(req.userId, 'error', 'Authentication failed');

      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'Microsoft authentication failed. Please reconnect your calendar.',
      });
    }

    next(error);
  }
});

/**
 * DELETE /api/outlook/disconnect
 * Disconnect the user's calendar
 */
router.delete('/disconnect', authMiddleware, async (req, res, next) => {
  try {
    const connection = await connectionModel.getByUserId(req.userId);

    if (!connection) {
      return res.json({
        success: true,
        message: 'No calendar connection found',
      });
    }

    // Delete cached events
    await eventModel.deleteAllForUser(req.userId);

    // Disconnect (soft delete)
    await connectionModel.disconnect(req.userId);

    logger.info('Calendar disconnected', { userId: req.userId });

    res.json({
      success: true,
      message: 'Calendar disconnected successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Helper functions

function cleanupOldStates() {
  const now = Date.now();
  for (const [state, data] of pendingOAuthStates.entries()) {
    if (now - data.createdAt > STATE_EXPIRY_MS) {
      pendingOAuthStates.delete(state);
    }
  }
}

function formatEvent(dbEvent) {
  return {
    id: dbEvent.id,
    microsoftEventId: dbEvent.microsoft_event_id,
    subject: dbEvent.subject,
    bodyPreview: dbEvent.body_preview,
    location: dbEvent.location,
    startTime: dbEvent.start_time,
    endTime: dbEvent.end_time,
    isAllDay: dbEvent.is_all_day,
    timezone: dbEvent.timezone,
    isCancelled: dbEvent.is_cancelled,
    isOnlineMeeting: dbEvent.is_online_meeting,
    onlineMeetingUrl: dbEvent.online_meeting_url,
    organizerEmail: dbEvent.organizer_email,
    organizerName: dbEvent.organizer_name,
  };
}

function formatEventFromGraph(graphEvent) {
  return {
    microsoftEventId: graphEvent.microsoftEventId,
    subject: graphEvent.subject,
    bodyPreview: graphEvent.bodyPreview,
    location: graphEvent.location,
    startTime: graphEvent.startTime,
    endTime: graphEvent.endTime,
    isAllDay: graphEvent.isAllDay,
    timezone: graphEvent.timezone,
    isCancelled: graphEvent.isCancelled,
    isOnlineMeeting: graphEvent.isOnlineMeeting,
    onlineMeetingUrl: graphEvent.onlineMeetingUrl,
    organizerEmail: graphEvent.organizerEmail,
    organizerName: graphEvent.organizerName,
  };
}

async function syncEventsBackground(userId) {
  try {
    const connection = await connectionModel.getByUserId(userId);
    if (!connection || !connection.is_connected) return;

    await connectionModel.updateSyncStatus(userId, 'syncing');

    // Sync events for the next 7 days
    const startDateTime = new Date();
    startDateTime.setHours(0, 0, 0, 0); // Start of today

    const endDateTime = new Date(startDateTime);
    endDateTime.setDate(endDateTime.getDate() + 7);

    const graphResult = await microsoftGraphService.getCalendarEvents(
      connection.access_token,
      {
        startDateTime: startDateTime.toISOString(),
        endDateTime: endDateTime.toISOString(),
        maxResults: 200,
      }
    );

    await eventModel.upsertEvents(userId, connection.id, graphResult.events);

    // Clean up old events (before today)
    await eventModel.deleteOldEvents(userId, startDateTime);

    await connectionModel.updateSyncStatus(userId, 'synced');

    logger.info('Background sync completed', {
      userId,
      eventCount: graphResult.events.length,
    });
  } catch (error) {
    logger.error('Background sync error', {
      error: error.message,
      userId,
    });

    await connectionModel.updateSyncStatus(userId, 'error', error.message);
  }
}

module.exports = router;
