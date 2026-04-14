import { getPool } from '../lib/database';

/**
 * Entity counts for a specific user
 */
export type UserEntityCounts = {
  binders: number;
  notes: number;
  transcriptions: number;
  summaries: number;
  tags: number;
  note_tags: number;
  total: number;
};

/**
 * Get entity counts for a specific user.
 * Used by desktop client to show merge prompt when switching servers.
 * Queries actual content tables instead of deprecated entity_hashes.
 */
export async function getUserEntityCounts(userId: string): Promise<UserEntityCounts> {
  const pool = getPool();

  const result = await pool.query(
    `SELECT
      (SELECT COUNT(*)::int FROM client_sync.binder_content WHERE user_id = $1 AND deleted = FALSE) as binders,
      (SELECT COUNT(*)::int FROM client_sync.note_content WHERE user_id = $1 AND deleted = FALSE) as notes,
      (SELECT COUNT(*)::int FROM client_sync.transcription_content WHERE user_id = $1 AND deleted = FALSE) as transcriptions,
      (SELECT COUNT(*)::int FROM client_sync.summary_content WHERE user_id = $1 AND deleted = FALSE) as summaries,
      (SELECT COUNT(*)::int FROM client_sync.tag_content WHERE user_id = $1 AND deleted = FALSE) as tags,
      (SELECT COUNT(*)::int FROM client_sync.note_tag_content WHERE user_id = $1 AND deleted = FALSE) as note_tags`,
    [userId]
  );

  const row = result.rows[0] || {};
  const counts: UserEntityCounts = {
    binders: Number(row.binders || 0),
    notes: Number(row.notes || 0),
    transcriptions: Number(row.transcriptions || 0),
    summaries: Number(row.summaries || 0),
    tags: Number(row.tags || 0),
    note_tags: Number(row.note_tags || 0),
    total: 0,
  };

  counts.total = counts.binders + counts.notes + counts.transcriptions +
                 counts.summaries + counts.tags + counts.note_tags;

  return counts;
}

export type SyncStats = {
  total_users: number;
  total_devices: number;
  active_devices: number;
  avg_sync_success_rate: number;
  sync_operations_today: number;
};

/**
 * Get sync statistics using the client_sync schema.
 */
const statsQuery = `
  WITH device_counts AS (
    SELECT
      COUNT(DISTINCT device_id) AS total_devices,
      COUNT(DISTINCT device_id) FILTER (
        WHERE last_sync_at > NOW() - INTERVAL '7 days'
      ) AS active_devices
    FROM client_sync.device_cursors
  ),
  user_counts AS (
    SELECT COUNT(DISTINCT user_id) AS total_users
    FROM client_sync.device_cursors
  ),
  success_rate AS (
    SELECT
      CASE
        WHEN COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days') = 0 THEN 100.0
        ELSE COALESCE(
          (COUNT(*) FILTER (WHERE success AND started_at > NOW() - INTERVAL '7 days')::float
            / NULLIF(COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days'), 0) * 100),
          100.0
        )
      END AS avg_sync_success_rate
    FROM client_sync.sync_operations
  ),
  operations_today AS (
    SELECT COUNT(*) AS sync_operations_today
    FROM client_sync.sync_operations
    WHERE started_at >= DATE_TRUNC('day', NOW())
  )
  SELECT
    COALESCE(uc.total_users, 0) AS total_users,
    COALESCE(dc.total_devices, 0) AS total_devices,
    COALESCE(dc.active_devices, 0) AS active_devices,
    COALESCE(sr.avg_sync_success_rate, 100.0) AS avg_sync_success_rate,
    COALESCE(ot.sync_operations_today, 0) AS sync_operations_today
  FROM user_counts uc
  CROSS JOIN device_counts dc
  CROSS JOIN success_rate sr
  CROSS JOIN operations_today ot
`;

export async function getStats(): Promise<SyncStats> {
  const pool = getPool();
  const result = await pool.query(statsQuery);
  const row = result.rows[0] ?? {
    total_users: '0',
    total_devices: '0',
    active_devices: '0',
    avg_sync_success_rate: '100',
    sync_operations_today: '0',
  };

  return {
    total_users: Number(row.total_users ?? 0),
    total_devices: Number(row.total_devices ?? 0),
    active_devices: Number(row.active_devices ?? 0),
    avg_sync_success_rate: Number(row.avg_sync_success_rate ?? 100),
    sync_operations_today: Number(row.sync_operations_today ?? 0),
  };
}
