import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../lib/database';

export interface Summary {
  id: string;
  user_id: string;
  entity_id: string;
  note_id: string;
  transcription_id: string;
  summary_text: string;
  model_version?: string;
  created_at: Date;
  updated_at: Date;
  deleted: boolean;
  version: number;
  server_updated_at: number | null;
}

export interface CreateSummaryInput {
  userId: string;
  transcriptionId: string;
  summaryText: string;
  modelVersion?: string;
}

export async function createSummary(input: CreateSummaryInput): Promise<Summary> {
  const pool = getPool();
  const id = uuidv4();
  const entityId = uuidv4();
  const now = new Date();
  const serverUpdatedAt = now.getTime();

  // Look up note_id from the synced transcription
  const transcriptionResult = await pool.query(
    'SELECT note_id FROM client_sync.transcription_content WHERE user_id = $1 AND entity_id = $2',
    [input.userId, input.transcriptionId]
  );

  const noteId = transcriptionResult.rows[0]?.note_id;
  if (!noteId) {
    throw new Error(`No note_id found for transcription: ${input.transcriptionId}`);
  }

  // Insert into summary_content table with version tracking for cursor-based sync
  const result = await pool.query(
    `INSERT INTO client_sync.summary_content (
      id, user_id, entity_id, note_id, transcription_id, summary_text,
      model_version, created_at, updated_at, deleted, version, server_updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      id,
      input.userId,
      entityId,
      noteId,
      input.transcriptionId,
      input.summaryText,
      input.modelVersion || null,
      now,
      now,
      false,
      1,
      serverUpdatedAt,
    ]
  );

  const summary = result.rows[0];

  // Record in sync_changes for cursor-based sync
  await recordSyncChange(input.userId, entityId, 'summaries', 'upsert', 1, serverUpdatedAt);

  return summary;
}

async function recordSyncChange(
  userId: string,
  entityId: string,
  entityType: string,
  op: 'upsert' | 'delete',
  version: number,
  serverUpdatedAt: number
): Promise<void> {
  const pool = getPool();

  await pool.query(
    `INSERT INTO client_sync.sync_changes (
      user_id, entity_type, entity_id, op, version, server_updated_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [userId, entityType, entityId, op, version, serverUpdatedAt]
  );
}

export async function getSummaryById(id: string, userId: string): Promise<Summary | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM client_sync.summary_content
     WHERE id = $1 AND user_id = $2 AND deleted = false`,
    [id, userId]
  );
  return result.rows[0] || null;
}

export async function getSummaryByEntityId(entityId: string, userId: string): Promise<Summary | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM client_sync.summary_content
     WHERE entity_id = $1 AND user_id = $2 AND deleted = false`,
    [entityId, userId]
  );
  return result.rows[0] || null;
}

export async function getSummariesByNoteId(
  noteId: string,
  userId: string
): Promise<Summary[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM client_sync.summary_content
     WHERE note_id = $1 AND user_id = $2 AND deleted = false
     ORDER BY created_at DESC`,
    [noteId, userId]
  );
  return result.rows;
}

export async function getSummariesByTranscriptionId(
  transcriptionId: string,
  userId: string
): Promise<Summary[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM client_sync.summary_content
     WHERE transcription_id = $1 AND user_id = $2 AND deleted = false
     ORDER BY created_at DESC`,
    [transcriptionId, userId]
  );
  return result.rows;
}

export async function deleteSummary(id: string, userId: string): Promise<boolean> {
  const pool = getPool();

  const existing = await getSummaryById(id, userId);
  if (!existing) {
    return false;
  }

  const serverUpdatedAt = Date.now();
  const newVersion = (existing.version || 1) + 1;

  // Soft delete with version increment
  await pool.query(
    `UPDATE client_sync.summary_content
     SET deleted = true, updated_at = NOW(), version = $3, server_updated_at = $4
     WHERE id = $1 AND user_id = $2`,
    [id, userId, newVersion, serverUpdatedAt]
  );

  // Record deletion in sync_changes
  await recordSyncChange(userId, existing.entity_id, 'summaries', 'delete', newVersion, serverUpdatedAt);

  return true;
}
