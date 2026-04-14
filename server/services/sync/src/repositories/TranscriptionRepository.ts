import { PoolClient } from 'pg';
import { getPool } from '../lib/database';

/**
 * Transcription status
 * - recording: Active recording in progress
 * - completing: Finalizing the transcription
 * - completed: Transcription finished
 */
export type TranscriptionStatus = 'recording' | 'completing' | 'completed';

/**
 * Transcription entity matching the desktop SQLite schema and V30 migration
 */
export interface Transcription {
  id: string;
  user_id: string;
  note_id: string | null;
  binder_id: string | null;
  transcription_text: string | null;
  language: string;
  status: TranscriptionStatus;
  start_time: number | null;
  end_time: number | null;
  duration_ms: number | null;
  char_count: number | null;
  word_count: number | null;
  deleted: number; // 0 or 1 to match SQLite
  sync_version: number;
  created_at: number; // milliseconds since epoch
  updated_at: number; // milliseconds since epoch
}

/**
 * Input data for upserting a transcription
 */
export interface TranscriptionData {
  id: string;
  note_id?: string | null;
  binder_id?: string | null;
  transcription_text?: string | null;
  language?: string;
  status?: TranscriptionStatus;
  start_time?: number | null;
  end_time?: number | null;
  duration_ms?: number | null;
  char_count?: number | null;
  word_count?: number | null;
  deleted?: number;
  sync_version?: number;
  created_at?: number;
  updated_at?: number;
}

/**
 * Repository for managing transcription CRUD operations
 * Handles client_transcripts.transcriptions table operations with proper multi-tenancy
 */
