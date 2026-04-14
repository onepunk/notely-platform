/**
 * Internal Releases API Routes
 *
 * Internal endpoints for release synchronization from CI/CD pipelines.
 * Called by GitHub Actions after deploying release files to the webroot.
 *
 * These endpoints:
 * - Create or update database records for deployed releases
 * - Set releases as published and latest
 * - Enable the unified release management system
 */

const express = require('express');
const shared = require('@notely/shared');
const db = shared.database;

const router = express.Router();
const logger = shared.logger.child({ scope: 'portal-bff-internal-releases' });

/**
 * POST /internal/releases/sync
 * Sync a release from CI/CD deployment to the database
 *
 * Called by GitHub Actions after deploying files to webroot/get.yourdomain.com/releases/
 * Creates or updates the database record for the release
 *
 * Body:
 *   - version: string (required) - Semantic version (e.g., "0.8.7")
 *   - platform: string (required) - Target platform ("windows", "mac", "linux")
 *   - architecture: string (required) - CPU architecture ("x64", "arm64", "universal")
 *   - product: string (required) - Product line ("cloud" or "ai")
 *   - fileName: string (required) - Deployed filename
 *   - checksum: string (optional) - SHA-256 checksum
 *   - fileSize: number (optional) - File size in bytes
 *   - releaseNotes: string (optional) - Release notes
 */
