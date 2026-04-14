/**
 * Downloads Routes
 * Public tracking endpoint for download analytics
 * Admin endpoint for viewing download statistics
 */

const express = require('express');
const crypto = require('crypto');
const shared = require('@notely/shared');
const { getUserContext } = require('../lib/userContext');

const { isAdmin } = shared.constants.roles;
const router = express.Router();
const db = shared.database;
const logger = shared.logger.child({ scope: 'portal-bff-downloads' });
const { downloadTrackingRateLimiter } = shared.middleware.rateLimiter;

// Valid platforms, variants, and products
const VALID_PLATFORMS = ['windows', 'mac', 'linux'];
const VALID_VARIANTS = ['x64', 'arm64', 'appimage', 'deb'];
const VALID_PRODUCTS = ['cloud', 'ai'];

// fileName validation constants
const MAX_FILENAME_LENGTH = 255;
const FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

// Platform variant mapping for display
const VARIANT_LABELS = {
  'windows-x64': 'Windows 64-bit',
  'mac-arm64': 'Mac Apple Silicon',
  'mac-x64': 'Mac Intel',
  'linux-appimage': 'Linux AppImage',
  'linux-deb': 'Linux .deb',
};

// Map download variants to database architecture values
const VARIANT_TO_ARCHITECTURE = {
  x64: 'x64',
  arm64: 'arm64',
  appimage: 'universal',
  deb: 'x64',
};

/**
 * Hash IP address for privacy-safe deduplication
 * @param {string} ip - IP address
 * @returns {string} SHA-256 hash
 */
