/**
 * Admin Releases Routes
 * API endpoints for managing desktop releases
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const shared = require('@notely/shared');
const { getUserContext } = require('../lib/userContext');
const releasesService = require('../services/releasesService');
const releaseStorage = require('../lib/releaseStorage');

const { isAdmin } = shared.constants.roles;
const router = express.Router();
const logger = shared.logger.child({ scope: 'portal-bff-admin-releases' });

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      releaseStorage.ensureReleasesDirectory();
      cb(null, releaseStorage.RELEASES_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      // Temporary filename until we process it
      cb(null, `temp-${Date.now()}-${file.originalname}`);
    },
  }),
  limits: {
    fileSize: releaseStorage.MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    const platform = req.body.platform;
    if (!platform) {
      return cb(new Error('Platform must be specified before file'));
    }

    const validation = releaseStorage.validateFileExtension(file.originalname, platform);
    if (!validation.valid) {
      return cb(new Error(validation.message));
    }

    cb(null, true);
  },
});

/**
 * GET /portal/admin/releases
 * List all releases with optional filtering
 */
router.get('/', async (req, res, next) => {
  try {
    const context = getUserContext(req);

    // Check admin role
    if (!isAdmin(context.role)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    const { platform, status, product, limit, offset } = req.query;

    const result = await releasesService.listReleases({
      platform,
      status,
      product,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    next(error);
  }
});

/**
 * GET /portal/admin/releases/:id
 * Get a specific release
 */
router.get('/:id', async (req, res, next) => {
  try {
    const context = getUserContext(req);

    if (!isAdmin(context.role)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    const release = await releasesService.getReleaseById(req.params.id);

    if (!release) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Release not found',
      });
    }

    res.json({
      success: true,
      data: release,
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    next(error);
  }
});

/**
 * POST /portal/admin/releases
 * Create a new release with file upload
 */
router.post('/', (req, res, next) => {
  // Handle multipart form data
  upload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError) {
        const status = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({
          success: false,
          error: uploadError.code,
          message: uploadError.message,
        });
      }
      return res.status(400).json({
        success: false,
        error: 'upload_error',
        message: uploadError.message,
      });
    }

    try {
      const context = getUserContext(req);

      if (!isAdmin(context.role)) {
        // Clean up uploaded file
        if (req.file) {
          await releaseStorage.deleteReleaseFile(req.file.path).catch(() => {});
        }
        return res.status(403).json({
          success: false,
          error: 'forbidden',
          message: 'Admin access required',
        });
      }

      const { version, platform, product, releaseNotes, minVersion, status } = req.body;

      // Validate required fields
      if (!version) {
        return res.status(400).json({
          success: false,
          error: 'missing_version',
          message: 'Version is required',
        });
      }

      if (!platform) {
        return res.status(400).json({
          success: false,
          error: 'missing_platform',
          message: 'Platform is required',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'missing_file',
          message: 'Release file is required',
        });
      }

      // Move file to proper location and get metadata
      const fileInfo = await releaseStorage.saveReleaseFile({
        fileBuffer: req.file.path, // Path to temp file
        originalName: req.file.originalname,
        version,
        platform,
      });

      // Create database record
      const release = await releasesService.createRelease({
        version,
        platform,
        product: product || 'cloud',
        fileName: fileInfo.fileName,
        fileSize: fileInfo.fileSize,
        filePath: fileInfo.filePath,
        checksum: fileInfo.checksum,
        releaseNotes,
        minVersion,
        status: status || 'draft',
        createdBy: context.userId,
      });

      logger.info('Release created via admin API', {
        releaseId: release.id,
        version,
        platform,
        product: product || 'cloud',
        createdBy: context.userId,
      });

      res.status(201).json({
        success: true,
        data: release,
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file) {
        await releaseStorage.deleteReleaseFile(req.file.path).catch(() => {});
      }

      if (error.code === '23505') {
        // Unique constraint violation
        return res.status(409).json({
          success: false,
          error: 'duplicate_version',
          message: `Version ${req.body.version} already exists for ${req.body.platform}`,
        });
      }

      if (error.status === 401) {
        return res.status(401).json({
          success: false,
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }

      next(error);
    }
  });
});

/**
 * PATCH /portal/admin/releases/:id
 * Update a release
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const context = getUserContext(req);

    if (!isAdmin(context.role)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    const { releaseNotes, minVersion, status, isLatest } = req.body;

    const release = await releasesService.updateRelease(req.params.id, {
      releaseNotes,
      minVersion,
      status,
      isLatest,
    });

    if (!release) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Release not found',
      });
    }

    logger.info('Release updated via admin API', {
      releaseId: req.params.id,
      updatedBy: context.userId,
    });

    res.json({
      success: true,
      data: release,
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    next(error);
  }
});

/**
 * POST /portal/admin/releases/:id/publish
 * Publish a release and set it as latest
 */
router.post('/:id/publish', async (req, res, next) => {
  try {
    const context = getUserContext(req);

    if (!isAdmin(context.role)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    const { setAsLatest = true } = req.body;

    const release = await releasesService.publishRelease(req.params.id, setAsLatest);

    if (!release) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Release not found',
      });
    }

    logger.info('Release published via admin API', {
      releaseId: req.params.id,
      isLatest: setAsLatest,
      publishedBy: context.userId,
    });

    res.json({
      success: true,
      data: release,
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    next(error);
  }
});

/**
 * POST /portal/admin/releases/:id/archive
 * Archive a release
 */
router.post('/:id/archive', async (req, res, next) => {
  try {
    const context = getUserContext(req);

    if (!isAdmin(context.role)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    const release = await releasesService.archiveRelease(req.params.id);

    if (!release) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Release not found',
      });
    }

    logger.info('Release archived via admin API', {
      releaseId: req.params.id,
      archivedBy: context.userId,
    });

    res.json({
      success: true,
      data: release,
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    next(error);
  }
});

/**
 * DELETE /portal/admin/releases/:id
 * Delete a release and its file
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const context = getUserContext(req);

    if (!isAdmin(context.role)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    const deleted = await releasesService.deleteRelease(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Release not found',
      });
    }

    logger.info('Release deleted via admin API', {
      releaseId: req.params.id,
      deletedBy: context.userId,
    });

    res.json({
      success: true,
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }
    next(error);
  }
});

module.exports = router;
