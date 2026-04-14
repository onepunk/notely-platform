import { PoolClient } from 'pg';
import { getPool } from '../lib/database';

export type OperationType = 'state' | 'diff' | 'merge';

export interface SyncOperation {
  id: string;
  user_id: string;
  device_id: string;
  operation_type: OperationType;
  started_at: Date;
  completed_at: Date | null;
  duration_ms: number | null;
  success: boolean;
  error_message: string | null;
  entities_changed: number;
  conflicts_resolved: number;
  metadata: Record<string, any> | null;
  created_at: Date;
}

export interface SyncOperationInput {
  user_id: string;
  device_id: string;
  operation_type: OperationType;
  metadata?: Record<string, any>;
}

export interface SyncOperationResult {
  success: boolean;
  error_message?: string;
  entities_changed?: number;
  conflicts_resolved?: number;
  metadata?: Record<string, any>;
}

/**
 * Start a new sync operation (creates a record with started_at)
 */
export async function startSyncOperation(
  input: SyncOperationInput,
  client?: PoolClient
): Promise<string> {
  const executor = client || getPool();

  const result = await executor.query<{ id: string }>(
    `INSERT INTO client_sync.sync_operations (
      user_id, device_id, operation_type, started_at, metadata
    ) VALUES ($1, $2, $3, NOW(), $4)
    RETURNING id`,
    [
      input.user_id,
      input.device_id,
      input.operation_type,
      input.metadata ? JSON.stringify(input.metadata) : null
    ]
  );

  return result.rows[0].id;
}

/**
 * Complete a sync operation with results
 */
export async function completeSyncOperation(
  operationId: string,
  result: SyncOperationResult,
  client?: PoolClient
): Promise<void> {
  const executor = client || getPool();

  await executor.query(
    `UPDATE client_sync.sync_operations
    SET
      completed_at = NOW(),
      duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
      success = $2,
      error_message = $3,
      entities_changed = $4,
      conflicts_resolved = $5,
      metadata = COALESCE($6::jsonb, metadata)
    WHERE id = $1`,
    [
      operationId,
      result.success,
      result.error_message || null,
      result.entities_changed || 0,
      result.conflicts_resolved || 0,
      result.metadata ? JSON.stringify(result.metadata) : null
    ]
  );
}

/**
 * Log a simple operation (start and complete in one call)
 */
export async function logOperation(
  userId: string,
  deviceId: string,
  operationType: OperationType,
  result: SyncOperationResult,
  client?: PoolClient
): Promise<string> {
  const executor = client || getPool();

  const opResult = await executor.query<{ id: string }>(
    `INSERT INTO client_sync.sync_operations (
      user_id, device_id, operation_type, started_at, completed_at,
      duration_ms, success, error_message, entities_changed,
      conflicts_resolved, metadata
    ) VALUES ($1, $2, $3, NOW(), NOW(), 0, $4, $5, $6, $7, $8)
    RETURNING id`,
    [
      userId,
      deviceId,
      operationType,
      result.success,
      result.error_message || null,
      result.entities_changed || 0,
      result.conflicts_resolved || 0,
      result.metadata ? JSON.stringify(result.metadata) : null
    ]
  );

  return opResult.rows[0].id;
}

/**
 * Get recent sync operations for a user
 */
export async function getRecentOperations(
  userId: string,
  limit: number = 50
): Promise<SyncOperation[]> {
  const pool = getPool();
  const result = await pool.query<SyncOperation>(
    `SELECT
      id, user_id, device_id, operation_type, started_at,
      completed_at, duration_ms, success, error_message,
      entities_changed, conflicts_resolved, metadata, created_at
    FROM client_sync.sync_operations
    WHERE user_id = $1
    ORDER BY started_at DESC
    LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
}

/**
 * Get failed operations for a user
 */
export async function getFailedOperations(
  userId: string,
  limit: number = 50
): Promise<SyncOperation[]> {
  const pool = getPool();
  const result = await pool.query<SyncOperation>(
    `SELECT
      id, user_id, device_id, operation_type, started_at,
      completed_at, duration_ms, success, error_message,
      entities_changed, conflicts_resolved, metadata, created_at
    FROM client_sync.sync_operations
    WHERE user_id = $1 AND success = FALSE
    ORDER BY started_at DESC
    LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
}

/**
 * Get sync statistics for a user
 */
export async function getSyncStats(userId: string): Promise<{
  total_operations: number;
  successful_operations: number;
  failed_operations: number;
  total_entities_changed: number;
  total_conflicts_resolved: number;
  avg_duration_ms: number;
}> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
      COUNT(*) as total_operations,
      COUNT(*) FILTER (WHERE success = TRUE) as successful_operations,
      COUNT(*) FILTER (WHERE success = FALSE) as failed_operations,
      COALESCE(SUM(entities_changed), 0) as total_entities_changed,
      COALESCE(SUM(conflicts_resolved), 0) as total_conflicts_resolved,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM client_sync.sync_operations
    WHERE user_id = $1`,
    [userId]
  );

  return result.rows[0];
}
