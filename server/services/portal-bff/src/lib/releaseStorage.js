/**
 * Release Storage Utilities
 * Handles file storage for desktop releases
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const shared = require('@notely/shared');

const logger = shared.logger.child({ scope: 'portal-bff-release-storage' });

// Base directory for release uploads
const RELEASES_UPLOAD_DIR = process.env.RELEASES_UPLOAD_DIR || '/data/releases';

// Supported file extensions by platform
const PLATFORM_EXTENSIONS = {
  windows: ['.exe', '.msi', '.msix'],
  mac: ['.dmg', '.pkg', '.zip'],
  linux: ['.AppImage', '.deb', '.rpm', '.snap', '.tar.gz'],
};

// Maximum file size (1GB)
const MAX_FILE_SIZE = 1024 * 1024 * 1024;

/**
 * Ensure the releases directory exists
 */
function ensureReleasesDirectory() {
  if (!fs.existsSync(RELEASES_UPLOAD_DIR)) {
    fs.mkdirSync(RELEASES_UPLOAD_DIR, { recursive: true });
    logger.info('Created releases upload directory', { path: RELEASES_UPLOAD_DIR });
  }
}

/**
 * Get the full path for a platform's release directory
 * @param {string} platform - Platform name (windows, mac, linux)
 * @returns {string} Full directory path
 */
function getPlatformDirectory(platform) {
  const platformDir = path.join(RELEASES_UPLOAD_DIR, platform);
  if (!fs.existsSync(platformDir)) {
    fs.mkdirSync(platformDir, { recursive: true });
  }
  return platformDir;
}

/**
 * Generate a unique filename for a release
 * @param {string} originalName - Original filename
 * @param {string} version - Release version
 * @param {string} platform - Platform name
 * @returns {string} Generated filename
 */
function generateReleaseFilename(originalName, version, platform) {
  const ext = path.extname(originalName);
  const timestamp = Date.now();
  // Format: notely-{version}-{platform}-{timestamp}{ext}
  return `notely-${version}-${platform}-${timestamp}${ext}`;
}

/**
 * Calculate SHA-256 checksum of a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} Hex-encoded checksum
 */
async function calculateChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Validate file extension for platform
 * @param {string} filename - Original filename
 * @param {string} platform - Target platform
 * @returns {{ valid: boolean, message?: string }}
 */
