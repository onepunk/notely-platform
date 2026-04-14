import { PoolClient } from 'pg';
import { getPool } from '../lib/database';

/**
 * Summary type enumeration matching database constraint
 */
export type SummaryType = 'full' | 'bullet' | 'key_points';

/**
 * Summary data structure matching database schema
 * All integer booleans use 0/1 to match desktop SQLite schema
 */
export interface Summary {
  id: string;
  user_id: string;
  transcription_id: string;
  summary_text: string | null;
  summary_text_encrypted: string | null;
  is_summary_encrypted: number;
  summary_type: SummaryType;
  processing_time_ms: number | null;
  model_used: string | null;
  backend_type: string | null;
  pipeline_used: number;
  sync_version: number;
  checksum: string | null;
  deleted: number;
  created_at: bigint;
  updated_at: bigint;
  server_updated_at: bigint | null;
}

/**
 * Input data for creating/updating summaries
 */
export interface SummaryData {
  id: string;
  transcription_id: string;
  summary_text?: string | null;
  summary_text_encrypted?: string | null;
  is_summary_encrypted?: number;
  summary_type?: SummaryType;
  processing_time_ms?: number | null;
  model_used?: string | null;
  backend_type?: string | null;
  pipeline_used?: number;
  sync_version?: number;
  checksum?: string | null;
  deleted?: number;
  created_at: bigint;
  updated_at: bigint;
}

/**
 * Repository for managing summary CRUD operations
 * Summaries are AI-generated transcript summaries with encryption support
 * Server generates, clients sync and read
 */
export class SummaryRepository {
  /**
   * Upsert a summary (insert or update)
   * Server-only operation - summaries are generated on the server
   *
   * @param userId - User ID for multi-tenant access control
   * @param summary - Summary data to insert/update
   * @param client - Optional database client for transaction support
   * @returns The upserted summary
   */
  async upsert(
    userId: string,
    summary: SummaryData,
    client?: PoolClient
  ): Promise<Summary> {
    const executor = client || getPool();
    const now = Date.now();

    const result = await executor.query<Summary>(
      `INSERT INTO client_summaries.summaries (
        id, user_id, transcription_id, summary_text, summary_text_encrypted,
        is_summary_encrypted, summary_type, processing_time_ms, model_used,
        backend_type, pipeline_used, sync_version, checksum, deleted,
        created_at, updated_at, server_updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
      ON CONFLICT (id) DO UPDATE SET
        transcription_id = EXCLUDED.transcription_id,
        summary_text = EXCLUDED.summary_text,
        summary_text_encrypted = EXCLUDED.summary_text_encrypted,
        is_summary_encrypted = EXCLUDED.is_summary_encrypted,
        summary_type = EXCLUDED.summary_type,
        processing_time_ms = EXCLUDED.processing_time_ms,
        model_used = EXCLUDED.model_used,
        backend_type = EXCLUDED.backend_type,
        pipeline_used = EXCLUDED.pipeline_used,
        sync_version = EXCLUDED.sync_version,
        checksum = EXCLUDED.checksum,
        deleted = EXCLUDED.deleted,
        updated_at = EXCLUDED.updated_at,
        server_updated_at = $17
      RETURNING *`,
      [
        summary.id,
        userId,
        summary.transcription_id,
        summary.summary_text ?? null,
        summary.summary_text_encrypted ?? null,
        summary.is_summary_encrypted ?? 0,
        summary.summary_type ?? 'full',
        summary.processing_time_ms ?? null,
        summary.model_used ?? null,
        summary.backend_type ?? null,
        summary.pipeline_used ?? 0,
        summary.sync_version ?? 1,
        summary.checksum ?? null,
        summary.deleted ?? 0,
        summary.created_at,
        summary.updated_at,
        now
      ]
    );

    if (result.rows.length === 0) {
      throw new Error(`Failed to upsert summary ${summary.id}`);
    }

    return result.rows[0];
  }

