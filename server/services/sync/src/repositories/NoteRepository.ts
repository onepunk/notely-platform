import { PoolClient } from 'pg';
import { getPool } from '../lib/database';

// ============================================================================
// Type Definitions
// ============================================================================

export interface NoteData {
  id: string;
  user_id: string;
  binder_id: string;
  title: string;
  content: string | null;
  sort_index: number;
  pinned: number; // 0 = false, 1 = true (matches SQLite)
  deleted: number; // 0 = false, 1 = true (matches SQLite)
  starred: number; // 0 = false, 1 = true (matches SQLite)
  archived: number; // 0 = false, 1 = true (matches SQLite)
  created_at: number; // milliseconds since epoch
  updated_at: number; // milliseconds since epoch
  deleted_at: number | null; // milliseconds since epoch
}

export interface NoteRevisionData {
  id?: string;
  note_id: string;
  user_id: string;
  title: string;
  lexical_json: string; // EXACT field name from desktop
  plaintext: string; // EXACT field name from desktop
  hash: string; // SHA-256 hash for content validation
  created_at: number; // milliseconds since epoch
}

export interface NoteRevision {
  id: string;
  note_id: string;
  user_id: string;
  title: string;
  lexical_json: string;
  plaintext: string;
  hash: string;
  created_at: number;
}

