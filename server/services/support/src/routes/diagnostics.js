/**
 * User-facing diagnostics routes
 * Handles diagnostics bundle upload and listing for users
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const shared = require('@notely/shared');
const logger = shared.logger;
const db = shared.database;
const clamavService = require('../services/clamavService');

// Rate limiter: 3 uploads per user per hour
const diagnosticsUploadRateLimiter = shared.middleware.rateLimiter.createEndpointLimiter('diagnostics-upload', {
  points: 3,
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

const UPLOAD_DIR = path.join(__dirname, '../../uploads/diagnostics');
const TEMP_DIR = path.join(__dirname, '../../uploads/temp');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Ensure directories exist
[UPLOAD_DIR, TEMP_DIR].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

// Multer configuration for temp uploads
const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.endsWith('.zip')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are accepted'));
    }
  },
});

/**
 * Extract user info from gateway-injected headers
 */
function getUserFromHeaders(req) {
  return {
    userId: req.headers['x-auth-subject'],
    email: req.headers['x-auth-email'],
    role: req.headers['x-auth-role'],
  };
}

/**
 * Check if user is authenticated
 */
function requireAuth(req, res, next) {
  const { userId } = getUserFromHeaders(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }
  next();
}

/**
 * Validate zip contents - only allow safe file types
 */
async function validateZipContents(filePath) {
  // Use Node's built-in zlib to inspect zip entries
  // For a basic validation, we read the zip central directory
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    // Use unzip -l to list contents (available in most containers)
    const { stdout } = await execAsync(`unzip -l "${filePath}"`, { timeout: 10000 });
    const lines = stdout.split('\n');

    let hasManifest = false;
    const allowedExtensions = ['.log', '.json'];
    const entryNames = [];

    for (const line of lines) {
      // unzip -l output format: "  Length  Date  Time  Name"
      const match = line.trim().match(/\d+\s+\d{2}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)/);
      if (!match) continue;

      const entryName = match[1].trim();
      if (!entryName || entryName.endsWith('/')) continue; // Skip directories

      entryNames.push(entryName);
      const ext = path.extname(entryName).toLowerCase();
      const basename = path.basename(entryName);

      if (basename === 'manifest.json') {
        hasManifest = true;
      }

      if (!allowedExtensions.includes(ext)) {
        return { valid: false, reason: `Disallowed file type in archive: ${entryName}` };
      }
    }

    if (!hasManifest) {
      return { valid: false, reason: 'Missing manifest.json in archive' };
    }

    // Validate manifest.json content
    try {
      const { stdout: manifestJson } = await execAsync(`unzip -p "${filePath}" manifest.json`, { timeout: 5000 });
      const manifest = JSON.parse(manifestJson);

      // Required fields
      if (!manifest.appVersion || typeof manifest.appVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.appVersion)) {
        return { valid: false, reason: 'Invalid or missing appVersion in manifest' };
      }
      if (!['win32', 'darwin', 'linux'].includes(manifest.platform)) {
        return { valid: false, reason: 'Invalid or missing platform in manifest' };
      }
      if (!manifest.timestamp || isNaN(Date.parse(manifest.timestamp))) {
        return { valid: false, reason: 'Invalid or missing timestamp in manifest' };
      }
      if (!Number.isInteger(manifest.logFileCount) || manifest.logFileCount < 1) {
        return { valid: false, reason: 'Invalid or missing logFileCount in manifest' };
      }
    } catch (parseErr) {
      return { valid: false, reason: 'Failed to parse manifest.json' };
    }

    // Spot-check log file content
    const logEntry = entryNames.find((n) => n.endsWith('.log'));
    if (logEntry) {
      try {
        const { stdout: logSample } = await execAsync(
          `unzip -p "${filePath}" "${logEntry}" | head -20`,
          { timeout: 5000 }
        );
        const logPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d+Z \[(error|warn|info|http|verbose|debug|silly)\]/;
        const sampleLines = logSample.split('\n').filter((l) => l.trim());
        const hasValidLogLine = sampleLines.some((line) => logPattern.test(line));
        if (!hasValidLogLine) {
          return { valid: false, reason: 'Log files do not match expected Notely log format' };
        }
      } catch {
        // Non-fatal — log extraction can fail for empty logs
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: 'Failed to inspect archive contents' };
  }
}

/**
 * Verify file starts with zip magic bytes (PK\x03\x04)
 */
