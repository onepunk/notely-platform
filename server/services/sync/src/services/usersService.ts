import { z } from 'zod';
import { getPool } from '../lib/database';
import { usersQuerySchema } from '../validation/admin';

type SyncUser = {
  user_id: string;
  email: string;
  last_sync: Date | null;
  device_count: number;
  sync_success_rate: number;
  last_error: string | null;
  status: string;
};

type UsersResponse = {
  users: SyncUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

type UsersQueryInput = z.infer<typeof usersQuerySchema>;

/**
 * Get sync users using the client_sync schema.
 *
 * User data is derived from:
 * - global_auth.user_credentials for user info
 * - client_sync.device_cursors for device counts
 * - client_sync.sync_operations for success rates and errors
 */
export async function getUsers(rawQuery: unknown): Promise<UsersResponse> {
  const parsed = usersQuerySchema.parse(rawQuery ?? {}) as UsersQueryInput;

  const { page, limit, sort, order, search } = parsed;

  const offset = (page - 1) * limit;
  const orderSql = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sortColumnMap: Record<string, string> = {
    email: 'email',
    last_sync: 'last_sync',
    device_count: 'device_count',
    sync_success_rate: 'sync_success_rate',
  };
  const sortColumn = sortColumnMap[sort] ?? 'last_sync';

  const values: Array<number | string> = [limit, offset];
  let searchClause = '';
  if (search) {
    searchClause = `AND (u.email ILIKE $3 OR u.user_id::text ILIKE $3)`;
    values.push(`%${search}%`);
  }

  const query = `
    WITH users_with_sync AS (
      SELECT DISTINCT dc.user_id
      FROM client_sync.device_cursors dc
    ),
    filtered_users AS (
      SELECT
        u.user_id,
        u.email
      FROM global_auth.user_credentials u
      WHERE u.user_id IN (SELECT user_id FROM users_with_sync)
      ${searchClause}
    ),
    device_counts AS (
      SELECT user_id, COUNT(DISTINCT device_id) AS device_count
      FROM client_sync.device_cursors
      GROUP BY user_id
    ),
    user_success_rates AS (
      SELECT
        user_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days') = 0 THEN 100.0
          ELSE COALESCE(
            (COUNT(*) FILTER (WHERE success AND started_at > NOW() - INTERVAL '7 days')::float
              / NULLIF(COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days'), 0) * 100),
            100.0
          )
        END AS sync_success_rate,
        MAX(started_at) AS last_sync
      FROM client_sync.sync_operations
      GROUP BY user_id
    ),
    last_errors AS (
      SELECT DISTINCT ON (user_id)
        user_id,
        error_message
      FROM client_sync.sync_operations
      WHERE NOT success
        AND error_message IS NOT NULL
      ORDER BY user_id, started_at DESC
    ),
    aggregated AS (
      SELECT
        fu.user_id,
        fu.email,
        sr.last_sync,
        COALESCE(dc.device_count, 0) AS device_count,
        ROUND(COALESCE(sr.sync_success_rate, 100.0)::numeric, 2)::float AS sync_success_rate,
        le.error_message AS last_error
      FROM filtered_users fu
      LEFT JOIN device_counts dc ON dc.user_id = fu.user_id
      LEFT JOIN user_success_rates sr ON sr.user_id = fu.user_id
      LEFT JOIN last_errors le ON le.user_id = fu.user_id
    )
    SELECT
      aggregated.user_id::text AS user_id,
      aggregated.email,
      aggregated.last_sync,
      aggregated.device_count,
      aggregated.sync_success_rate,
      aggregated.last_error,
      CASE
        WHEN aggregated.sync_success_rate < 80 THEN 'error'
        WHEN aggregated.last_sync IS NOT NULL AND aggregated.last_sync < NOW() - INTERVAL '7 days' THEN 'inactive'
        ELSE 'healthy'
      END AS status,
      COUNT(*) OVER() AS total_count
    FROM aggregated
    ORDER BY ${sortColumn} ${orderSql} NULLS LAST
    LIMIT $1 OFFSET $2
  `;

  const pool = getPool();
  const result = await pool.query(query, values);

  const totalCount = result.rows.length > 0 ? Number(result.rows[0].total_count ?? 0) : 0;

  const users: SyncUser[] = result.rows.map((row) => ({
    user_id: row.user_id,
    email: row.email,
    last_sync: row.last_sync ?? null,
    device_count: Number(row.device_count ?? 0),
    sync_success_rate: Number(row.sync_success_rate ?? 0),
    last_error: row.last_error ?? null,
    status: row.status,
  }));

  return {
    users,
    pagination: {
      page,
      limit,
      total: totalCount,
      pages: limit > 0 ? Math.ceil(totalCount / limit) : 0,
    },
  };
}