function validateFileExtension(filename, platform) {
  const ext = path.extname(filename).toLowerCase();
  const allowedExtensions = PLATFORM_EXTENSIONS[platform];

  if (!allowedExtensions) {
    return { valid: false, message: `Unknown platform: ${platform}` };
  }

  // Handle compound extensions like .tar.gz
  const compoundExt = filename.toLowerCase().endsWith('.tar.gz') ? '.tar.gz' : ext;

  if (!allowedExtensions.includes(compoundExt)) {
    return {
      valid: false,
      message: `Invalid file extension for ${platform}. Allowed: ${allowedExtensions.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Save a release file
 * @param {Object} params
 * @param {Buffer|string} params.fileBuffer - File content or path to temp file
 * @param {string} params.originalName - Original filename
 * @param {string} params.version - Release version
 * @param {string} params.platform - Target platform
 * @returns {Promise<{ filePath: string, fileName: string, fileSize: number, checksum: string }>}
 */
async function saveReleaseFile({ fileBuffer, originalName, version, platform }) {
  ensureReleasesDirectory();

  const validation = validateFileExtension(originalName, platform);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const platformDir = getPlatformDirectory(platform);
  const fileName = generateReleaseFilename(originalName, version, platform);
  const fullPath = path.join(platformDir, fileName);

  // Calculate relative path for database storage
  const relativePath = path.join(platform, fileName);

  let fileSize;

  // Handle both buffer and file path
  if (Buffer.isBuffer(fileBuffer)) {
    fileSize = fileBuffer.length;
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }
    await fs.promises.writeFile(fullPath, fileBuffer);
  } else if (typeof fileBuffer === 'string') {
    // It's a path to a temp file - move it
    const stats = await fs.promises.stat(fileBuffer);
    fileSize = stats.size;
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }
    await fs.promises.rename(fileBuffer, fullPath);
  } else {
    throw new Error('Invalid file input');
  }

  const checksum = await calculateChecksum(fullPath);

  logger.info('Release file saved', {
    fileName,
    platform,
    version,
    fileSize,
    checksum,
  });

  return {
    filePath: relativePath,
    fileName,
    fileSize,
    checksum,
  };
}

/**
 * Delete a release file
 * @param {string} relativePath - Relative path from releases directory
 * @returns {Promise<boolean>}
 */
async function deleteReleaseFile(relativePath) {
  const fullPath = path.join(RELEASES_UPLOAD_DIR, relativePath);

  try {
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
      logger.info('Release file deleted', { path: relativePath });
      return true;
    }
    logger.warn('Release file not found for deletion', { path: relativePath });
    return false;
  } catch (error) {
    logger.error('Failed to delete release file', {
      path: relativePath,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get the full absolute path for a release file
 * @param {string} relativePath - Relative path from releases directory
 * @returns {string}
 */
function getAbsolutePath(relativePath) {
  return path.join(RELEASES_UPLOAD_DIR, relativePath);
}

/**
 * Check if a release file exists
 * @param {string} relativePath - Relative path from releases directory
 * @returns {boolean}
 */
function releaseFileExists(relativePath) {
  return fs.existsSync(path.join(RELEASES_UPLOAD_DIR, relativePath));
}

// Signing key for download URLs (loaded once from environment)
const RELEASES_SIGNING_KEY = process.env.RELEASES_SIGNING_KEY || '';

/**
 * Generate an HMAC-SHA256 signature for a download URL
 * @param {string} urlPath - Decoded URL path (e.g. /releases/cloud/windows/notely-1.0.0.exe)
 * @param {number} expires - Unix timestamp when the URL expires
 * @returns {string} First 32 chars of hex-encoded HMAC-SHA256
 */
function signDownloadUrl(urlPath, expires) {
  const data = `${urlPath}:${expires}`;
  const hmac = crypto.createHmac('sha256', RELEASES_SIGNING_KEY);
  hmac.update(data);
  return hmac.digest('hex').substring(0, 32);
}

/**
 * Get download URL for a release
 * Returns a signed, time-limited nginx URL for downloads via get.yourdomain.com
 * Files are stored under product-specific directories: releases/{product}/{platform}/
 * @param {string} releaseId - Release UUID (unused, kept for API compatibility)
 * @param {Object} release - Release object with platform, fileName, and product
 * @returns {string}
 */
function getDownloadUrl(releaseId, release) {
  // If release object provided, return signed nginx URL
  if (release && release.platform && release.fileName) {
    const getBaseUrl = process.env.GET_BASE_URL || 'https://get.yourdomain.com';
    const productDir = release.product === 'ai' ? 'ai' : 'cloud';
    const urlPath = `/releases/${productDir}/${release.platform}/${release.fileName}`;
    const encodedPath = `/releases/${productDir}/${release.platform}/${encodeURIComponent(release.fileName)}`;

    // If no signing key configured, return unsigned URL (backwards-compatible)
    if (!RELEASES_SIGNING_KEY) {
      return `${getBaseUrl}${encodedPath}`;
    }

    const expires = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    const sig = signDownloadUrl(urlPath, expires);
    return `${getBaseUrl}${encodedPath}?expires=${expires}&sig=${sig}`;
  }
  // Fallback to API download endpoint for legacy calls
  const baseUrl = process.env.API_BASE_URL || 'https://api.yourdomain.com';
  return `${baseUrl}/api/portal/releases/${releaseId}/download`;
}

module.exports = {
  ensureReleasesDirectory,
  getPlatformDirectory,
  generateReleaseFilename,
  calculateChecksum,
  validateFileExtension,
  saveReleaseFile,
  deleteReleaseFile,
  getAbsolutePath,
  releaseFileExists,
  getDownloadUrl,
  RELEASES_UPLOAD_DIR,
  MAX_FILE_SIZE,
  PLATFORM_EXTENSIONS,
};
