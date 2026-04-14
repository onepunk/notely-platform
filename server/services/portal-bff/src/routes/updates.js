/**
 * Updates Routes
 * Endpoints for desktop client update checking
 */

const express = require('express');
const shared = require('@notely/shared');
const { getUserContext } = require('../lib/userContext');
const updatesService = require('../services/updatesService');

const router = express.Router();
const logger = shared.logger.child({ scope: 'portal-bff-updates' });

/**
 * POST /portal/updates/check
 * Check if an update is available for the desktop client
 *
 * Authentication: Optional (works for both authenticated and anonymous users)
 *
 * Request body:
 * {
 *   currentVersion: "0.7.0",
 *   platform: "win32" | "darwin" | "linux"
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     updateAvailable: true,
 *     currentVersion: "0.7.0",
 *     latestVersion: "0.7.1",
 *     downloadUrl: "https://yourdomain.com/download/windows",
 *     releaseNotes: "Bug fixes and improvements",
 *     releaseDate: "2025-11-27",
 *     forceUpdate: false,
 *     platform: "windows"
 *   }
 * }
 */
router.post('/check', async (req, res, next) => {
  try {
    // Authentication is optional - allow both authenticated and anonymous update checks
    let userId = null;
    try {
      const context = getUserContext(req);
      userId = context.userId;
    } catch (authError) {
      // User not authenticated - that's fine for update checks
      logger.debug('Anonymous update check requested (no auth context)');
    }

    const { currentVersion, platform } = req.body;

    // Validate required fields
    if (!currentVersion) {
      return res.status(400).json({
        success: false,
        error: 'missing_version',
        message: 'currentVersion is required',
      });
    }

    if (!platform) {
      return res.status(400).json({
        success: false,
        error: 'missing_platform',
        message: 'platform is required',
      });
    }

    logger.info('Update check requested', {
      userId: userId || 'anonymous',
      currentVersion,
      platform,
    });

    const updateInfo = await updatesService.checkForUpdate({
      currentVersion,
      platform,
    });

    res.json({
      success: true,
      data: updateInfo,
    });
  } catch (error) {
    logger.error('Update check failed', {
      error: error.message,
      stack: error.stack,
    });

    next(error);
  }
});

/**
 * GET /portal/updates/latest
 * Get the latest release information for all platforms
 * This endpoint is also authenticated
 */
router.get('/latest', async (req, res, next) => {
  try {
    // Require authentication
    const context = getUserContext(req);

    logger.debug('Latest releases requested', { userId: context.userId });

    const releases = await updatesService.getLatestReleases();

    res.json({
      success: true,
      data: releases,
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        error: error.code || 'unauthorized',
        message: error.message || 'Authentication required',
      });
    }

    logger.error('Failed to get latest releases', {
      error: error.message,
      stack: error.stack,
    });

    next(error);
  }
});

module.exports = router;