export interface Note {
  id: string;
  user_id: string;
  binder_id: string;
  title: string;
  content: string | null;
  sort_index: number;
  pinned: number;
  deleted: number;
  starred: number;
  archived: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

// ============================================================================
// Note CRUD Operations
// ============================================================================

/**
 * Insert or update a note
 * Uses ON CONFLICT to handle both inserts and updates
 */
export async function upsert(
  userId: string,
  note: NoteData,
  client?: PoolClient
): Promise<Note> {
  const executor = client || getPool();

  const result = await executor.query<Note>(
    `INSERT INTO client_notes.notes (
      id, user_id, binder_id, title, content, sort_index,
      pinned, deleted, starred, archived, created_at, updated_at, deleted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET
      binder_id = EXCLUDED.binder_id,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      sort_index = EXCLUDED.sort_index,
      pinned = EXCLUDED.pinned,
      deleted = EXCLUDED.deleted,
      starred = EXCLUDED.starred,
      archived = EXCLUDED.archived,
      updated_at = EXCLUDED.updated_at,
      deleted_at = EXCLUDED.deleted_at
    RETURNING
      id, user_id, binder_id, title, content, sort_index,
      pinned, deleted, starred, archived, created_at, updated_at, deleted_at`,
    [
      note.id,
      userId,
      note.binder_id,
      note.title,
      note.content,
      note.sort_index,
      note.pinned,
      note.deleted,
      note.starred,
      note.archived,
      note.created_at,
      note.updated_at,
      note.deleted_at
    ]
  );

  if (result.rows.length === 0) {
    throw new Error(`Failed to upsert note ${note.id}`);
  }

  return result.rows[0];
}

/**
 * Get a single note by ID
 * Only returns notes owned by the specified user
 */
export async function findById(
  userId: string,
  noteId: string,
  client?: PoolClient
): Promise<Note | null> {
  const executor = client || getPool();

  const result = await executor.query<Note>(
    `SELECT
      id, user_id, binder_id, title, content, sort_index,
      pinned, deleted, starred, archived, created_at, updated_at, deleted_at
    FROM client_notes.notes
    WHERE id = $1 AND user_id = $2`,
    [noteId, userId]
  );

  return result.rows[0] || null;
}

/**
 * Get all non-deleted notes in a specific binder
 * Ordered by sort_index for consistent ordering
 */
export async function findByBinder(
  userId: string,
  binderId: string,
  client?: PoolClient
): Promise<Note[]> {
  const executor = client || getPool();

  const result = await executor.query<Note>(
    `SELECT
      id, user_id, binder_id, title, content, sort_index,
      pinned, deleted, starred, archived, created_at, updated_at, deleted_at
    FROM client_notes.notes
    WHERE user_id = $1 AND binder_id = $2 AND deleted = 0
    ORDER BY sort_index ASC, created_at DESC`,
    [userId, binderId]
  );

  return result.rows;
}

/**
 * Get all non-deleted notes for a user
 * Useful for full sync operations
 */
export async function findByUser(
  userId: string,
  client?: PoolClient
): Promise<Note[]> {
  const executor = client || getPool();

  const result = await executor.query<Note>(
    `SELECT
      id, user_id, binder_id, title, content, sort_index,
      pinned, deleted, starred, archived, created_at, updated_at, deleted_at
    FROM client_notes.notes
    WHERE user_id = $1 AND deleted = 0
    ORDER BY binder_id, sort_index ASC, created_at DESC`,
    [userId]
  );

  return result.rows;
}

/**
 * Soft delete a note (mark as deleted without removing from database)
 * Sets deleted = 1 and records deletion timestamp
 */
export async function softDelete(
  userId: string,
  noteId: string,
  deletedAt?: number,
  client?: PoolClient
): Promise<void> {
  const executor = client || getPool();
  const timestamp = deletedAt || Date.now();

  const result = await executor.query(
    `UPDATE client_notes.notes
    SET deleted = 1, deleted_at = $3, updated_at = $3
    WHERE id = $1 AND user_id = $2`,
    [noteId, userId, timestamp]
  );

  if (result.rowCount === 0) {
    throw new Error(`Note ${noteId} not found or not owned by user ${userId}`);
  }
}

/**
 * Permanently delete a note from the database
 * WARNING: This is irreversible and should only be used for GDPR compliance
 */
export async function hardDelete(
  userId: string,
  noteId: string,
  client?: PoolClient
): Promise<void> {
  const executor = client || getPool();

  const result = await executor.query(
    `DELETE FROM client_notes.notes
    WHERE id = $1 AND user_id = $2`,
    [noteId, userId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Note ${noteId} not found or not owned by user ${userId}`);
  }
}

// ============================================================================
// Note Revision Operations
// ============================================================================

/**
 * Create a new revision for a note
 * Revisions are immutable once created
 */
export async function createRevision(
  revision: NoteRevisionData,
  client?: PoolClient
): Promise<NoteRevision> {
  const executor = client || getPool();

  const result = await executor.query<NoteRevision>(
    `INSERT INTO client_notes.note_revisions (
      note_id, user_id, title, lexical_json, plaintext, hash, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING
      id, note_id, user_id, title, lexical_json, plaintext, hash, created_at`,
    [
      revision.note_id,
      revision.user_id,
      revision.title,
      revision.lexical_json,
      revision.plaintext,
      revision.hash,
      revision.created_at
    ]
  );

  if (result.rows.length === 0) {
    throw new Error(`Failed to create revision for note ${revision.note_id}`);
  }

  return result.rows[0];
}

/**
 * Get revision history for a note
 * Returns newest revisions first by default
 */
export async function getRevisions(
  noteId: string,
  limit: number = 50,
  client?: PoolClient
): Promise<NoteRevision[]> {
  const executor = client || getPool();

  const result = await executor.query<NoteRevision>(
    `SELECT
      id, note_id, user_id, title, lexical_json, plaintext, hash, created_at
    FROM client_notes.note_revisions
    WHERE note_id = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [noteId, limit]
  );

  return result.rows;
}

/**
 * Get the most recent revision for a note
 * Useful for comparing current content with latest saved revision
 */
export async function getLatestRevision(
  noteId: string,
  client?: PoolClient
): Promise<NoteRevision | null> {
  const executor = client || getPool();

  const result = await executor.query<NoteRevision>(
    `SELECT
      id, note_id, user_id, title, lexical_json, plaintext, hash, created_at
    FROM client_notes.note_revisions
    WHERE note_id = $1
    ORDER BY created_at DESC
    LIMIT 1`,
    [noteId]
  );

  return result.rows[0] || null;
}

/**
 * Get a revision by its content hash
 * Useful for deduplication - avoids creating duplicate revisions
 */
export async function getRevisionByHash(
  noteId: string,
  hash: string,
  client?: PoolClient
): Promise<NoteRevision | null> {
  const executor = client || getPool();

  const result = await executor.query<NoteRevision>(
    `SELECT
      id, note_id, user_id, title, lexical_json, plaintext, hash, created_at
    FROM client_notes.note_revisions
    WHERE note_id = $1 AND hash = $2`,
    [noteId, hash]
  );

  return result.rows[0] || null;
}

/**
 * Get the count of revisions for a note
 * Useful for implementing revision limits or cleanup strategies
 */
export async function getRevisionCount(
  noteId: string,
  client?: PoolClient
): Promise<number> {
  const executor = client || getPool();

  const result = await executor.query<{ count: string }>(
    `SELECT COUNT(*) as count
    FROM client_notes.note_revisions
    WHERE note_id = $1`,
    [noteId]
  );

  return parseInt(result.rows[0].count, 10);
}

/**
 * Batch upsert notes for efficient sync operations
 * Useful when syncing multiple notes at once
 */
export async function batchUpsert(
  userId: string,
  notes: NoteData[],
  client?: PoolClient
): Promise<Note[]> {
  if (notes.length === 0) {
    return [];
  }

  const executor = client || getPool();

  // Build multi-row insert with parameterized values
  const values: any[] = [];
  const placeholders: string[] = [];
  const fieldsPerRow = 13;

  notes.forEach((note, idx) => {
    const offset = idx * fieldsPerRow;
    const params = Array.from(
      { length: fieldsPerRow },
      (_, i) => `$${offset + i + 1}`
    );
    placeholders.push(`(${params.join(', ')})`);

    values.push(
      note.id,
      userId,
      note.binder_id,
      note.title,
      note.content,
      note.sort_index,
      note.pinned,
      note.deleted,
      note.starred,
      note.archived,
      note.created_at,
      note.updated_at,
      note.deleted_at
    );
  });

  const query = `
    INSERT INTO client_notes.notes (
      id, user_id, binder_id, title, content, sort_index,
      pinned, deleted, starred, archived, created_at, updated_at, deleted_at
    ) VALUES ${placeholders.join(', ')}
    ON CONFLICT (id) DO UPDATE SET
      binder_id = EXCLUDED.binder_id,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      sort_index = EXCLUDED.sort_index,
      pinned = EXCLUDED.pinned,
      deleted = EXCLUDED.deleted,
      starred = EXCLUDED.starred,
      archived = EXCLUDED.archived,
      updated_at = EXCLUDED.updated_at,
      deleted_at = EXCLUDED.deleted_at
    RETURNING
      id, user_id, binder_id, title, content, sort_index,
      pinned, deleted, starred, archived, created_at, updated_at, deleted_at
  `;

  const result = await executor.query<Note>(query, values);
  return result.rows;
}