router.post('/sync', async (req, res, next) => {
  try {
    const { version, platform, architecture, product, fileName, checksum, fileSize, releaseNotes } = req.body;

    // Validate required fields
    if (!version || typeof version !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'missing_version',
        message: 'Version is required and must be a string',
      });
    }

    if (!platform || !['windows', 'mac', 'linux'].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_platform',
        message: 'Platform must be one of: windows, mac, linux',
      });
    }

    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'missing_filename',
        message: 'fileName is required and must be a string',
      });
    }

    if (!architecture || !['x64', 'arm64', 'universal'].includes(architecture)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_architecture',
        message: 'architecture must be one of: x64, arm64, universal',
      });
    }

    if (!product || !['cloud', 'ai'].includes(product)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_product',
        message: 'product is required and must be one of: cloud, ai',
      });
    }

    // Construct file_path (relative path from releases root)
    const filePath = `${platform}/${fileName}`;

    logger.info('Processing release sync request', {
      version,
      platform,
      architecture,
      product,
      fileName,
      checksum: checksum ? checksum.substring(0, 8) + '...' : null,
      fileSize,
    });

    // Use upsert to create or update the release record
    // ON CONFLICT: update if version+platform+architecture+product already exists
    // Note: We don't set is_latest in the upsert to avoid trigger conflicts
    // Instead, we set it in a separate UPDATE after the upsert
    const upsertResult = await db.query(
      `INSERT INTO releases.desktop_releases (
        version,
        platform,
        architecture,
        product,
        file_name,
        file_size,
        file_path,
        checksum,
        release_notes,
        status,
        is_latest,
        published_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', false, NOW())
      ON CONFLICT (version, platform, architecture, product) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        file_size = COALESCE(EXCLUDED.file_size, releases.desktop_releases.file_size),
        file_path = EXCLUDED.file_path,
        checksum = COALESCE(EXCLUDED.checksum, releases.desktop_releases.checksum),
        release_notes = COALESCE(EXCLUDED.release_notes, releases.desktop_releases.release_notes),
        status = 'published',
        published_at = COALESCE(releases.desktop_releases.published_at, NOW()),
        updated_at = NOW()
      RETURNING id`,
      [
        version,
        platform,
        architecture,
        product,
        fileName,
        fileSize || 0,
        filePath,
        checksum || null,
        releaseNotes || null,
      ]
    );

    const releaseId = upsertResult.rows[0].id;

    // Now set is_latest=true in a separate query to properly trigger
    // the ensure_single_latest_release trigger
    const result = await db.query(
      `UPDATE releases.desktop_releases
       SET is_latest = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [releaseId]
    );

    const release = result.rows[0];

    logger.info('Release synced to database', {
      releaseId: release.id,
      version,
      platform,
      architecture,
      product,
      isNew: result.rowCount === 1,
      status: release.status,
      isLatest: release.is_latest,
    });

    res.status(200).json({
      success: true,
      data: {
        id: release.id,
        version: release.version,
        platform: release.platform,
        architecture: release.architecture,
        product: release.product,
        fileName: release.file_name,
        filePath: release.file_path,
        status: release.status,
        isLatest: release.is_latest,
        publishedAt: release.published_at,
        createdAt: release.created_at,
        updatedAt: release.updated_at,
      },
    });
  } catch (error) {
    logger.error('Failed to sync release', {
      error: error.message,
      version: req.body.version,
      platform: req.body.platform,
    });
    next(error);
  }
});

/**
 * POST /internal/releases/sync-batch
 * Sync multiple releases in a single request (for efficiency)
 *
 * Body:
 *   - releases: Array of release objects with version, platform, fileName, etc.
 */
router.post('/sync-batch', async (req, res, next) => {
  try {
    const { releases } = req.body;

    if (!Array.isArray(releases) || releases.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_releases',
        message: 'releases must be a non-empty array',
      });
    }

    logger.info('Processing batch release sync', {
      count: releases.length,
    });

    const results = [];
    const errors = [];

    for (const release of releases) {
      try {
        const { version, platform, architecture, product, fileName, checksum, fileSize, releaseNotes } = release;

        if (!version || !platform || !architecture || !product || !fileName) {
          errors.push({
            release,
            error: 'Missing required fields (version, platform, architecture, product, fileName)',
          });
          continue;
        }

        if (!['windows', 'mac', 'linux'].includes(platform)) {
          errors.push({
            release,
            error: 'Invalid platform',
          });
          continue;
        }

        if (!['x64', 'arm64', 'universal'].includes(architecture)) {
          errors.push({
            release,
            error: 'Invalid architecture (must be x64, arm64, or universal)',
          });
          continue;
        }

        if (!['cloud', 'ai'].includes(product)) {
          errors.push({
            release,
            error: 'Invalid product (must be cloud or ai)',
          });
          continue;
        }

        const filePath = `${platform}/${fileName}`;

        // Upsert without is_latest to avoid trigger conflicts
        const upsertResult = await db.query(
          `INSERT INTO releases.desktop_releases (
            version,
            platform,
            architecture,
            product,
            file_name,
            file_size,
            file_path,
            checksum,
            release_notes,
            status,
            is_latest,
            published_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', false, NOW())
          ON CONFLICT (version, platform, architecture, product) DO UPDATE SET
            file_name = EXCLUDED.file_name,
            file_size = COALESCE(EXCLUDED.file_size, releases.desktop_releases.file_size),
            file_path = EXCLUDED.file_path,
            checksum = COALESCE(EXCLUDED.checksum, releases.desktop_releases.checksum),
            release_notes = COALESCE(EXCLUDED.release_notes, releases.desktop_releases.release_notes),
            status = 'published',
            published_at = COALESCE(releases.desktop_releases.published_at, NOW()),
            updated_at = NOW()
          RETURNING id`,
          [
            version,
            platform,
            architecture,
            product,
            fileName,
            fileSize || 0,
            filePath,
            checksum || null,
            releaseNotes || null,
          ]
        );

        const releaseId = upsertResult.rows[0].id;

        // Set is_latest in separate query to properly trigger the constraint
        await db.query(
          `UPDATE releases.desktop_releases
           SET is_latest = true, updated_at = NOW()
           WHERE id = $1`,
          [releaseId]
        );

        results.push({
          id: releaseId,
          version,
          platform,
          architecture,
          product,
          status: 'synced',
        });
      } catch (err) {
        errors.push({
          release,
          error: err.message,
        });
      }
    }

    logger.info('Batch release sync completed', {
      synced: results.length,
      failed: errors.length,
    });

    res.status(200).json({
      success: errors.length === 0,
      data: {
        synced: results,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    logger.error('Failed to batch sync releases', {
      error: error.message,
    });
    next(error);
  }
});

/**
 * GET /internal/releases/status
 * Get current release status for all platforms
 *
 * Useful for CI/CD to verify sync completed successfully
 */
router.get('/status', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT product, platform, architecture, version, status, is_latest, published_at, updated_at
       FROM releases.desktop_releases
       WHERE status = 'published' AND is_latest = true
       ORDER BY product, platform, architecture`
    );

    // Group by product, then platform, with architectures as sub-keys
    const status = {};
    for (const row of result.rows) {
      const prod = row.product || 'cloud';
      if (!status[prod]) {
        status[prod] = {};
      }
      if (!status[prod][row.platform]) {
        status[prod][row.platform] = {};
      }
      status[prod][row.platform][row.architecture] = {
        version: row.version,
        architecture: row.architecture,
        product: prod,
        status: row.status,
        isLatest: row.is_latest,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
      };
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error('Failed to get release status', {
      error: error.message,
    });
    next(error);
  }
});

module.exports = router;
