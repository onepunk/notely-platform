/**
 * Sync Pruning Service
 * Executes pruning of sync_changes and sync_mutations tables
 * Uses the database functions created in V66__sync_pruning_functions.sql
 */

import { getPool } from '../lib/database';

export interface PruningResult {
  syncChangesDeleted: number;
  syncMutationsDeleted: number;
  durationMs: number;
  timestamp: string;
}

export interface PruningStats {
  syncChanges: {
    totalRows: number;
    oldestCreatedAt: string | null;
    newestCreatedAt: string | null;
  };
  syncMutations: {
    totalRows: number;
    oldestCreatedAt: string | null;
    newestCreatedAt: string | null;
  };
}

/**
 * Execute sync data pruning using the database functions
 * @param retentionDays Number of days to retain data (default: 30)
 */
export async function runSyncPruning(retentionDays: number = 30): Promise<PruningResult> {
  const startTime = Date.now();
  const pool = getPool();

  const result = await pool.query<{ sync_changes_deleted: string; sync_mutations_deleted: string }>(
    'SELECT * FROM client_sync.prune_sync_data($1)',
    [retentionDays]
  );

  const row = result.rows[0];
  const durationMs = Date.now() - startTime;

  return {
    syncChangesDeleted: parseInt(row?.sync_changes_deleted || '0', 10),
    syncMutationsDeleted: parseInt(row?.sync_mutations_deleted || '0', 10),
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get statistics about current sync data
 */
export async function getSyncPruningStats(): Promise<PruningStats> {
  const pool = getPool();

  // Get sync_changes stats
  const changesResult = await pool.query<{
    total: string;
    oldest: Date | null;
    newest: Date | null;
  }>(`
    SELECT
      COUNT(*) as total,
      MIN(created_at) as oldest,
      MAX(created_at) as newest
    FROM client_sync.sync_changes
  `);

  // Get sync_mutations stats
  const mutationsResult = await pool.query<{
    total: string;
    oldest: Date | null;
    newest: Date | null;
  }>(`
    SELECT
      COUNT(*) as total,
      MIN(created_at) as oldest,
      MAX(created_at) as newest
    FROM client_sync.sync_mutations
  `);

  const changesRow = changesResult.rows[0];
  const mutationsRow = mutationsResult.rows[0];

  return {
    syncChanges: {
      totalRows: parseInt(changesRow?.total || '0', 10),
      oldestCreatedAt: changesRow?.oldest?.toISOString() || null,
      newestCreatedAt: changesRow?.newest?.toISOString() || null,
    },
    syncMutations: {
      totalRows: parseInt(mutationsRow?.total || '0', 10),
      oldestCreatedAt: mutationsRow?.oldest?.toISOString() || null,
      newestCreatedAt: mutationsRow?.newest?.toISOString() || null,
    },
  };
}

/**
 * Check if a user's cursor is expired
 */
export async function isUserCursorExpired(userId: string, cursor: number): Promise<boolean> {
  const pool = getPool();

  const result = await pool.query<{ is_expired: boolean }>(
    'SELECT client_sync.is_cursor_expired($1, $2) as is_expired',
    [userId, cursor]
  );

  return result.rows[0]?.is_expired ?? true;
}

/**
 * Get the oldest available cursor for a user
 */
export async function getOldestCursor(userId: string): Promise<number> {
  const pool = getPool();

  const result = await pool.query<{ oldest_cursor: string }>(
    'SELECT client_sync.get_oldest_cursor($1) as oldest_cursor',
    [userId]
  );

  return parseInt(result.rows[0]?.oldest_cursor || '0', 10);
}
