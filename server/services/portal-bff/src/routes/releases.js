/**
 * Public Releases Routes
 * Public endpoints for release info and downloads
 * Note: Direct file downloads now served by nginx at get.yourdomain.com/releases/
 * This service provides metadata and redirect endpoints
 */

const express = require('express');
const shared = require('@notely/shared');
const { getUserContext } = require('../lib/userContext');
const releasesService = require('../services/releasesService');

const { isAdmin } = shared.constants.roles;
const router = express.Router();
const logger = shared.logger.child({ scope: 'portal-bff-releases' });

/**
 * GET /portal/releases/latest/:platform
 * Get latest release info for a platform (PUBLIC - no auth required)
 * Query params:
 *   - product: 'cloud' (default) or 'ai'
 */
router.get('/latest/:platform', async (req, res, next) => {
  try {
    const { platform } = req.params;
    const product = req.query.product || 'cloud';

    // Validate platform
    const validPlatforms = ['windows', 'mac', 'linux'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_platform',
        message: `Invalid platform. Valid options: ${validPlatforms.join(', ')}`,
      });
    }

    // Validate product
    if (!['cloud', 'ai'].includes(product)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_product',
        message: 'Product must be one of: cloud, ai',
      });
    }

    const release = await releasesService.getLatestRelease(platform, product);

    if (!release) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `No published release found for ${platform}`,
      });
    }

    logger.info('Latest release info requested', {
      platform,
      product,
      version: release.version,
    });

    // Return release info with direct download URL
    res.json({
      success: true,
      data: {
        version: release.version,
        platform: release.platform,
        fileName: release.fileName,
        fileSize: release.fileSize,
        checksum: release.checksum,
        releaseNotes: release.releaseNotes,
        publishedAt: release.publishedAt,
        downloadUrl: release.downloadUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /portal/releases/latest
 * Get latest releases for all platforms with variants (PUBLIC - no auth required)
 * Returns version and available download variants for each platform
 * Query params:
 *   - product: 'cloud' (default) or 'ai'
 */
router.get('/latest', async (req, res, next) => {
  try {
    const product = req.query.product || 'cloud';

    if (!['cloud', 'ai'].includes(product)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_product',
        message: 'Product must be one of: cloud, ai',
      });
    }

    const releases = await releasesService.getLatestReleasesWithVariants(product);

    logger.info('All latest releases with variants requested', { product });

    res.json({
      success: true,
      data: releases,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /portal/releases/:id/download
 * Redirect to direct download URL (PUBLIC - no auth required)
 * Kept for backwards compatibility - redirects to nginx
 */
router.get('/:id/download', async (req, res, next) => {
  try {
    const release = await releasesService.getReleaseById(req.params.id);

    if (!release) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Release not found',
      });
    }

    // Only allow downloading published releases
    if (release.status !== 'published') {
      // Check if admin for non-published releases
      try {
        const context = getUserContext(req);
        if (!isAdmin(context.role)) {
          return res.status(404).json({
            success: false,
            error: 'not_found',
            message: 'Release not found',
          });
        }
      } catch {
        return res.status(404).json({
          success: false,
          error: 'not_found',
          message: 'Release not found',
        });
      }
    }

    logger.info('Release download redirect', {
      releaseId: release.id,
      version: release.version,
      platform: release.platform,
    });

    // Redirect to direct nginx download URL
    res.redirect(302, release.downloadUrl);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