function hashIP(ip) {
  if (!ip) return null;
  // Add a salt to prevent rainbow table attacks
  const salt = process.env.IP_HASH_SALT || 'notely-download-stats';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

/**
 * Get client IP from request (handles proxies)
 * @param {Request} req - Express request
 * @returns {string|null}
 */
function getClientIP(req) {
  // X-Forwarded-For can contain multiple IPs; take the first (original client)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || null;
}

/**
 * Validate and sanitize fileName
 * @param {string} fileName - File name to validate
 * @returns {string|null} Sanitized fileName or null if invalid/empty
 */
function validateFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return null;
  }

  // Trim and check length
  const trimmed = fileName.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FILENAME_LENGTH) {
    return null;
  }

  // Only allow safe characters (alphanumeric, dots, dashes, underscores)
  if (!FILENAME_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * POST /portal/downloads/track
 * Track a download event (PUBLIC - no auth required)
 * Fire-and-forget from client side
 * Rate limited via admin-config (default: 30 requests per minute per IP)
 */
router.post('/track', downloadTrackingRateLimiter, async (req, res) => {
  try {
    const { platform, variant, fileName, product = 'cloud' } = req.body;

    // Validate platform
    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_platform',
        message: `Invalid platform. Valid options: ${VALID_PLATFORMS.join(', ')}`,
      });
    }

    // Validate variant
    if (!variant || !VALID_VARIANTS.includes(variant)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_variant',
        message: `Invalid variant. Valid options: ${VALID_VARIANTS.join(', ')}`,
      });
    }

    // Validate product
    if (!VALID_PRODUCTS.includes(product)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_product',
        message: `Invalid product. Valid options: ${VALID_PRODUCTS.join(', ')}`,
      });
    }

    // Validate and sanitize fileName (optional field)
    const sanitizedFileName = validateFileName(fileName);

    // Get and hash client IP
    const clientIP = getClientIP(req);
    const ipHash = hashIP(clientIP);

    // Get user agent (truncate to prevent abuse)
    const userAgent = req.headers['user-agent']
      ? req.headers['user-agent'].substring(0, 500)
      : null;

    // Look up the latest published release for this product/platform/architecture to get release_id
    // This links downloads to specific versions for per-version stats
    let releaseId = null;
    try {
      const architecture = VARIANT_TO_ARCHITECTURE[variant];

      // Try product + architecture-specific match first
      let releaseResult = await db.query(
        `SELECT id FROM releases.desktop_releases
         WHERE product = $1 AND platform = $2 AND architecture = $3 AND status = 'published' AND is_latest = true
         LIMIT 1`,
        [product, platform, architecture]
      );

      // Fallback: any latest release for product + platform if no architecture match
      if (releaseResult.rows.length === 0) {
        releaseResult = await db.query(
          `SELECT id FROM releases.desktop_releases
           WHERE product = $1 AND platform = $2 AND status = 'published' AND is_latest = true
           LIMIT 1`,
          [product, platform]
        );
      }

      if (releaseResult.rows.length > 0) {
        releaseId = releaseResult.rows[0].id;
      }
    } catch (releaseErr) {
      // Non-fatal - continue without release_id
      logger.warn('Failed to look up release_id for download tracking', {
        platform,
        variant,
        error: releaseErr.message,
      });
    }

    // Insert download record with release_id and product
    await db.query(
      `INSERT INTO releases.download_stats (platform, variant, file_name, user_agent, ip_hash, release_id, product)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [platform, variant, sanitizedFileName, userAgent, ipHash, releaseId, product]
    );

    logger.info('Download tracked', {
      platform,
      variant,
      product,
      fileName: sanitizedFileName,
      hasIPHash: !!ipHash,
    });

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    // Log but don't fail - tracking is best-effort
    logger.error('Failed to track download', { error: error.message });
    res.status(200).json({
      success: true, // Return success anyway to not block client
    });
  }
});

/**
 * GET /portal/downloads/stats
 * Get download statistics (ADMIN only)
 */
router.get('/stats', async (req, res, next) => {
  try {
    // Require admin auth
    const context = getUserContext(req);
    if (!isAdmin(context.role)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    // Optional product filter
    const productFilter = req.query.product;
    if (productFilter && !VALID_PRODUCTS.includes(productFilter)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_product',
        message: `Invalid product. Valid options: ${VALID_PRODUCTS.join(', ')}`,
      });
    }

    const productCondition = productFilter ? `AND product = '${productFilter}'` : '';
    const productWhereCondition = productFilter ? `WHERE product = '${productFilter}'` : '';

    // Get total counts by platform and variant
    const totalsResult = await db.query(`
      SELECT
        platform,
        variant,
        product,
        COUNT(*) as count
      FROM releases.download_stats
      ${productWhereCondition}
      GROUP BY platform, variant, product
      ORDER BY product, platform, variant
    `);

    // Get counts for last 7 days
    const last7DaysResult = await db.query(`
      SELECT
        platform,
        variant,
        product,
        COUNT(*) as count
      FROM releases.download_stats
      WHERE downloaded_at >= NOW() - INTERVAL '7 days' ${productCondition}
      GROUP BY platform, variant, product
      ORDER BY product, platform, variant
    `);

    // Get counts for last 30 days
    const last30DaysResult = await db.query(`
      SELECT
        platform,
        variant,
        product,
        COUNT(*) as count
      FROM releases.download_stats
      WHERE downloaded_at >= NOW() - INTERVAL '30 days' ${productCondition}
      GROUP BY platform, variant, product
      ORDER BY product, platform, variant
    `);

    // Get daily breakdown for the last 30 days
    const dailyResult = await db.query(`
      SELECT
        DATE(downloaded_at) as date,
        platform,
        variant,
        product,
        COUNT(*) as count
      FROM releases.download_stats
      WHERE downloaded_at >= NOW() - INTERVAL '30 days' ${productCondition}
      GROUP BY DATE(downloaded_at), platform, variant, product
      ORDER BY date DESC, product, platform, variant
    `);

    // Format results - groups by product and variant
    const formatByPlatformVariant = (rows) => {
      const result = {};
      const byProduct = {};
      let total = 0;

      for (const row of rows) {
        const key = `${row.platform}-${row.variant}`;
        const count = parseInt(row.count, 10);
        const prod = row.product || 'cloud';

        // Aggregate across products for backward-compatible byVariant
        if (!result[key]) {
          result[key] = {
            platform: row.platform,
            variant: row.variant,
            label: VARIANT_LABELS[key] || key,
            count: 0,
          };
        }
        result[key].count += count;

        // Per-product breakdown
        if (!byProduct[prod]) {
          byProduct[prod] = { byVariant: {}, total: 0 };
        }
        byProduct[prod].byVariant[key] = {
          platform: row.platform,
          variant: row.variant,
          label: VARIANT_LABELS[key] || key,
          count,
        };
        byProduct[prod].total += count;

        total += count;
      }

      return { byVariant: result, total, byProduct };
    };

    const totals = formatByPlatformVariant(totalsResult.rows);
    const last7Days = formatByPlatformVariant(last7DaysResult.rows);
    const last30Days = formatByPlatformVariant(last30DaysResult.rows);

    res.json({
      success: true,
      data: {
        allTime: totals,
        last7Days,
        last30Days,
        daily: dailyResult.rows.map(row => ({
          date: row.date,
          platform: row.platform,
          variant: row.variant,
          product: row.product || 'cloud',
          count: parseInt(row.count, 10),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