  /**
   * Find a summary by ID
   *
   * @param userId - User ID for access control
   * @param summaryId - Summary UUID
   * @param client - Optional database client
   * @returns The summary or null if not found
   */
  async findById(
    userId: string,
    summaryId: string,
    client?: PoolClient
  ): Promise<Summary | null> {
    const executor = client || getPool();

    const result = await executor.query<Summary>(
      `SELECT * FROM client_summaries.summaries
       WHERE id = $1 AND user_id = $2`,
      [summaryId, userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Find all non-deleted summaries for a user
   * Ordered by creation date (most recent first)
   *
   * @param userId - User ID
   * @param limit - Maximum number of results (default 100)
   * @param client - Optional database client
   * @returns Array of summaries
   */
  async findByUser(
    userId: string,
    limit: number = 100,
    client?: PoolClient
  ): Promise<Summary[]> {
    const executor = client || getPool();

    const result = await executor.query<Summary>(
      `SELECT * FROM client_summaries.summaries
       WHERE user_id = $1 AND deleted = 0
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows;
  }

  /**
   * Find summaries for a specific transcription
   * A transcription may have multiple summary types (full, bullet, key_points)
   *
   * @param userId - User ID for access control
   * @param transcriptionId - Transcription UUID
   * @param client - Optional database client
   * @returns Array of summaries for the transcription
   */
  async findByTranscription(
    userId: string,
    transcriptionId: string,
    client?: PoolClient
  ): Promise<Summary[]> {
    const executor = client || getPool();

    const result = await executor.query<Summary>(
      `SELECT * FROM client_summaries.summaries
       WHERE user_id = $1 AND transcription_id = $2 AND deleted = 0
       ORDER BY summary_type, created_at DESC`,
      [userId, transcriptionId]
    );

    return result.rows;
  }

  /**
   * Soft delete a summary (set deleted = 1)
   * Used for user-initiated deletions that need to sync to clients
   *
   * @param userId - User ID for access control
   * @param summaryId - Summary UUID to delete
   * @param client - Optional database client
   * @returns True if deleted, false if not found
   */
  async softDelete(
    userId: string,
    summaryId: string,
    client?: PoolClient
  ): Promise<boolean> {
    const executor = client || getPool();
    const now = Date.now();

    const result = await executor.query(
      `UPDATE client_summaries.summaries
       SET deleted = 1,
           updated_at = $3,
           server_updated_at = $3
       WHERE id = $1 AND user_id = $2 AND deleted = 0`,
      [summaryId, userId, now]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Hard delete a summary (permanent removal)
   * Used for GDPR compliance and cleanup operations
   * WARNING: This operation cannot be undone
   *
   * @param userId - User ID for access control
   * @param summaryId - Summary UUID to delete
   * @param client - Optional database client
   * @returns True if deleted, false if not found
   */
  async hardDelete(
    userId: string,
    summaryId: string,
    client?: PoolClient
  ): Promise<boolean> {
    const executor = client || getPool();

    const result = await executor.query(
      `DELETE FROM client_summaries.summaries
       WHERE id = $1 AND user_id = $2`,
      [summaryId, userId]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Get summary statistics for a user
   * Useful for analytics and monitoring
   *
   * @param userId - User ID
   * @param client - Optional database client
   * @returns Summary statistics
   */
  async getStats(userId: string, client?: PoolClient): Promise<{
    total_summaries: number;
    active_summaries: number;
    deleted_summaries: number;
    encrypted_summaries: number;
    by_type: { summary_type: SummaryType; count: number }[];
    avg_processing_time_ms: number | null;
  }> {
    const executor = client || getPool();

    const statsResult = await executor.query(
      `SELECT
        COUNT(*) as total_summaries,
        COUNT(*) FILTER (WHERE deleted = 0) as active_summaries,
        COUNT(*) FILTER (WHERE deleted = 1) as deleted_summaries,
        COUNT(*) FILTER (WHERE is_summary_encrypted = 1) as encrypted_summaries,
        AVG(processing_time_ms) FILTER (WHERE processing_time_ms IS NOT NULL) as avg_processing_time_ms
       FROM client_summaries.summaries
       WHERE user_id = $1`,
      [userId]
    );

    const typeResult = await executor.query<{ summary_type: SummaryType; count: string }>(
      `SELECT summary_type, COUNT(*) as count
       FROM client_summaries.summaries
       WHERE user_id = $1 AND deleted = 0
       GROUP BY summary_type
       ORDER BY summary_type`,
      [userId]
    );

    const stats = statsResult.rows[0];

    return {
      total_summaries: parseInt(stats.total_summaries, 10),
      active_summaries: parseInt(stats.active_summaries, 10),
      deleted_summaries: parseInt(stats.deleted_summaries, 10),
      encrypted_summaries: parseInt(stats.encrypted_summaries, 10),
      by_type: typeResult.rows.map(row => ({
        summary_type: row.summary_type,
        count: parseInt(row.count, 10)
      })),
      avg_processing_time_ms: stats.avg_processing_time_ms
        ? parseFloat(stats.avg_processing_time_ms)
        : null
    };
  }

  /**
   * Find summaries by sync version
   * Used for incremental sync operations
   *
   * @param userId - User ID
   * @param minVersion - Minimum sync version (inclusive)
   * @param limit - Maximum number of results
   * @param client - Optional database client
   * @returns Array of summaries with sync_version >= minVersion
   */
  async findBySyncVersion(
    userId: string,
    minVersion: number,
    limit: number = 100,
    client?: PoolClient
  ): Promise<Summary[]> {
    const executor = client || getPool();

    const result = await executor.query<Summary>(
      `SELECT * FROM client_summaries.summaries
       WHERE user_id = $1 AND sync_version >= $2
       ORDER BY sync_version ASC, created_at ASC
       LIMIT $3`,
      [userId, minVersion, limit]
    );

    return result.rows;
  }

  /**
   * Batch upsert summaries
   * Efficient for bulk operations during sync
   *
   * @param userId - User ID for all summaries
   * @param summaries - Array of summary data
   * @param client - Optional database client
   * @returns Number of summaries upserted
   */
  async batchUpsert(
    userId: string,
    summaries: SummaryData[],
    client?: PoolClient
  ): Promise<number> {
    if (summaries.length === 0) {
      return 0;
    }

    const executor = client || getPool();
    const now = Date.now();

    // Build values array for batch insert
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    summaries.forEach((summary, idx) => {
      const offset = idx * 17;
      placeholders.push(
        `($${paramIndex + offset}, $${paramIndex + offset + 1}, $${paramIndex + offset + 2}, ` +
        `$${paramIndex + offset + 3}, $${paramIndex + offset + 4}, $${paramIndex + offset + 5}, ` +
        `$${paramIndex + offset + 6}, $${paramIndex + offset + 7}, $${paramIndex + offset + 8}, ` +
        `$${paramIndex + offset + 9}, $${paramIndex + offset + 10}, $${paramIndex + offset + 11}, ` +
        `$${paramIndex + offset + 12}, $${paramIndex + offset + 13}, $${paramIndex + offset + 14}, ` +
        `$${paramIndex + offset + 15}, $${paramIndex + offset + 16})`
      );

      values.push(
        summary.id,
        userId,
        summary.transcription_id,
        summary.summary_text ?? null,
        summary.summary_text_encrypted ?? null,
        summary.is_summary_encrypted ?? 0,
        summary.summary_type ?? 'full',
        summary.processing_time_ms ?? null,
        summary.model_used ?? null,
        summary.backend_type ?? null,
        summary.pipeline_used ?? 0,
        summary.sync_version ?? 1,
        summary.checksum ?? null,
        summary.deleted ?? 0,
        summary.created_at,
        summary.updated_at,
        now
      );
    });

    const result = await executor.query(
      `INSERT INTO client_summaries.summaries (
        id, user_id, transcription_id, summary_text, summary_text_encrypted,
        is_summary_encrypted, summary_type, processing_time_ms, model_used,
        backend_type, pipeline_used, sync_version, checksum, deleted,
        created_at, updated_at, server_updated_at
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (id) DO UPDATE SET
        transcription_id = EXCLUDED.transcription_id,
        summary_text = EXCLUDED.summary_text,
        summary_text_encrypted = EXCLUDED.summary_text_encrypted,
        is_summary_encrypted = EXCLUDED.is_summary_encrypted,
        summary_type = EXCLUDED.summary_type,
        processing_time_ms = EXCLUDED.processing_time_ms,
        model_used = EXCLUDED.model_used,
        backend_type = EXCLUDED.backend_type,
        pipeline_used = EXCLUDED.pipeline_used,
        sync_version = EXCLUDED.sync_version,
        checksum = EXCLUDED.checksum,
        deleted = EXCLUDED.deleted,
        updated_at = EXCLUDED.updated_at,
        server_updated_at = EXCLUDED.server_updated_at`,
      values
    );

    return result.rowCount || 0;
  }
}

// Export singleton instance
export const summaryRepository = new SummaryRepository();
