import { PoolClient } from 'pg';
import { getPool } from '../lib/database';

export interface DeviceCursor {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  last_cursor: number;
  last_sync_at: Date;
  created_at: Date;
  updated_at: Date;
  device_time_skew_ms: number | null;
  clock_suspect: boolean;
  last_client_time_ms: number | null;
}

/**
 * Get device cursor for a specific device
 */
export async function getDeviceCursor(
  userId: string,
  deviceId: string
): Promise<DeviceCursor | null> {
  const pool = getPool();
  const result = await pool.query<DeviceCursor>(
    `SELECT
      id, user_id, device_id, device_name, last_cursor,
      last_sync_at, created_at, updated_at,
      device_time_skew_ms, clock_suspect, last_client_time_ms
    FROM client_sync.device_cursors
    WHERE user_id = $1 AND device_id = $2`,
    [userId, deviceId]
  );

  return result.rows[0] || null;
}

/**
 * Get all device cursors for a user
 */
export async function getUserDeviceCursors(userId: string): Promise<DeviceCursor[]> {
  const pool = getPool();
  const result = await pool.query<DeviceCursor>(
    `SELECT
      id, user_id, device_id, device_name, last_cursor,
      last_sync_at, created_at, updated_at,
      device_time_skew_ms, clock_suspect, last_client_time_ms
    FROM client_sync.device_cursors
    WHERE user_id = $1
    ORDER BY last_sync_at DESC`,
    [userId]
  );

  return result.rows;
}

/**
 * Update device cursor (for /link endpoint - cursor starts at 0)
 */
export async function updateDeviceCursor(
  userId: string,
  deviceId: string,
  deviceName: string,
  client?: PoolClient
): Promise<DeviceCursor> {
  const executor = client || getPool();

  const result = await executor.query<DeviceCursor>(
    `INSERT INTO client_sync.device_cursors (
      user_id, device_id, device_name, last_cursor, last_sync_at
    ) VALUES ($1, $2, $3, 0, NOW())
    ON CONFLICT (user_id, device_id) DO UPDATE SET
      device_name = EXCLUDED.device_name,
      last_sync_at = NOW(),
      updated_at = NOW()
    RETURNING
      id, user_id, device_id, device_name, last_cursor,
      last_sync_at, created_at, updated_at,
      device_time_skew_ms, clock_suspect, last_client_time_ms`,
    [userId, deviceId, deviceName]
  );

  return result.rows[0];
}

/**
 * Update device cursor with skew tracking (used by POST /api/sync)
 */
export async function updateDeviceCursorWithSkew(
  userId: string,
  deviceId: string,
  deviceName: string,
  lastCursor: number,
  skewMs: number,
  clockSuspect: boolean,
  clientTimeMs: number,
  client?: PoolClient
): Promise<DeviceCursor> {
  const executor = client || getPool();

  const result = await executor.query<DeviceCursor>(
    `INSERT INTO client_sync.device_cursors (
      user_id, device_id, device_name, last_cursor, last_sync_at,
      device_time_skew_ms, clock_suspect, last_client_time_ms
    ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)
    ON CONFLICT (user_id, device_id) DO UPDATE SET
      device_name = COALESCE(EXCLUDED.device_name, client_sync.device_cursors.device_name),
      last_cursor = EXCLUDED.last_cursor,
      last_sync_at = NOW(),
      updated_at = NOW(),
      device_time_skew_ms = EXCLUDED.device_time_skew_ms,
      clock_suspect = EXCLUDED.clock_suspect,
      last_client_time_ms = EXCLUDED.last_client_time_ms
    RETURNING
      id, user_id, device_id, device_name, last_cursor,
      last_sync_at, created_at, updated_at,
      device_time_skew_ms, clock_suspect, last_client_time_ms`,
    [userId, deviceId, deviceName, lastCursor, skewMs, clockSuspect, clientTimeMs]
  );

  return result.rows[0];
}

/**
 * Get stale devices (haven't synced in a while)
 */
export async function getStaleDevices(
  userId: string,
  staleDays: number = 30
): Promise<DeviceCursor[]> {
  const pool = getPool();
  const result = await pool.query<DeviceCursor>(
    `SELECT
      id, user_id, device_id, device_name, last_cursor,
      last_sync_at, created_at, updated_at,
      device_time_skew_ms, clock_suspect, last_client_time_ms
    FROM client_sync.device_cursors
    WHERE user_id = $1
      AND last_sync_at < NOW() - INTERVAL '1 day' * $2
    ORDER BY last_sync_at ASC`,
    [userId, staleDays]
  );

  return result.rows;
}

/**
 * Delete a device cursor
 */
export async function deleteDeviceCursor(
  userId: string,
  deviceId: string,
  client?: PoolClient
): Promise<void> {
  const executor = client || getPool();

  await executor.query(
    `DELETE FROM client_sync.device_cursors
    WHERE user_id = $1 AND device_id = $2`,
    [userId, deviceId]
  );
}
