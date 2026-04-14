/**
 * Recording Retention Service
 * Handles cleanup of expired recording files while preserving transcripts
 */

const shared = require('@notely/shared');

const db = shared.database;
const logger = shared.logger.child({ service: 'admin-database', scope: 'recording-retention' });

// Storage path for recordings (configured via environment)
const RECORDINGS_STORAGE_PATH = process.env.RECORDINGS_STORAGE_PATH || '/app/uploads/recordings';

/**
 * Get expired recordings that need cleanup
 */
async function getExpiredRecordings(batchSize = 100) {
  try {
    const result = await db.query(
      `SELECT * FROM user_portal_settings.get_expired_recordings($1)`,
      [batchSize]
    );

    return result.rows;
  } catch (error) {
    logger.error('Failed to get expired recordings', {
      error: error.message,
      batchSize
    });
    throw error;
  }
}

/**
 * Mark a recording file as deleted
 */
async function markRecordingDeleted(recordingId) {
  try {
    const result = await db.query(
      `SELECT * FROM user_portal_settings.mark_recording_file_deleted($1)`,
      [recordingId]
    );

    return result.rows[0]?.mark_recording_file_deleted === true;
  } catch (error) {
    logger.error('Failed to mark recording as deleted', {
      error: error.message,
      recordingId
    });
    throw error;
  }
}

/**
 * Delete a recording file from storage
 * Note: Actual file deletion depends on storage implementation (local, S3, etc.)
 */
async function deleteRecordingFile(storagePath) {
  const fs = require('fs').promises;
  const path = require('path');

  try {
    // Construct full path
    const fullPath = path.join(RECORDINGS_STORAGE_PATH, storagePath);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch {
      logger.warn('Recording file not found, may have been already deleted', {
        storagePath,
        fullPath
      });
      return { deleted: false, reason: 'File not found' };
    }

    // Delete the file
    await fs.unlink(fullPath);

    logger.info('Recording file deleted successfully', {
      storagePath
    });

    return { deleted: true };
  } catch (error) {
    logger.error('Failed to delete recording file', {
      error: error.message,
      storagePath
    });
    throw error;
  }
}

/**
 * Process a single expired recording
 */
async function processExpiredRecording(recording) {
  const startTime = Date.now();

  try {
    logger.info('Processing expired recording', {
      recordingId: recording.recording_id,
      userId: recording.user_id,
      fileName: recording.file_name,
      expiresAt: recording.expires_at
    });

    // Try to delete the actual file
    let fileDeleteResult;
    try {
      fileDeleteResult = await deleteRecordingFile(recording.storage_path);
    } catch (error) {
      logger.warn('Could not delete recording file, marking as deleted anyway', {
        recordingId: recording.recording_id,
        error: error.message
      });
      fileDeleteResult = { deleted: false, reason: error.message };
    }

    // Mark as deleted in database (even if file deletion failed)
    const marked = await markRecordingDeleted(recording.recording_id);

    const duration = Date.now() - startTime;

    if (marked) {
      logger.info('Recording retention processed successfully', {
        recordingId: recording.recording_id,
        fileDeleted: fileDeleteResult.deleted,
        transcriptPreserved: recording.transcript_id !== null,
        duration
      });

      return {
        success: true,
        recordingId: recording.recording_id,
        fileDeleted: fileDeleteResult.deleted,
        transcriptPreserved: recording.transcript_id !== null
      };
    } else {
      logger.warn('Failed to mark recording as deleted', {
        recordingId: recording.recording_id,
        duration
      });

      return {
        success: false,
        recordingId: recording.recording_id,
        error: 'Failed to mark as deleted'
      };
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Failed to process expired recording', {
      recordingId: recording.recording_id,
      error: error.message,
      duration
    });

    return {
      success: false,
      recordingId: recording.recording_id,
      error: error.message
    };
  }
}

/**
 * Run the retention cleanup process
 */
async function runRetentionCleanup(batchSize = 100) {
  const startTime = Date.now();

  logger.info('Starting recording retention cleanup', { batchSize });

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    transcriptsPreserved: 0,
    errors: [],
    duration: 0
  };

  try {
    // Get expired recordings
    const expiredRecordings = await getExpiredRecordings(batchSize);

    if (expiredRecordings.length === 0) {
      logger.info('No expired recordings to process');
      results.duration = Date.now() - startTime;
      return results;
    }

    logger.info('Found expired recordings to process', {
      count: expiredRecordings.length
    });

    // Process each expired recording
    for (const recording of expiredRecordings) {
      results.processed++;

      const result = await processExpiredRecording(recording);

      if (result.success) {
        results.succeeded++;
        if (result.transcriptPreserved) {
          results.transcriptsPreserved++;
        }
      } else {
        results.failed++;
        results.errors.push({
          recordingId: result.recordingId,
          error: result.error
        });
      }
    }

    results.duration = Date.now() - startTime;

    logger.info('Recording retention cleanup completed', {
      processed: results.processed,
      succeeded: results.succeeded,
      failed: results.failed,
      transcriptsPreserved: results.transcriptsPreserved,
      duration: results.duration
    });

    return results;
  } catch (error) {
    results.duration = Date.now() - startTime;

    logger.error('Recording retention cleanup failed', {
      error: error.message,
      processed: results.processed,
      duration: results.duration
    });

    throw error;
  }
}

/**
 * Get retention statistics
 */
async function getRetentionStats() {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE file_deleted = FALSE AND expires_at IS NOT NULL) AS pending_cleanup,
        COUNT(*) FILTER (WHERE file_deleted = FALSE AND expires_at IS NOT NULL AND expires_at <= NOW()) AS ready_for_cleanup,
        COUNT(*) FILTER (WHERE file_deleted = TRUE) AS deleted_recordings,
        COUNT(*) FILTER (WHERE file_deleted = TRUE AND transcript_id IS NOT NULL) AS deleted_with_transcripts,
        COUNT(*) AS total_recordings
      FROM user_portal_settings.user_recordings
    `);

    return result.rows[0];
  } catch (error) {
    logger.error('Failed to get retention stats', {
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  getExpiredRecordings,
  markRecordingDeleted,
  deleteRecordingFile,
  processExpiredRecording,
  runRetentionCleanup,
  getRetentionStats
};
