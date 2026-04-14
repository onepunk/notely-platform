/**
 * Releases Service
 * Handles database operations for desktop release management
 */

const shared = require('@notely/shared');
const db = shared.database;
const logger = shared.logger.child({ scope: 'portal-bff-releases-service' });
const { deleteReleaseFile, getDownloadUrl } = require('../lib/releaseStorage');

// Architecture labels for display
const ARCHITECTURE_LABELS = {
  x64: {
    windows: '64-bit',
    mac: 'Intel',
    linux: '.deb (Ubuntu/Debian)',
  },
  arm64: {
    mac: 'Apple Silicon',
  },
  universal: {
    linux: 'AppImage (Universal)',
  },
};

/**
 * List all releases with optional filtering
 * Download counts are computed from download_stats (single source of truth)
 * @param {Object} options
 * @param {string} [options.platform] - Filter by platform
 * @param {string} [options.status] - Filter by status
 * @param {string} [options.product] - Filter by product ('cloud' or 'ai')
 * @param {number} [options.limit] - Max results
 * @param {number} [options.offset] - Offset for pagination
 * @returns {Promise<{ releases: Array, total: number }>}
 */
async function listReleases({ platform, status, product, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (product) {
    conditions.push(`dr.product = $${paramIndex++}`);
    params.push(product);
  }

  if (platform) {
    conditions.push(`dr.platform = $${paramIndex++}`);
    params.push(platform);
  }

  if (status) {
    conditions.push(`dr.status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await db.query(
    `SELECT COUNT(*) as count FROM releases.desktop_releases dr ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get paginated results with computed download counts from download_stats
  const result = await db.query(
    `SELECT dr.*,
            COALESCE(ds.download_count, 0) as computed_download_count
     FROM releases.desktop_releases dr
     LEFT JOIN (
       SELECT release_id, COUNT(*) as download_count
       FROM releases.download_stats
       WHERE release_id IS NOT NULL
       GROUP BY release_id
     ) ds ON ds.release_id = dr.id
     ${whereClause}
     ORDER BY dr.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return {
    releases: result.rows.map(serializeRelease),
    total,
  };
}

/**
 * Get a release by ID
 * Download count is computed from download_stats (single source of truth)
 * @param {string} releaseId - Release UUID
 * @returns {Promise<Object|null>}
 */
async function getReleaseById(releaseId) {
  const result = await db.query(
    `SELECT dr.*,
            COALESCE(ds.download_count, 0) as computed_download_count
     FROM releases.desktop_releases dr
     LEFT JOIN (
       SELECT release_id, COUNT(*) as download_count
       FROM releases.download_stats
       WHERE release_id = $1
       GROUP BY release_id
     ) ds ON ds.release_id = dr.id
     WHERE dr.id = $1`,
    [releaseId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return serializeRelease(result.rows[0]);
}

/**
 * Get the latest published release for a platform
 * Download count is computed from download_stats (single source of truth)
 * @param {string} platform - Platform name
 * @param {string} [product='cloud'] - Product name ('cloud' or 'ai')
 * @returns {Promise<Object|null>}
 */
async function getLatestRelease(platform, product = 'cloud') {
  const result = await db.query(
    `SELECT dr.*,
            COALESCE(ds.download_count, 0) as computed_download_count
     FROM releases.desktop_releases dr
     LEFT JOIN (
       SELECT release_id, COUNT(*) as download_count
       FROM releases.download_stats
       GROUP BY release_id
     ) ds ON ds.release_id = dr.id
     WHERE dr.platform = $1 AND dr.product = $2 AND dr.status = 'published' AND dr.is_latest = true
     LIMIT 1`,
    [platform, product]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return serializeRelease(result.rows[0]);
}

/**
 * Get latest releases for all platforms
 * Download counts are computed from download_stats (single source of truth)
 * @param {string} [product='cloud'] - Product name ('cloud' or 'ai')
 * @returns {Promise<Object>} Object with platform keys and release values
 */
async function getLatestReleases(product = 'cloud') {
  const result = await db.query(
    `SELECT dr.*,
            COALESCE(ds.download_count, 0) as computed_download_count
     FROM releases.desktop_releases dr
     LEFT JOIN (
       SELECT release_id, COUNT(*) as download_count
       FROM releases.download_stats
       GROUP BY release_id
     ) ds ON ds.release_id = dr.id
     WHERE dr.product = $1 AND dr.status = 'published' AND dr.is_latest = true`,
    [product]
  );

  const releases = {};
  for (const row of result.rows) {
    releases[row.platform] = serializeRelease(row);
  }

  return releases;
}

/**
 * Get variant information from a database release record
 * Uses the architecture column to determine variant type and label
 * @param {Object} release - Database release record
 * @returns {{ id: string, label: string, fileName: string, downloadUrl: string, version: string }}
 */
function getVariantFromRelease(release) {
  const { platform, architecture, product, file_name, version } = release;

  // Get label from architecture labels, falling back to architecture name
  const platformLabels = ARCHITECTURE_LABELS[architecture] || {};
  const label = platformLabels[platform] || architecture;

  // Use getDownloadUrl for signed URL generation
  const downloadUrl = getDownloadUrl(null, { platform, product, fileName: file_name });

  return {
    id: architecture,
    label,
    fileName: file_name,
    downloadUrl,
    version,
  };
}

/**
 * Get latest releases for all platforms with variants
 * Queries database for published releases and derives variant info from filenames
 * Download counts are computed from download_stats (single source of truth)
 * @param {string} [product='cloud'] - Product name ('cloud' or 'ai')
 * @returns {Promise<Object>} Object with platform keys containing version, variants array, and downloadCount
 */
async function getLatestReleasesWithVariants(product = 'cloud') {
  // Query all published, latest releases from the database with computed download counts
  const result = await db.query(
    `SELECT dr.*,
            COALESCE(ds.download_count, 0) as computed_download_count
     FROM releases.desktop_releases dr
     LEFT JOIN (
       SELECT release_id, COUNT(*) as download_count
       FROM releases.download_stats
       GROUP BY release_id
     ) ds ON ds.release_id = dr.id
     WHERE dr.product = $1 AND dr.status = 'published' AND dr.is_latest = true
     ORDER BY dr.platform`,
    [product]
  );

  const releases = {};

  for (const row of result.rows) {
    const variant = getVariantFromRelease(row);

    if (variant) {
      if (!releases[row.platform]) {
        releases[row.platform] = {
          version: row.version,
          variants: [],
          downloadCount: parseInt(row.computed_download_count, 10) || 0,
        };
      }

      releases[row.platform].variants.push(variant);
    }
  }

  return releases;
}

/**
 * Create a new release
 * @param {Object} data
 * @param {string} data.version - Semantic version
 * @param {string} data.platform - Target platform (windows, mac, linux)
 * @param {string} data.architecture - CPU architecture (x64, arm64, universal)
 * @param {string} [data.product='cloud'] - Product line ('cloud' or 'ai')
 * @param {string} data.fileName - Original filename
 * @param {number} data.fileSize - File size in bytes
 * @param {string} data.filePath - Relative storage path
 * @param {string} [data.checksum] - SHA-256 checksum
 * @param {string} [data.releaseNotes] - Release notes
 * @param {string} [data.minVersion] - Minimum required version
 * @param {string} [data.status] - Initial status (default: draft)
 * @param {string} [data.createdBy] - User ID who created the release
 * @returns {Promise<Object>}
 */
async function createRelease(data) {
  const {
    version,
    platform,
    architecture = 'x64',
    product = 'cloud',
    fileName,
    fileSize,
    filePath,
    checksum,
    releaseNotes,
    minVersion,
    status = 'draft',
    createdBy,
  } = data;

  const result = await db.query(
    `INSERT INTO releases.desktop_releases
     (version, platform, architecture, product, file_name, file_size, file_path, checksum, release_notes, min_version, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [version, platform, architecture, product, fileName, fileSize, filePath, checksum, releaseNotes, minVersion, status, createdBy]
  );

  logger.info('Release created', {
    id: result.rows[0].id,
    version,
    platform,
    architecture,
    product,
    status,
  });

  return serializeRelease(result.rows[0]);
}

/**
 * Update a release
 * @param {string} releaseId - Release UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>}
 */
async function updateRelease(releaseId, updates) {
  const allowedFields = [
    'version',
    'release_notes',
    'min_version',
    'status',
    'is_latest',
  ];

  const setClauses = [];
  const params = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    // Convert camelCase to snake_case
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

    if (allowedFields.includes(snakeKey)) {
      setClauses.push(`${snakeKey} = $${paramIndex++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) {
    const current = await getReleaseById(releaseId);
    return current;
  }

  // Handle status change to published
  if (updates.status === 'published') {
    setClauses.push(`published_at = $${paramIndex++}`);
    params.push(new Date().toISOString());
  }

  params.push(releaseId);

  const result = await db.query(
    `UPDATE releases.desktop_releases
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    params
  );

  if (result.rows.length === 0) {
    return null;
  }

  logger.info('Release updated', {
    id: releaseId,
    updates: Object.keys(updates),
  });

  return serializeRelease(result.rows[0]);
}

/**
 * Publish a release and optionally set it as latest
 * @param {string} releaseId - Release UUID
 * @param {boolean} setAsLatest - Whether to set as latest for platform
 * @returns {Promise<Object|null>}
 */
async function publishRelease(releaseId, setAsLatest = true) {
  const updates = {
    status: 'published',
  };

  if (setAsLatest) {
    updates.isLatest = true;
  }

  return updateRelease(releaseId, updates);
}

/**
 * Archive a release
 * @param {string} releaseId - Release UUID
 * @returns {Promise<Object|null>}
 */
async function archiveRelease(releaseId) {
  return updateRelease(releaseId, { status: 'archived', isLatest: false });
}

/**
 * Delete a release and its file
 * @param {string} releaseId - Release UUID
 * @returns {Promise<boolean>}
 */
async function deleteRelease(releaseId) {
  // Get the release first to get the file path
  const release = await getReleaseById(releaseId);
  if (!release) {
    return false;
  }

  // Delete from database
  const result = await db.query(
    'DELETE FROM releases.desktop_releases WHERE id = $1',
    [releaseId]
  );

  if (result.rowCount === 0) {
    return false;
  }

  // Delete the file
  try {
    await deleteReleaseFile(release.filePath);
  } catch (error) {
    logger.warn('Failed to delete release file, but database record was removed', {
      releaseId,
      filePath: release.filePath,
      error: error.message,
    });
  }

  logger.info('Release deleted', { id: releaseId, version: release.version });

  return true;
}

/**
 * Get download counts for multiple releases from download_stats table
 * This is the single source of truth for download counts
 * @param {string[]} releaseIds - Array of release UUIDs
 * @returns {Promise<Map<string, number>>} Map of releaseId to download count
 */
async function getDownloadCountsByReleaseIds(releaseIds) {
  if (!releaseIds || releaseIds.length === 0) {
    return new Map();
  }

  const result = await db.query(
    `SELECT release_id, COUNT(*) as count
     FROM releases.download_stats
     WHERE release_id = ANY($1)
     GROUP BY release_id`,
    [releaseIds]
  );

  const counts = new Map();
  for (const row of result.rows) {
    counts.set(row.release_id, parseInt(row.count, 10));
  }
  return counts;
}

/**
 * Get download count for a single release
 * @param {string} releaseId - Release UUID
 * @returns {Promise<number>}
 */
async function getDownloadCount(releaseId) {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM releases.download_stats WHERE release_id = $1`,
    [releaseId]
  );
  return parseInt(result.rows[0]?.count || 0, 10);
}

/**
 * Get total download count for a platform (all versions combined)
 * @param {string} platform - Platform name
 * @returns {Promise<number>}
 */
async function getPlatformDownloadCount(platform) {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM releases.download_stats WHERE platform = $1`,
    [platform]
  );
  return parseInt(result.rows[0]?.count || 0, 10);
}

/**
 * Serialize a database row to API response format
 * Download count uses computed_download_count from download_stats (single source of truth)
 * @param {Object} row - Database row
 * @returns {Object}
 */
function serializeRelease(row) {
  // Build release object first to pass to getDownloadUrl
  // Use computed_download_count from download_stats if available, otherwise fall back to 0
  const downloadCount = row.computed_download_count !== undefined
    ? parseInt(row.computed_download_count, 10)
    : 0;

  const release = {
    id: row.id,
    version: row.version,
    platform: row.platform,
    architecture: row.architecture,
    product: row.product || 'cloud',
    fileName: row.file_name,
    fileSize: row.file_size,
    filePath: row.file_path,
    checksum: row.checksum,
    releaseNotes: row.release_notes,
    minVersion: row.min_version,
    status: row.status,
    isLatest: row.is_latest,
    downloadCount,
    createdBy: row.created_by,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  // Add download URL using direct nginx path via get.yourdomain.com
  release.downloadUrl = getDownloadUrl(row.id, release);
  return release;
}

module.exports = {
  listReleases,
  getReleaseById,
  getLatestRelease,
  getLatestReleases,
  getLatestReleasesWithVariants,
  createRelease,
  updateRelease,
  publishRelease,
  archiveRelease,
  deleteRelease,
  getDownloadCountsByReleaseIds,
  getDownloadCount,
  getPlatformDownloadCount,
};