export class TranscriptionRepository {
  /**
   * Upsert a transcription (insert or update)
   * Uses ON CONFLICT to handle both insert and update cases
   */
  async upsert(
    userId: string,
    transcription: TranscriptionData,
    client?: PoolClient
  ): Promise<Transcription> {
    const executor = client || getPool();
    const now = Date.now();

    const result = await executor.query<Transcription>(
      `INSERT INTO client_transcripts.transcriptions (
        id, user_id, note_id, binder_id, transcription_text, language, status,
        start_time, end_time, duration_ms, char_count, word_count, deleted,
        sync_version, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        note_id = EXCLUDED.note_id,
        binder_id = EXCLUDED.binder_id,
        transcription_text = EXCLUDED.transcription_text,
        language = EXCLUDED.language,
        status = EXCLUDED.status,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        duration_ms = EXCLUDED.duration_ms,
        char_count = EXCLUDED.char_count,
        word_count = EXCLUDED.word_count,
        deleted = EXCLUDED.deleted,
        sync_version = EXCLUDED.sync_version,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        transcription.id,
        userId,
        transcription.note_id ?? null,
        transcription.binder_id ?? null,
        transcription.transcription_text ?? null,
        transcription.language ?? 'en',
        transcription.status ?? 'recording',
        transcription.start_time ?? null,
        transcription.end_time ?? null,
        transcription.duration_ms ?? null,
        transcription.char_count ?? null,
        transcription.word_count ?? null,
        transcription.deleted ?? 0,
        transcription.sync_version ?? 1,
        transcription.created_at ?? now,
        transcription.updated_at ?? now
      ]
    );

    if (result.rows.length === 0) {
      throw new Error('Failed to upsert transcription');
    }

    return result.rows[0];
  }

  /**
   * Find a transcription by ID
   * Enforces user_id check for multi-tenancy
   */
  async findById(
    userId: string,
    transcriptionId: string,
    client?: PoolClient
  ): Promise<Transcription | null> {
    const executor = client || getPool();

    const result = await executor.query<Transcription>(
      `SELECT * FROM client_transcripts.transcriptions
       WHERE id = $1 AND user_id = $2`,
      [transcriptionId, userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Find all transcriptions for a user (excluding soft-deleted)
   * Returns non-deleted transcriptions ordered by created_at DESC
   */
  async findByUser(
    userId: string,
    client?: PoolClient
  ): Promise<Transcription[]> {
    const executor = client || getPool();

    const result = await executor.query<Transcription>(
      `SELECT * FROM client_transcripts.transcriptions
       WHERE user_id = $1 AND deleted = 0
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  /**
   * Find transcriptions linked to a specific note
   * Returns non-deleted transcriptions for the note
   */
  async findByNote(
    userId: string,
    noteId: string,
    client?: PoolClient
  ): Promise<Transcription[]> {
    const executor = client || getPool();

    const result = await executor.query<Transcription>(
      `SELECT * FROM client_transcripts.transcriptions
       WHERE user_id = $1 AND note_id = $2 AND deleted = 0
       ORDER BY created_at DESC`,
      [userId, noteId]
    );

    return result.rows;
  }

  /**
   * Find transcriptions linked to a specific binder
   * Returns non-deleted transcriptions for the binder
   */
  async findByBinder(
    userId: string,
    binderId: string,
    client?: PoolClient
  ): Promise<Transcription[]> {
    const executor = client || getPool();

    const result = await executor.query<Transcription>(
      `SELECT * FROM client_transcripts.transcriptions
       WHERE user_id = $1 AND binder_id = $2 AND deleted = 0
       ORDER BY created_at DESC`,
      [userId, binderId]
    );

    return result.rows;
  }

  /**
   * Soft delete a transcription (set deleted = 1)
   * Updates sync_version and updated_at for sync protocol
   */
  async softDelete(
    userId: string,
    transcriptionId: string,
    client?: PoolClient
  ): Promise<Transcription | null> {
    const executor = client || getPool();
    const now = Date.now();

    const result = await executor.query<Transcription>(
      `UPDATE client_transcripts.transcriptions
       SET deleted = 1,
           sync_version = sync_version + 1,
           updated_at = $3
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [transcriptionId, userId, now]
    );

    return result.rows[0] || null;
  }

  /**
   * Hard delete a transcription (permanent removal)
   * Use only for GDPR compliance or data purging
   */
  async hardDelete(
    userId: string,
    transcriptionId: string,
    client?: PoolClient
  ): Promise<boolean> {
    const executor = client || getPool();

    const result = await executor.query(
      `DELETE FROM client_transcripts.transcriptions
       WHERE id = $1 AND user_id = $2`,
      [transcriptionId, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Find transcriptions by status
   * Useful for finding active recordings or processing transcriptions
   */
  async findByStatus(
    userId: string,
    status: TranscriptionStatus,
    client?: PoolClient
  ): Promise<Transcription[]> {
    const executor = client || getPool();

    const result = await executor.query<Transcription>(
      `SELECT * FROM client_transcripts.transcriptions
       WHERE user_id = $1 AND status = $2 AND deleted = 0
       ORDER BY created_at DESC`,
      [userId, status]
    );

    return result.rows;
  }

  /**
   * Find transcriptions within a time range
   * Useful for querying transcriptions by date
   */
  async findByTimeRange(
    userId: string,
    startTime: number,
    endTime: number,
    client?: PoolClient
  ): Promise<Transcription[]> {
    const executor = client || getPool();

    const result = await executor.query<Transcription>(
      `SELECT * FROM client_transcripts.transcriptions
       WHERE user_id = $1
         AND deleted = 0
         AND start_time >= $2
         AND start_time <= $3
       ORDER BY start_time DESC`,
      [userId, startTime, endTime]
    );

    return result.rows;
  }

  /**
   * Count transcriptions for a user
   * Returns count of non-deleted transcriptions
   */
  async countByUser(
    userId: string,
    client?: PoolClient
  ): Promise<number> {
    const executor = client || getPool();

    const result = await executor.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM client_transcripts.transcriptions
       WHERE user_id = $1 AND deleted = 0`,
      [userId]
    );

    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get transcription statistics for a user
   */
  async getStats(
    userId: string,
    client?: PoolClient
  ): Promise<{
    total_count: number;
    total_duration_ms: number;
    total_char_count: number;
    total_word_count: number;
    by_status: Record<TranscriptionStatus, number>;
  }> {
    const executor = client || getPool();

    const result = await executor.query<{
      total_count: string;
      total_duration_ms: string;
      total_char_count: string;
      total_word_count: string;
      recording_count: string;
      completing_count: string;
      completed_count: string;
    }>(
      `SELECT
        COUNT(*) as total_count,
        COALESCE(SUM(duration_ms), 0) as total_duration_ms,
        COALESCE(SUM(char_count), 0) as total_char_count,
        COALESCE(SUM(word_count), 0) as total_word_count,
        COUNT(*) FILTER (WHERE status = 'recording') as recording_count,
        COUNT(*) FILTER (WHERE status = 'completing') as completing_count,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_count
       FROM client_transcripts.transcriptions
       WHERE user_id = $1 AND deleted = 0`,
      [userId]
    );

    const row = result.rows[0];
    return {
      total_count: parseInt(row.total_count, 10),
      total_duration_ms: parseInt(row.total_duration_ms, 10),
      total_char_count: parseInt(row.total_char_count, 10),
      total_word_count: parseInt(row.total_word_count, 10),
      by_status: {
        recording: parseInt(row.recording_count, 10),
        completing: parseInt(row.completing_count, 10),
        completed: parseInt(row.completed_count, 10)
      }
    };
  }
}

// Export a singleton instance
export const transcriptionRepository = new TranscriptionRepository();
