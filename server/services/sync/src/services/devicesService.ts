import { z } from 'zod';
import { getPool } from '../lib/database';
import { devicesQuerySchema } from '../validation/admin';

type DevicesQueryInput = z.infer<typeof devicesQuerySchema>;

type DeviceRecord = {
  device_id: string;
  device_name: string | null;
  user_id: string;
  user_email: string;
  last_cursor: number;
  last_sync_at: Date | null;
  is_active: boolean;
  sync_success_rate: number;
  recent_errors: number;
  status: string;
};

type DevicesResponse = {
  devices: DeviceRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

/**
 * Get devices using the client_sync schema.
 *
 * Uses client_sync.device_cursors for device info and
 * client_sync.sync_operations for metrics.
 *
 * User email is fetched from global_auth.user_credentials.
 */
export async function getDevices(rawQuery: unknown): Promise<DevicesResponse> {
  const parsed = devicesQuerySchema.parse(rawQuery ?? {}) as DevicesQueryInput;
  const { page, limit, user_id, search } = parsed;

  const offset = (page - 1) * limit;

  const values: Array<number | string> = [limit, offset];
  let filterClauses: string[] = [];
  let nextParam = 3;

  if (user_id) {
    filterClauses.push(`dc.user_id::text = $${nextParam}`);
    values.push(user_id);
    nextParam += 1;
  }

  if (search) {
    filterClauses.push(
      `(dc.device_id::text ILIKE $${nextParam} OR u.email ILIKE $${nextParam})`
    );
    values.push(`%${search}%`);
    nextParam += 1;
  }

  const whereClause = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';

  const query = `
    WITH base AS (
      SELECT
        dc.device_id,
        dc.device_name,
        dc.user_id,
        COALESCE(u.email, 'Unknown') AS user_email,
        dc.last_cursor,
        dc.last_sync_at,
        dc.created_at,
        dc.updated_at
      FROM client_sync.device_cursors dc
      LEFT JOIN global_auth.user_credentials u ON u.user_id = dc.user_id
      ${whereClause}
    ),
    device_metrics AS (
      SELECT
        o.device_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days') = 0 THEN 100.0
          ELSE COALESCE(
            (COUNT(*) FILTER (WHERE success AND started_at > NOW() - INTERVAL '7 days')::float
              / NULLIF(COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days'), 0) * 100),
            100.0
          )
        END AS sync_success_rate,
        COUNT(*) FILTER (
          WHERE NOT success
            AND started_at > NOW() - INTERVAL '24 hours'
        ) AS recent_errors
      FROM client_sync.sync_operations o
      WHERE o.device_id IS NOT NULL
      GROUP BY o.device_id
    )
    SELECT
      base.device_id::text AS device_id,
      base.device_name,
      base.user_id::text AS user_id,
      base.user_email,
      base.last_cursor,
      base.last_sync_at,
      TRUE AS is_active,
      ROUND(COALESCE(dm.sync_success_rate, 100.0)::numeric, 2)::float AS sync_success_rate,
      COALESCE(dm.recent_errors, 0) AS recent_errors,
      CASE
        WHEN COALESCE(dm.recent_errors, 0) > 5 OR COALESCE(dm.sync_success_rate, 100.0) < 80 THEN 'error'
        WHEN base.last_sync_at IS NOT NULL AND base.last_sync_at < NOW() - INTERVAL '3 days' THEN 'stale'
        ELSE 'healthy'
      END AS status,
      COUNT(*) OVER() AS total_count
    FROM base
    LEFT JOIN device_metrics dm ON dm.device_id = base.device_id
    ORDER BY base.last_sync_at DESC NULLS LAST
    LIMIT $1 OFFSET $2
  `;

  const pool = getPool();
  const result = await pool.query(query, values);

  const totalCount = result.rows.length > 0 ? Number(result.rows[0].total_count ?? 0) : 0;

  const devices: DeviceRecord[] = result.rows.map((row) => ({
    device_id: row.device_id,
    device_name: row.device_name ?? null,
    user_id: row.user_id,
    user_email: row.user_email,
    last_cursor: Number(row.last_cursor ?? 0),
    last_sync_at: row.last_sync_at ?? null,
    is_active: Boolean(row.is_active),
    sync_success_rate: Number(row.sync_success_rate ?? 0),
    recent_errors: Number(row.recent_errors ?? 0),
    status: row.status,
  }));

  return {
    devices,
    pagination: {
      page,
      limit,
      total: totalCount,
      pages: limit > 0 ? Math.ceil(totalCount / limit) : 0,
    },
  };
}
