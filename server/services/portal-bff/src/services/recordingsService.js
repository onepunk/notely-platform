const shared = require('@notely/shared');

const db = shared.database;
const logger = shared.logger.child({ scope: 'portal-bff-recordings-service' });

const BASE_SELECT = `
  SELECT
    id,
    user_id,
    organization_id,
    file_name,
    file_size,
    mime_type,
    media_type,
    storage_path,
    status,
    duration_seconds,
    transcript_id,
    checksum,
    uploaded_at,
    updated_at
  FROM user_portal_settings.user_recordings
`;

async function listRecordingsForUser(userId) {
  const result = await db.query(
    `${BASE_SELECT} WHERE user_id = $1 ORDER BY uploaded_at DESC`,
    [userId]
  );
  return result.rows;
}

async function createRecording(payload) {
  const {
    userId,
    organizationId,
    fileName,
    fileSize,
    mimeType,
    mediaType,
    storagePath,
    status = 'uploaded',
    durationSeconds = null,
    checksum = null
  } = payload;

  const result = await db.query(
    `
      INSERT INTO user_portal_settings.user_recordings
        (user_id, organization_id, file_name, file_size, mime_type, media_type, storage_path, status, duration_seconds, checksum)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
    [userId, organizationId, fileName, fileSize, mimeType, mediaType, storagePath, status, durationSeconds, checksum]
  );

  logger.info('Created recording metadata entry', {
    recordingId: result.rows[0]?.id,
    userId
  });

  return result.rows[0];
}

async function findRecordingById(recordingId, userId) {
  const result = await db.query(
    `${BASE_SELECT} WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [recordingId, userId]
  );
  return result.rows[0] || null;
}

async function deleteRecording(recordingId, userId) {
  const result = await db.query(
    `DELETE FROM user_portal_settings.user_recordings WHERE id = $1 AND user_id = $2 RETURNING *`,
    [recordingId, userId]
  );
  if (result.rowCount === 0) {
    return null;
  }
  logger.info('Deleted recording metadata entry', { recordingId, userId });
  return result.rows[0];
}

module.exports = {
  listRecordingsForUser,
  createRecording,
  findRecordingById,
  deleteRecording
};
