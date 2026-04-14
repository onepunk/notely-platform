/**
 * Calendar Event Model
 * Database operations for cached calendar events
 */

const shared = require('@notely/shared');
const db = shared.database;
const logger = shared.logger;

/**
 * Get events for a user within a time range
 */
async function getEventsInRange(userId, startTime, endTime) {
  try {
    const result = await db.query(
      `SELECT * FROM calendar.cached_events
       WHERE user_id = $1
         AND start_time >= $2
         AND start_time <= $3
         AND is_cancelled = FALSE
       ORDER BY start_time ASC`,
      [userId, startTime, endTime]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error getting events in range', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Upsert events (insert or update on conflict)
 */
async function upsertEvents(userId, connectionId, events) {
  if (!events || events.length === 0) {
    return { upserted: 0 };
  }

  const client = await db.getPool().connect();

  try {
    await client.query('BEGIN');

    let upsertedCount = 0;

    for (const event of events) {
      await client.query(
        `INSERT INTO calendar.cached_events (
          user_id,
          connection_id,
          microsoft_event_id,
          calendar_id,
          subject,
          body_preview,
          location,
          start_time,
          end_time,
          is_all_day,
          timezone,
          is_cancelled,
          is_online_meeting,
          online_meeting_url,
          organizer_email,
          organizer_name,
          raw_payload,
          last_modified_at,
          synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
        ON CONFLICT (user_id, microsoft_event_id)
        DO UPDATE SET
          subject = EXCLUDED.subject,
          body_preview = EXCLUDED.body_preview,
          location = EXCLUDED.location,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          is_all_day = EXCLUDED.is_all_day,
          timezone = EXCLUDED.timezone,
          is_cancelled = EXCLUDED.is_cancelled,
          is_online_meeting = EXCLUDED.is_online_meeting,
          online_meeting_url = EXCLUDED.online_meeting_url,
          organizer_email = EXCLUDED.organizer_email,
          organizer_name = EXCLUDED.organizer_name,
          raw_payload = EXCLUDED.raw_payload,
          last_modified_at = EXCLUDED.last_modified_at,
          synced_at = NOW(),
          updated_at = NOW()`,
        [
          userId,
          connectionId,
          event.microsoftEventId,
          event.calendarId || null,
          event.subject,
          event.bodyPreview || null,
          event.location || null,
          event.startTime,
          event.endTime,
          event.isAllDay || false,
          event.timezone || 'UTC',
          event.isCancelled || false,
          event.isOnlineMeeting || false,
          event.onlineMeetingUrl || null,
          event.organizerEmail || null,
          event.organizerName || null,
          JSON.stringify(event.rawPayload || {}),
          event.lastModifiedAt || null,
        ]
      );

      upsertedCount++;
    }

    await client.query('COMMIT');

    logger.debug('Events upserted', { userId, count: upsertedCount });
    return { upserted: upsertedCount };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error upserting events', {
      error: error.message,
      userId,
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete old events (before a given date)
 */
async function deleteOldEvents(userId, beforeDate) {
  try {
    const result = await db.query(
      `DELETE FROM calendar.cached_events
       WHERE user_id = $1
         AND end_time < $2
       RETURNING id`,
      [userId, beforeDate]
    );

    logger.debug('Old events deleted', {
      userId,
      count: result.rowCount,
    });

    return { deleted: result.rowCount };
  } catch (error) {
    logger.error('Error deleting old events', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Delete all events for a user (used when disconnecting)
 */
async function deleteAllForUser(userId) {
  try {
    const result = await db.query(
      `DELETE FROM calendar.cached_events WHERE user_id = $1 RETURNING id`,
      [userId]
    );

    logger.info('All events deleted for user', {
      userId,
      count: result.rowCount,
    });

    return { deleted: result.rowCount };
  } catch (error) {
    logger.error('Error deleting all events', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Get event by Microsoft event ID
 */
async function getByMicrosoftId(userId, microsoftEventId) {
  try {
    const result = await db.query(
      `SELECT * FROM calendar.cached_events
       WHERE user_id = $1 AND microsoft_event_id = $2`,
      [userId, microsoftEventId]
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting event by Microsoft ID', {
      error: error.message,
      userId,
      microsoftEventId,
    });
    throw error;
  }
}

/**
 * Get sync statistics for a user
 */
async function getSyncStats(userId) {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*) as total_events,
         MIN(start_time) as earliest_event,
         MAX(end_time) as latest_event,
         MAX(synced_at) as last_sync
       FROM calendar.cached_events
       WHERE user_id = $1`,
      [userId]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error getting sync stats', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

module.exports = {
  getEventsInRange,
  upsertEvents,
  deleteOldEvents,
  deleteAllForUser,
  getByMicrosoftId,
  getSyncStats,
};
