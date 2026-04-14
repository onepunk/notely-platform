const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const shared = require('@notely/shared');

const { getUserContext } = require('../lib/userContext');
const {
  buildUserDirectory,
  generateStoredFileName,
  relativeFromAbsolute,
  deleteStoredFile,
  resolveAbsolutePath
} = require('../lib/recordingStorage');
const recordingsService = require('../services/recordingsService');

const router = express.Router();
const logger = shared.logger.child({ scope: 'portal-bff-recordings-routes' });

const MAX_FILE_SIZE_MB = Number(process.env.RECORDINGS_MAX_FILE_SIZE_MB || 500);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.wma',
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.avi'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const { userId } = getUserContext(req);
      const userDir = buildUserDirectory(userId);
      fs.mkdir(userDir, { recursive: true }, (err) => cb(err, userDir));
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    try {
      cb(null, generateStoredFileName(file.originalname));
    } catch (error) {
      cb(error);
    }
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES
  },
  fileFilter: (req, file, cb) => {
    const mimeType = file.mimetype || '';
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported media type'));
    }

    if (extension && !SUPPORTED_EXTENSIONS.has(extension)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported file extension'));
    }

    return cb(null, true);
  }
});

function serializeRecording(record) {
  if (!record) return null;

  return {
    id: record.id,
    fileName: record.file_name,
    fileSize: Number(record.file_size),
    mimeType: record.mime_type,
    mediaType: record.media_type,
    status: record.status,
    durationSeconds: record.duration_seconds,
    uploadedAt: record.uploaded_at,
    transcriptId: record.transcript_id,
    downloadUrl: `/api/portal/recordings/${record.id}/download`
  };
}

router.get('/', async (req, res, next) => {
  try {
    const context = getUserContext(req);
    const rows = await recordingsService.listRecordingsForUser(context.userId);
    res.json({
      success: true,
      recordings: rows.map(serializeRecording)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', (req, res, next) => {
  upload.single('recording')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({
          success: false,
          error: err.code,
          message: err.message
        });
      }
      return next(err);
    }

    try {
      const context = getUserContext(req);
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'missing_file',
          message: 'Recording file is required'
        });
      }

      const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'audio';
      const storagePath = relativeFromAbsolute(file.path);

      const record = await recordingsService.createRecording({
        userId: context.userId,
        organizationId: context.organizationId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        mediaType,
        storagePath,
        status: 'uploaded'
      });

      res.status(201).json({
        success: true,
        recording: serializeRecording(record)
      });
    } catch (error) {
      next(error);
    }
  });
});

router.delete('/:recordingId', async (req, res, next) => {
  try {
    const { recordingId } = req.params;
    const context = getUserContext(req);

    const existing = await recordingsService.findRecordingById(recordingId, context.userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'recording_not_found'
      });
    }

    await deleteStoredFile(existing.storage_path);
    await recordingsService.deleteRecording(recordingId, context.userId);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:recordingId/download', async (req, res, next) => {
  try {
    const { recordingId } = req.params;
    const context = getUserContext(req);

    const record = await recordingsService.findRecordingById(recordingId, context.userId);
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'recording_not_found'
      });
    }

    const absolutePath = resolveAbsolutePath(record.storage_path);
    res.download(absolutePath, record.file_name, (error) => {
      if (error) {
        logger.error('Failed to stream recording download', {
          recordingId,
          error: error.message
        });
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'download_failed',
            message: 'Unable to download recording'
          });
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