function verifyZipMagic(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    return buf.equals(ZIP_MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Clean up temp file
 */
function cleanupTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    logger.warn('Failed to clean up temp file', { filePath, error: e.message });
  }
}

/**
 * POST /api/support/diagnostics/upload
 * Upload a diagnostics bundle
 */
router.post('/upload', requireAuth, diagnosticsUploadRateLimiter, upload.single('file'), async (req, res, next) => {
  const { userId, email } = getUserFromHeaders(req);
  const tempPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    logger.info('Diagnostics upload received', {
      userId,
      filename: req.file.originalname,
      size: req.file.size,
    });

    // Verify zip magic bytes
    if (!verifyZipMagic(tempPath)) {
      cleanupTempFile(tempPath);
      return res.status(422).json({ error: 'Invalid archive', message: 'File is not a valid zip archive' });
    }

    // Validate zip contents
    const validation = await validateZipContents(tempPath);
    if (!validation.valid) {
      cleanupTempFile(tempPath);
      return res.status(422).json({ error: 'Invalid archive', message: validation.reason });
    }

    // ClamAV scan
    let scanResult;
    try {
      scanResult = await clamavService.scanFile(tempPath);
    } catch (scanErr) {
      cleanupTempFile(tempPath);
      logger.error('ClamAV unreachable during diagnostics upload', { error: scanErr.message });
      return res.status(503).json({
        error: 'Scan service unavailable',
        message: 'Virus scanning is temporarily unavailable. Please try again later.',
      });
    }

    if (!scanResult.clean) {
      cleanupTempFile(tempPath);
      logger.warn('Diagnostics upload rejected - scan failed', {
        userId,
        details: scanResult.details,
      });
      return res.status(422).json({ error: 'File rejected', message: 'File failed security scan' });
    }

    // Move to permanent storage
    const bundleId = uuidv4();
    const userDir = path.join(UPLOAD_DIR, userId);
    fs.mkdirSync(userDir, { recursive: true });

    const storagePath = path.join(userDir, `${bundleId}.zip`);
    fs.renameSync(tempPath, storagePath);

    // Parse manifest for metadata (best-effort)
    let appVersion = null;
    let platform = null;
    let osVersion = null;
    let arch = null;
    let cpuModel = null;
    let cpuCores = null;
    let totalMemoryGb = null;
    let gpuName = null;
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync(`unzip -p "${storagePath}" manifest.json`, {
        timeout: 5000,
      });
      const manifest = JSON.parse(stdout);
      appVersion = manifest.appVersion || null;
      platform = manifest.platform || null;
      osVersion = manifest.osVersion || null;
      arch = manifest.arch || null;
      cpuModel = manifest.cpuModel || null;
      cpuCores = manifest.cpuCores != null ? parseInt(manifest.cpuCores, 10) : null;
      totalMemoryGb = manifest.totalMemoryGB != null ? parseInt(manifest.totalMemoryGB, 10) : null;
      gpuName = manifest.gpu?.name || null;
    } catch (e) {
      // Non-fatal
    }

    // Insert into database
    const result = await db.query(
      `INSERT INTO support.diagnostics_bundles
       (id, user_id, user_email, filename, storage_path, size_bytes, app_version, platform,
        os_version, arch, cpu_model, cpu_cores, total_memory_gb, gpu_name, scan_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'clean')
       RETURNING id`,
      [
        bundleId,
        userId,
        email,
        req.file.originalname,
        storagePath,
        req.file.size,
        appVersion,
        platform,
        osVersion,
        arch,
        cpuModel,
        cpuCores,
        totalMemoryGb,
        gpuName,
      ]
    );

    logger.info('Diagnostics bundle stored', { bundleId, userId });

    res.status(201).json({ success: true, bundleId: result.rows[0].id });
  } catch (error) {
    cleanupTempFile(tempPath);
    logger.error('Failed to process diagnostics upload', { error: error.message, userId });
    next(error);
  }
});

/**
 * GET /api/support/diagnostics
 * List current user's uploaded diagnostics bundles
 */
router.get('/', requireAuth, async (req, res, next) => {
  const { userId } = getUserFromHeaders(req);

  try {
    const result = await db.query(
      `SELECT id, filename, status, scan_result, size_bytes, app_version, platform, created_at
       FROM support.diagnostics_bundles
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json({ bundles: result.rows });
  } catch (error) {
    logger.error('Failed to list diagnostics bundles', { error: error.message, userId });
    next(error);
  }
});

module.exports = router;
