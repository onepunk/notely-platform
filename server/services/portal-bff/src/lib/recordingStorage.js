const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const shared = require('@notely/shared');

const logger = shared.logger.child({ scope: 'portal-bff-recording-storage' });

const DEFAULT_UPLOAD_ROOT = path.resolve(
  process.env.RECORDINGS_UPLOAD_DIR ||
  process.env.TRANSCRIPTIONS_UPLOAD_DIR ||
  '/data/transcriptions_upload'
);

function sanitizeFileName(name) {
  return String(name || 'recording')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

function buildUserDirectory(userId) {
  return path.join(DEFAULT_UPLOAD_ROOT, userId);
}

function buildSafePath(targetPath) {
  const normalizedRoot = path.resolve(DEFAULT_UPLOAD_ROOT);
  const normalizedTarget = path.resolve(targetPath);

  if (!normalizedTarget.startsWith(normalizedRoot)) {
    throw new Error('Attempted path traversal detected');
  }

  return normalizedTarget;
}

function generateStoredFileName(originalName) {
  const safeName = sanitizeFileName(originalName);
  const extension = path.extname(safeName).toLowerCase();
  return `${Date.now()}-${crypto.randomUUID()}${extension || ''}`;
}

function relativeFromAbsolute(absolutePath) {
  const safePath = buildSafePath(absolutePath);
  return path.relative(DEFAULT_UPLOAD_ROOT, safePath).replace(/\\/g, '/');
}

async function deleteStoredFile(storagePath) {
  if (!storagePath) {
    return;
  }

  try {
    const absolutePath = buildSafePath(path.join(DEFAULT_UPLOAD_ROOT, storagePath));

    await fsp.unlink(absolutePath);
    logger.info('Removed stored recording file', { storagePath });
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('Recording file already deleted', { storagePath });
      return;
    }
    logger.error('Failed to delete stored recording', {
      storagePath,
      error: error.message
    });
    throw error;
  }
}

function resolveAbsolutePath(storagePath) {
  return buildSafePath(path.join(DEFAULT_UPLOAD_ROOT, storagePath));
}

module.exports = {
  DEFAULT_UPLOAD_ROOT,
  buildUserDirectory,
  generateStoredFileName,
  relativeFromAbsolute,
  deleteStoredFile,
  resolveAbsolutePath
};
