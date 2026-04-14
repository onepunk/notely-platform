/**
 * Joplin-Style Sync Endpoint
 *
 * POST /api/sync - Single endpoint for push and delta pull
 *
 * Reference: notely-platform/docs/SYNC_JOPLIN.md
 *           notely-platform/docs/SYNC_JOPLIN_PHASE0_SPEC.md
 */

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getPool } from '../../lib/database';
import { PoolClient } from 'pg';
import { publishSyncNotification } from '../../services/syncNotificationPublisher';
import * as BinderValidator from '../../validators/BinderValidator';
import * as NoteValidator from '../../validators/NoteValidator';
import * as TranscriptionValidator from '../../validators/TranscriptionValidator';
import * as SummaryValidator from '../../validators/SummaryValidator';
import * as TagValidator from '../../validators/TagValidator';
import * as NoteTagValidator from '../../validators/NoteTagValidator';

export const syncRouter = Router();

// ============================================================================
// Types
// ============================================================================

type EntityType = 'binders' | 'notes' | 'transcriptions' | 'summaries' | 'tags' | 'note_tags';
type Operation = 'upsert' | 'delete';
type PushResultStatus = 'applied' | 'conflict' | 'rejected' | 'ignored';

interface PushItem {
  mutation_id: string;
  entity_type: EntityType;
  entity_id: string;
  op: Operation;
  base_version: number | null;
  entity?: Record<string, unknown>;
}

interface SyncRequest {
  device_id: string;
  device_name?: string;
  cursor: number;
  client_time_ms: number;
  push?: PushItem[];
  limit?: number;
  snapshot?: boolean;
  snapshot_token?: string | null;
}

interface PushResult {
  mutation_id: string;
  entity_type: EntityType;
  entity_id: string;
  status: PushResultStatus;
  version?: number;
  server_updated_at?: number;
  canonical_entity_id?: string;
  reason?: string;
  server_version?: number;
  server_entity?: Record<string, unknown>;
}

interface SyncItem {
  seq: number;
  entity_type: EntityType;
  entity_id: string;
  op: Operation;
  version: number;
  server_updated_at: number;
  entity: Record<string, unknown>;
}

interface SyncResponse {
  cursor: number;
  has_more: boolean;
  requires_snapshot?: boolean;
  oldest_available_cursor?: number;
  snapshot_token?: string | null;
  snapshot_done?: boolean;
  server_time_ms: number;
  device_time_skew_ms: number;
  clock_suspect: boolean;
  items: SyncItem[];
  results: PushResult[];
}

// ============================================================================
// Constants
// ============================================================================

const MAX_PUSH_SIZE = 100;
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;
const CLOCK_SKEW_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const FUTURE_TIMESTAMP_CLAMP_MS = 10 * 60 * 1000; // 10 minutes

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ENTITY_TYPES: EntityType[] = ['binders', 'notes', 'transcriptions', 'summaries', 'tags', 'note_tags'];

// Entity type to table name mapping
const ENTITY_TABLE_MAP: Record<EntityType, string> = {
  binders: 'client_sync.binder_content',
  notes: 'client_sync.note_content',
  transcriptions: 'client_sync.transcription_content',
  summaries: 'client_sync.summary_content',
  tags: 'client_sync.tag_content',
  note_tags: 'client_sync.note_tag_content'
};

// Snapshot ordering (dependency-safe)
const SNAPSHOT_ORDER: EntityType[] = ['binders', 'notes', 'transcriptions', 'summaries', 'tags', 'note_tags'];

// ============================================================================
// Request Validation
// ============================================================================

interface ValidationError {
  field: string;
  message: string;
}

function validateSyncRequest(body: unknown): { valid: boolean; errors: ValidationError[]; request?: SyncRequest } {
  const errors: ValidationError[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: [{ field: 'body', message: 'Request body must be an object' }] };
  }

  const req = body as Record<string, unknown>;

  // device_id (required)
  if (!req.device_id || typeof req.device_id !== 'string') {
    errors.push({ field: 'device_id', message: 'device_id is required and must be a string' });
  } else if (!UUID_REGEX.test(req.device_id)) {
    errors.push({ field: 'device_id', message: 'device_id must be a valid UUID' });
  }

  // cursor (required)
  if (req.cursor === undefined || req.cursor === null) {
    errors.push({ field: 'cursor', message: 'cursor is required' });
  } else if (typeof req.cursor !== 'number' || !Number.isInteger(req.cursor) || req.cursor < 0) {
    errors.push({ field: 'cursor', message: 'cursor must be a non-negative integer' });
  }

  // client_time_ms (required)
  if (!req.client_time_ms || typeof req.client_time_ms !== 'number') {
    errors.push({ field: 'client_time_ms', message: 'client_time_ms is required and must be a number' });
  } else if (req.client_time_ms <= 0) {
    errors.push({ field: 'client_time_ms', message: 'client_time_ms must be a positive number' });
  }

  // limit (optional)
  if (req.limit !== undefined && req.limit !== null) {
    if (typeof req.limit !== 'number' || !Number.isInteger(req.limit) || req.limit <= 0) {
      errors.push({ field: 'limit', message: 'limit must be a positive integer' });
    } else if (req.limit > MAX_LIMIT) {
      errors.push({ field: 'limit', message: `limit cannot exceed ${MAX_LIMIT}` });
    }
  }

  // push (optional array)
  if (req.push !== undefined) {
    if (!Array.isArray(req.push)) {
      errors.push({ field: 'push', message: 'push must be an array' });
    } else if (req.push.length > MAX_PUSH_SIZE) {
      errors.push({ field: 'push', message: `push array cannot exceed ${MAX_PUSH_SIZE} items` });
    } else {
      for (let i = 0; i < req.push.length; i++) {
        const item = req.push[i] as Record<string, unknown>;
        const prefix = `push[${i}]`;

        if (!item.mutation_id || typeof item.mutation_id !== 'string') {
          errors.push({ field: `${prefix}.mutation_id`, message: 'mutation_id is required and must be a string' });
        } else if (!UUID_REGEX.test(item.mutation_id)) {
          errors.push({ field: `${prefix}.mutation_id`, message: 'mutation_id must be a valid UUID' });
        }

        if (!item.entity_type || typeof item.entity_type !== 'string') {
          errors.push({ field: `${prefix}.entity_type`, message: 'entity_type is required and must be a string' });
        } else if (!VALID_ENTITY_TYPES.includes(item.entity_type as EntityType)) {
          errors.push({ field: `${prefix}.entity_type`, message: `entity_type must be one of: ${VALID_ENTITY_TYPES.join(', ')}` });
        }

        if (!item.entity_id || typeof item.entity_id !== 'string') {
          errors.push({ field: `${prefix}.entity_id`, message: 'entity_id is required and must be a string' });
        } else if (!UUID_REGEX.test(item.entity_id)) {
          errors.push({ field: `${prefix}.entity_id`, message: 'entity_id must be a valid UUID' });
        }

        if (!item.op || typeof item.op !== 'string') {
          errors.push({ field: `${prefix}.op`, message: 'op is required and must be a string' });
        } else if (item.op !== 'upsert' && item.op !== 'delete') {
          errors.push({ field: `${prefix}.op`, message: 'op must be "upsert" or "delete"' });
        }

        // base_version can be null (for creates) or a non-negative integer (for updates/deletes)
        if (item.base_version !== null && item.base_version !== undefined) {
          if (typeof item.base_version !== 'number' || !Number.isInteger(item.base_version) || item.base_version < 1) {
            errors.push({ field: `${prefix}.base_version`, message: 'base_version must be null or a positive integer' });
          }
        }

        // entity required for upsert, not for delete
        if (item.op === 'upsert' && (!item.entity || typeof item.entity !== 'object')) {
          errors.push({ field: `${prefix}.entity`, message: 'entity is required for upsert operations' });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    request: {
      device_id: req.device_id as string,
      device_name: req.device_name as string | undefined,
      cursor: req.cursor as number,
      client_time_ms: req.client_time_ms as number,
      push: req.push as PushItem[] | undefined,
      limit: req.limit as number | undefined,
      snapshot: req.snapshot as boolean | undefined,
      snapshot_token: req.snapshot_token as string | null | undefined
    }
  };
}

// ============================================================================
// Clock Skew Management
// ============================================================================

interface DeviceCursorUpdate {
  last_cursor: number;
  device_time_skew_ms: number;
  clock_suspect: boolean;
  last_client_time_ms: number;
}

async function updateDeviceCursorWithSkew(
  client: PoolClient,
  userId: string,
  deviceId: string,
  deviceName: string,
  update: DeviceCursorUpdate
): Promise<void> {
  await client.query(`
    INSERT INTO client_sync.device_cursors (
      user_id, device_id, device_name, last_cursor, device_time_skew_ms,
      clock_suspect, last_client_time_ms, last_sync_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (user_id, device_id) DO UPDATE SET
      device_name = EXCLUDED.device_name,
      last_cursor = EXCLUDED.last_cursor,
      device_time_skew_ms = EXCLUDED.device_time_skew_ms,
      clock_suspect = EXCLUDED.clock_suspect,
      last_client_time_ms = EXCLUDED.last_client_time_ms,
      last_sync_at = NOW(),
      updated_at = NOW()
  `, [
    userId,
    deviceId,
    deviceName,
    update.last_cursor,
    update.device_time_skew_ms,
    update.clock_suspect,
    update.last_client_time_ms
  ]);
}

// ============================================================================
// Conflicts Binder Management
// ============================================================================

async function ensureConflictsBinder(
  client: PoolClient,
  userId: string,
  serverTimeMs: number
): Promise<string> {
  // Check if conflicts binder exists
  const existing = await client.query<{ entity_id: string }>(
    `SELECT entity_id FROM client_sync.binder_content
     WHERE user_id = $1 AND is_conflicts = TRUE
     LIMIT 1`,
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].entity_id;
  }

  // Create the conflicts binder
  // Use try/catch to handle race condition where another concurrent sync creates it first
  const binderId = randomUUID();

  try {
    await client.query(`
      INSERT INTO client_sync.binder_content (
        user_id, entity_id, name, binder_type, is_conflicts,
        sort_index, created_at, updated_at, deleted, version, server_updated_at
      ) VALUES ($1, $2, 'Conflicts', 'SYSTEM', TRUE, -1, NOW(), NOW(), FALSE, 1, $3)
    `, [userId, binderId, serverTimeMs]);

    // Record the change in sync_changes
    await client.query(`
      INSERT INTO client_sync.sync_changes (user_id, entity_type, entity_id, op, version, server_updated_at)
      VALUES ($1, 'binders', $2, 'upsert', 1, $3)
    `, [userId, binderId, serverTimeMs]);

    console.log('[sync] Created Conflicts binder', { userId, binderId });
    return binderId;
  } catch (error: any) {
    // Handle unique constraint violation from idx_binder_content_conflicts_unique
    // This can happen when concurrent sync requests both try to create the conflicts binder
    if (error.code === '23505' && error.constraint === 'idx_binder_content_conflicts_unique') {
      console.log('[sync] Conflicts binder already exists (race condition handled)', { userId });
      // Re-query to get the existing conflicts binder
      const requery = await client.query<{ entity_id: string }>(
        `SELECT entity_id FROM client_sync.binder_content
         WHERE user_id = $1 AND is_conflicts = TRUE
         LIMIT 1`,
        [userId]
      );
      if (requery.rows.length > 0) {
        return requery.rows[0].entity_id;
      }
      // If constraint was violated but re-query found nothing, throw error
      // This is an extremely rare edge case (e.g., concurrent rollback or database inconsistency)
      throw new Error(
        `Conflicts binder unique constraint violated but re-query returned no results for user ${userId}. ` +
        `This may indicate a race condition or database inconsistency.`
      );
    }
    // Re-throw other errors
    throw error;
  }
}

// ============================================================================
// Idempotency Management
// ============================================================================

interface IdempotencyRecord {
  status: PushResultStatus;
  entity_type: EntityType;
  entity_id: string;
  op: Operation;
  base_version: number | null;
  applied_seq: number | null;
  // Result metadata for proper replay
  reason: string | null;
  server_version: number | null;
  result_server_updated_at: number | null;
  result_version: number | null;
  canonical_entity_id: string | null;
  server_entity: Record<string, unknown> | null;
}

async function checkIdempotency(
  client: PoolClient,
  userId: string,
  deviceId: string,
  mutationId: string,
  pushItem: PushItem
): Promise<{ isDuplicate: boolean; record?: IdempotencyRecord; mismatch?: boolean }> {
  const result = await client.query<IdempotencyRecord>(
    `SELECT status, entity_type, entity_id, op, base_version, applied_seq,
            reason, server_version, result_server_updated_at, result_version,
            canonical_entity_id, server_entity
     FROM client_sync.sync_mutations
     WHERE user_id = $1 AND device_id = $2 AND mutation_id = $3`,
    [userId, deviceId, mutationId]
  );

  if (result.rows.length === 0) {
    return { isDuplicate: false };
  }

  const record = result.rows[0];

  // Check for payload mismatch
  if (
    record.entity_type !== pushItem.entity_type ||
    record.entity_id !== pushItem.entity_id ||
    record.op !== pushItem.op ||
    record.base_version !== pushItem.base_version
  ) {
    return { isDuplicate: true, record, mismatch: true };
  }

  return { isDuplicate: true, record, mismatch: false };
}

interface MutationResultMetadata {
  reason?: string;
  server_version?: number;
  result_server_updated_at?: number;
  result_version?: number;
  canonical_entity_id?: string;
  server_entity?: Record<string, unknown>;
}

async function recordMutation(
  client: PoolClient,
  userId: string,
  deviceId: string,
  pushItem: PushItem,
  status: PushResultStatus,
  appliedSeq: number | null,
  metadata?: MutationResultMetadata
): Promise<void> {
  await client.query(`
    INSERT INTO client_sync.sync_mutations (
      user_id, device_id, mutation_id, entity_type, entity_id, op, base_version, status, applied_seq,
      reason, server_version, result_server_updated_at, result_version, canonical_entity_id, server_entity
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (user_id, device_id, mutation_id) DO NOTHING
  `, [
    userId,
    deviceId,
    pushItem.mutation_id,
    pushItem.entity_type,
    pushItem.entity_id,
    pushItem.op,
    pushItem.base_version,
    status,
    appliedSeq,
    metadata?.reason ?? null,
    metadata?.server_version ?? null,
    metadata?.result_server_updated_at ?? null,
    metadata?.result_version ?? null,
    metadata?.canonical_entity_id ?? null,
    metadata?.server_entity ? JSON.stringify(metadata.server_entity) : null
  ]);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize various truthy values to boolean.
 * Handles: true, 1, "true", "1", "TRUE", etc.
 */
function normalizeBoolean(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    return lower === 'true' || lower === '1';
  }
  return Boolean(val);
}

// ============================================================================
// Entity Validators
// ============================================================================

function getValidator(entityType: EntityType): ((data: unknown) => { valid: boolean; errors: string[] }) | null {
  switch (entityType) {
    case 'binders': return BinderValidator.validate;
    case 'notes': return NoteValidator.validate;
    case 'transcriptions': return TranscriptionValidator.validate;
    case 'summaries': return SummaryValidator.validate;
    case 'tags': return TagValidator.validate;
    case 'note_tags': return NoteTagValidator.validate;
    default: return null;
  }
}

// ============================================================================
// Entity Persistence
// ============================================================================

function msToTimestamp(ms: number): Date {
  return new Date(ms);
}

/**
 * Upserts an entity with optimistic concurrency control.
 * For updates (newVersion > 1), includes a WHERE clause to guard against concurrent modifications.
 * Returns true if the operation succeeded, false if it failed due to concurrent modification.
 */
async function upsertEntity(
  client: PoolClient,
  userId: string,
  entityType: EntityType,
  entityId: string,
  entity: Record<string, unknown>,
  newVersion: number,
  serverUpdatedAt: number
): Promise<boolean> {
  // For updates (newVersion > 1), add version guard to prevent concurrent overwrites
  const isUpdate = newVersion > 1;
  const expectedVersion = isUpdate ? newVersion - 1 : null;

  let result;

  switch (entityType) {
    case 'binders':
      // For updates, add WHERE clause to guard against concurrent modifications
      if (isUpdate) {
        result = await client.query(`
          UPDATE client_sync.binder_content SET
            name = $3,
            sort_index = $4,
            color = $5,
            icon = $6,
            is_team_shared = $7,
            binder_type = $8,
            created_at = $9,
            updated_at = $10,
            deleted = $11,
            version = $12,
            server_updated_at = $13
          WHERE user_id = $1 AND entity_id = $2 AND version = $14
        `, [
          userId,
          entityId,
          entity.name,
          entity.sort_index ?? 0,
          entity.color ?? null,
          entity.icon ?? null,
          entity.is_team_shared ?? false,
          entity.binder_type ?? 'USER',
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt,
          expectedVersion
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false; // Concurrent modification detected
        }
      } else {
        // For creates, use INSERT with ON CONFLICT DO NOTHING
        // Note: is_conflicts is always set to FALSE here because:
        // 1. The system Conflicts binder is created by ensureConflictsBinder()
        // 2. Client-pushed binders with is_conflicts=true are redirected by deduplication
        // 3. This prevents unique constraint violations on idx_binder_content_conflicts_unique
        result = await client.query(`
          INSERT INTO client_sync.binder_content (
            user_id, entity_id, name, sort_index, color, icon,
            is_team_shared, binder_type, created_at, updated_at,
            deleted, version, server_updated_at, is_conflicts
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, FALSE)
          ON CONFLICT (user_id, entity_id) DO NOTHING
        `, [
          userId,
          entityId,
          entity.name,
          entity.sort_index ?? 0,
          entity.color ?? null,
          entity.icon ?? null,
          entity.is_team_shared ?? false,
          entity.binder_type ?? 'USER',
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false; // Entity already exists (concurrent create)
        }
      }
      break;

    case 'notes':
      if (isUpdate) {
        result = await client.query(`
          UPDATE client_sync.note_content SET
            binder_id = $3,
            title = $4,
            notes = $5,
            created_at = $6,
            updated_at = $7,
            deleted = $8,
            pinned = $9,
            starred = $10,
            archived = $11,
            version = $12,
            server_updated_at = $13,
            is_conflict = $14,
            conflict_of_id = $15,
            conflict_created_at = $16
          WHERE user_id = $1 AND entity_id = $2 AND version = $17
        `, [
          userId,
          entityId,
          entity.binder_id,
          entity.title ?? '',
          entity.content ?? entity.notes ?? null,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          entity.pinned === 1,
          entity.starred === 1,
          entity.archived === 1,
          newVersion,
          serverUpdatedAt,
          entity.is_conflict ?? false,
          entity.conflict_of_id ?? null,
          entity.conflict_created_at ?? null,
          expectedVersion
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      } else {
        result = await client.query(`
          INSERT INTO client_sync.note_content (
            user_id, entity_id, binder_id, title, notes,
            created_at, updated_at, deleted, pinned, starred,
            archived, version, server_updated_at,
            is_conflict, conflict_of_id, conflict_created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (user_id, entity_id) DO NOTHING
        `, [
          userId,
          entityId,
          entity.binder_id,
          entity.title ?? '',
          entity.content ?? entity.notes ?? null,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          entity.pinned === 1,
          entity.starred === 1,
          entity.archived === 1,
          newVersion,
          serverUpdatedAt,
          entity.is_conflict ?? false,
          entity.conflict_of_id ?? null,
          entity.conflict_created_at ?? null
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      }
      break;

    case 'transcriptions':
      if (isUpdate) {
        result = await client.query(`
          UPDATE client_sync.transcription_content SET
            binder_id = $3,
            note_id = $4,
            text = $5,
            original_text = COALESCE(original_text, $6),
            user_edited = $7,
            speaker_name = $8,
            start_time = $9,
            end_time = $10,
            confidence = $11,
            language = $12,
            created_at = $13,
            updated_at = $14,
            deleted = $15,
            version = $16,
            server_updated_at = $17
          WHERE user_id = $1 AND entity_id = $2 AND version = $18
        `, [
          userId,
          entityId,
          entity.binder_id,
          entity.note_id,
          entity.transcription_text ?? entity.text ?? entity.full_text ?? '',
          entity.original_text ?? entity.transcription_text ?? entity.text ?? entity.full_text ?? null,
          entity.user_edited ?? false,
          entity.speaker_name ?? null,
          entity.start_time ? msToTimestamp(entity.start_time as number) : null,
          entity.end_time ? msToTimestamp(entity.end_time as number) : null,
          entity.confidence ?? null,
          entity.language ?? null,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt,
          expectedVersion
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      } else {
        result = await client.query(`
          INSERT INTO client_sync.transcription_content (
            user_id, entity_id, binder_id, note_id, text, original_text, user_edited,
            speaker_name, start_time, end_time, confidence, language,
            created_at, updated_at, deleted, version, server_updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (user_id, entity_id) DO NOTHING
        `, [
          userId,
          entityId,
          entity.binder_id,
          entity.note_id,
          entity.transcription_text ?? entity.text ?? entity.full_text ?? '',
          entity.original_text ?? entity.transcription_text ?? entity.text ?? entity.full_text ?? null,
          entity.user_edited ?? false,
          entity.speaker_name ?? null,
          entity.start_time ? msToTimestamp(entity.start_time as number) : null,
          entity.end_time ? msToTimestamp(entity.end_time as number) : null,
          entity.confidence ?? null,
          entity.language ?? null,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      }
      break;

    case 'summaries': {
      // Client provides both note_id and transcription_id
      // note_id is derived from transcription on the client side
      if (isUpdate) {
        result = await client.query(`
          UPDATE client_sync.summary_content SET
            note_id = $3,
            transcription_id = $4,
            summary_text = $5,
            model_version = $6,
            created_at = $7,
            updated_at = $8,
            deleted = $9,
            version = $10,
            server_updated_at = $11
          WHERE user_id = $1 AND entity_id = $2 AND version = $12
        `, [
          userId,
          entityId,
          entity.note_id,
          entity.transcription_id,
          entity.summary_text,
          entity.model_used ?? entity.model_version ?? null,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt,
          expectedVersion
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      } else {
        result = await client.query(`
          INSERT INTO client_sync.summary_content (
            user_id, entity_id, note_id, transcription_id, summary_text, model_version,
            created_at, updated_at, deleted, version, server_updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (user_id, entity_id) DO NOTHING
        `, [
          userId,
          entityId,
          entity.note_id,
          entity.transcription_id,
          entity.summary_text,
          entity.model_used ?? entity.model_version ?? null,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      }
      break;
    }

    case 'tags':
      if (isUpdate) {
        result = await client.query(`
          UPDATE client_sync.tag_content SET
            name = $3,
            color = $4,
            sort_index = $5,
            created_at = $6,
            updated_at = $7,
            deleted = $8,
            version = $9,
            server_updated_at = $10
          WHERE user_id = $1 AND entity_id = $2 AND version = $11
        `, [
          userId,
          entityId,
          entity.name,
          entity.color ?? null,
          entity.sort_index ?? 0,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt,
          expectedVersion
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      } else {
        result = await client.query(`
          INSERT INTO client_sync.tag_content (
            user_id, entity_id, name, color, sort_index,
            created_at, updated_at, deleted, version, server_updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (user_id, entity_id) DO NOTHING
        `, [
          userId,
          entityId,
          entity.name,
          entity.color ?? null,
          entity.sort_index ?? 0,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      }
      break;

    case 'note_tags':
      if (isUpdate) {
        result = await client.query(`
          UPDATE client_sync.note_tag_content SET
            note_id = $3,
            tag_id = $4,
            created_at = $5,
            updated_at = $6,
            deleted = $7,
            version = $8,
            server_updated_at = $9
          WHERE user_id = $1 AND entity_id = $2 AND version = $10
        `, [
          userId,
          entityId,
          entity.note_id,
          entity.tag_id,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt,
          expectedVersion
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      } else {
        result = await client.query(`
          INSERT INTO client_sync.note_tag_content (
            user_id, entity_id, note_id, tag_id,
            created_at, updated_at, deleted, version, server_updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (user_id, entity_id) DO NOTHING
        `, [
          userId,
          entityId,
          entity.note_id,
          entity.tag_id,
          msToTimestamp(entity.created_at as number),
          msToTimestamp(entity.updated_at as number),
          entity.deleted === 1,
          newVersion,
          serverUpdatedAt
        ]);
        if ((result.rowCount ?? 0) === 0) {
          return false;
        }
      }
      break;
  }

  return true;
}

/**
 * Soft-deletes an entity with optimistic concurrency control.
 * Returns true if the deletion succeeded, false if it failed due to concurrent modification.
 */
async function softDeleteEntity(
  client: PoolClient,
  userId: string,
  entityType: EntityType,
  entityId: string,
  newVersion: number,
  serverUpdatedAt: number
): Promise<boolean> {
  const table = ENTITY_TABLE_MAP[entityType];
  const expectedVersion = newVersion - 1;

  // Add version guard to prevent concurrent modifications
  const result = await client.query(`
    UPDATE ${table}
    SET deleted = TRUE, version = $3, server_updated_at = $4, updated_at = NOW()
    WHERE user_id = $1 AND entity_id = $2 AND version = $5
    RETURNING entity_id
  `, [userId, entityId, newVersion, serverUpdatedAt, expectedVersion]);

  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Tag Deduplication
// ============================================================================

async function findExistingTagByName(
  client: PoolClient,
  userId: string,
  tagName: string,
  excludeEntityId?: string
): Promise<{ entity_id: string; version: number; server_updated_at: number } | null> {
  const query = excludeEntityId
    ? `SELECT entity_id, version, server_updated_at
       FROM client_sync.tag_content
       WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND deleted = FALSE AND entity_id != $3
       LIMIT 1`
    : `SELECT entity_id, version, server_updated_at
       FROM client_sync.tag_content
       WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND deleted = FALSE
       LIMIT 1`;

  const params = excludeEntityId ? [userId, tagName, excludeEntityId] : [userId, tagName];
  const result = await client.query(query, params);
  return result.rows[0] || null;
}

// ============================================================================
// Note-Tag Deduplication
// ============================================================================

async function findExistingNoteTag(
  client: PoolClient,
  userId: string,
  noteId: string,
  tagId: string,
  excludeEntityId?: string
): Promise<{ entity_id: string; version: number; server_updated_at: number } | null> {
  const query = excludeEntityId
    ? `SELECT entity_id, version, server_updated_at
       FROM client_sync.note_tag_content
       WHERE user_id = $1 AND note_id = $2 AND tag_id = $3 AND deleted = FALSE AND entity_id != $4
       LIMIT 1`
    : `SELECT entity_id, version, server_updated_at
       FROM client_sync.note_tag_content
       WHERE user_id = $1 AND note_id = $2 AND tag_id = $3 AND deleted = FALSE
       LIMIT 1`;

  const params = excludeEntityId ? [userId, noteId, tagId, excludeEntityId] : [userId, noteId, tagId];
  const result = await client.query(query, params);
  return result.rows[0] || null;
}

// ============================================================================
// Conflicts Binder Deduplication
// ============================================================================

async function findExistingConflictsBinder(
  client: PoolClient,
  userId: string
): Promise<{ entity_id: string; version: number; server_updated_at: number } | null> {
  const result = await client.query(
    `SELECT entity_id, version, server_updated_at
     FROM client_sync.binder_content
     WHERE user_id = $1 AND is_conflicts = TRUE AND deleted = FALSE
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

// ============================================================================
// Entity Fetching
// ============================================================================

async function fetchEntityByIdVersioned(
  client: PoolClient,
  userId: string,
  entityType: EntityType,
  entityId: string
): Promise<{ version: number; server_updated_at: number; entity: Record<string, unknown> } | null> {
  const table = ENTITY_TABLE_MAP[entityType];

  const result = await client.query(`
    SELECT * FROM ${table}
    WHERE user_id = $1 AND entity_id = $2
  `, [userId, entityId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    version: row.version,
    server_updated_at: Number(row.server_updated_at),
    entity: rowToEntity(entityType, row)
  };
}

function rowToEntity(entityType: EntityType, row: Record<string, unknown>): Record<string, unknown> {
  switch (entityType) {
    case 'binders':
      return {
        id: row.entity_id,
        name: row.name,
        sort_index: row.sort_index,
        color: row.color,
        icon: row.icon,
        is_team_shared: row.is_team_shared,
        binder_type: row.binder_type,
        created_at: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at,
        deleted: row.deleted ? 1 : 0,
        is_conflicts: row.is_conflicts
      };
    case 'notes':
      return {
        id: row.entity_id,
        binder_id: row.binder_id,
        title: row.title,
        content: row.notes,
        created_at: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at,
        deleted: row.deleted ? 1 : 0,
        pinned: row.pinned ? 1 : 0,
        starred: row.starred ? 1 : 0,
        archived: row.archived ? 1 : 0,
        is_conflict: row.is_conflict,
        conflict_of_id: row.conflict_of_id,
        conflict_created_at: row.conflict_created_at
      };
    case 'transcriptions':
      return {
        id: row.entity_id,
        binder_id: row.binder_id,
        note_id: row.note_id,
        transcription_text: row.text,
        original_text: row.original_text,
        user_edited: row.user_edited,
        speaker_name: row.speaker_name,
        start_time: row.start_time instanceof Date ? row.start_time.getTime() : row.start_time,
        end_time: row.end_time instanceof Date ? row.end_time.getTime() : row.end_time,
        confidence: row.confidence,
        language: row.language,
        created_at: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at,
        deleted: row.deleted ? 1 : 0
      };
    case 'summaries':
      return {
        id: row.entity_id,
        note_id: row.note_id,
        transcription_id: row.transcription_id,
        summary_text: row.summary_text,
        model_version: row.model_version,
        created_at: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at,
        deleted: row.deleted ? 1 : 0
      };
    case 'tags':
      return {
        id: row.entity_id,
        name: row.name,
        color: row.color,
        sort_index: row.sort_index,
        created_at: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at,
        deleted: row.deleted ? 1 : 0
      };
    case 'note_tags':
      return {
        id: row.entity_id,
        note_id: row.note_id,
        tag_id: row.tag_id,
        created_at: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at,
        deleted: row.deleted ? 1 : 0
      };
    default:
      return row as Record<string, unknown>;
  }
}

// ============================================================================
// Delta Pull (from sync_changes)
// ============================================================================

async function fetchDeltaChanges(
  client: PoolClient,
  userId: string,
  cursor: number,
  limit: number
): Promise<{ items: SyncItem[]; newCursor: number; hasMore: boolean }> {
  // Fetch changes from sync_changes
  const result = await client.query(`
    SELECT seq, entity_type, entity_id, op, version, server_updated_at
    FROM client_sync.sync_changes
    WHERE user_id = $1 AND seq > $2
    ORDER BY seq ASC
    LIMIT $3
  `, [userId, cursor, limit + 1]);

  const hasMore = result.rows.length > limit;
  const changes = hasMore ? result.rows.slice(0, limit) : result.rows;

  const items: SyncItem[] = [];
  let newCursor = cursor;

  for (const change of changes) {
    const entityData = await fetchEntityByIdVersioned(
      client,
      userId,
      change.entity_type as EntityType,
      change.entity_id
    );

    if (entityData) {
      items.push({
        seq: Number(change.seq),
        entity_type: change.entity_type as EntityType,
        entity_id: change.entity_id,
        op: change.op as Operation,
        version: entityData.version,
        server_updated_at: entityData.server_updated_at,
        entity: entityData.entity
      });
    }

    newCursor = Number(change.seq);
  }

  return { items, newCursor, hasMore };
}

// ============================================================================
// Cursor Expiry Check
// ============================================================================

async function checkCursorExpiry(
  client: PoolClient,
  userId: string,
  cursor: number
): Promise<{ expired: boolean; oldestAvailableCursor?: number }> {
  if (cursor === 0) {
    return { expired: false };
  }

  const result = await client.query(`
    SELECT MIN(seq) as oldest_seq
    FROM client_sync.sync_changes
    WHERE user_id = $1
  `, [userId]);

  const oldestSeq = result.rows[0]?.oldest_seq;

  // If there are no changes, cursor is not expired
  if (oldestSeq === null) {
    return { expired: false };
  }

  // If cursor is less than the oldest available seq, it's expired
  if (cursor < Number(oldestSeq)) {
    return { expired: true, oldestAvailableCursor: Number(oldestSeq) };
  }

  return { expired: false };
}

// ============================================================================
// Snapshot Pagination
// ============================================================================

interface SnapshotToken {
  entityTypeIndex: number;
  offset: number;
}

function parseSnapshotToken(token: string | null | undefined): SnapshotToken {
  if (!token) {
    return { entityTypeIndex: 0, offset: 0 };
  }
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return {
      entityTypeIndex: parsed.e || 0,
      offset: parsed.o || 0
    };
  } catch {
    return { entityTypeIndex: 0, offset: 0 };
  }
}

function encodeSnapshotToken(token: SnapshotToken): string {
  return Buffer.from(JSON.stringify({ e: token.entityTypeIndex, o: token.offset })).toString('base64');
}

async function fetchSnapshotPage(
  client: PoolClient,
  userId: string,
  limit: number,
  token: SnapshotToken
): Promise<{ items: SyncItem[]; nextToken: string | null; done: boolean }> {
  const items: SyncItem[] = [];
  let currentEntityIndex = token.entityTypeIndex;
  let currentOffset = token.offset;
  let remaining = limit;

  while (remaining > 0 && currentEntityIndex < SNAPSHOT_ORDER.length) {
    const entityType = SNAPSHOT_ORDER[currentEntityIndex];
    const table = ENTITY_TABLE_MAP[entityType];

    const result = await client.query(`
      SELECT * FROM ${table}
      WHERE user_id = $1
      ORDER BY server_updated_at ASC, entity_id ASC
      LIMIT $2 OFFSET $3
    `, [userId, remaining + 1, currentOffset]);

    const rows = result.rows;
    const hasMoreInType = rows.length > remaining;
    const rowsToProcess = hasMoreInType ? rows.slice(0, remaining) : rows;

    for (const row of rowsToProcess) {
      items.push({
        seq: 0, // Snapshot items don't have a seq
        entity_type: entityType,
        entity_id: row.entity_id,
        op: 'upsert' as Operation,
        version: row.version,
        server_updated_at: Number(row.server_updated_at),
        entity: rowToEntity(entityType, row)
      });
    }

    remaining -= rowsToProcess.length;

    if (hasMoreInType) {
      // More items in this entity type
      currentOffset += rowsToProcess.length;
      return {
        items,
        nextToken: encodeSnapshotToken({ entityTypeIndex: currentEntityIndex, offset: currentOffset }),
        done: false
      };
    } else {
      // Move to next entity type
      currentEntityIndex++;
      currentOffset = 0;
    }
  }

  // Done with all entity types
  return { items, nextToken: null, done: true };
}

// ============================================================================
// Push Processing
// ============================================================================

async function processPushItem(
  client: PoolClient,
  userId: string,
  deviceId: string,
  pushItem: PushItem,
  serverTimeMs: number
): Promise<PushResult> {
  const { mutation_id, entity_type, entity_id, op, base_version, entity } = pushItem;

  // 1. Check idempotency
  const idempotencyCheck = await checkIdempotency(client, userId, deviceId, mutation_id, pushItem);

  if (idempotencyCheck.isDuplicate) {
    if (idempotencyCheck.mismatch) {
      return {
        mutation_id,
        entity_type,
        entity_id,
        status: 'rejected',
        reason: 'idempotency_payload_mismatch'
      };
    }

    // Replay the cached result with full metadata (per Phase 0 Spec Section 9)
    const record = idempotencyCheck.record!;

    // Build result object replaying all stored fields
    const result: PushResult = {
      mutation_id,
      entity_type,
      entity_id,
      status: 'ignored' // Per spec, duplicates return 'ignored' status
    };

    // Include version and server_updated_at if we have them
    if (record.result_version !== null) {
      result.version = record.result_version;
    }
    if (record.result_server_updated_at !== null) {
      result.server_updated_at = Number(record.result_server_updated_at);
    }

    // Replay conflict-specific fields
    if (record.status === 'conflict') {
      if (record.reason) {
        result.reason = record.reason;
      }
      if (record.server_version !== null) {
        result.server_version = record.server_version;
      }
      if (record.server_entity) {
        result.server_entity = record.server_entity;
      }
    }

    // Replay rejection reason
    if (record.status === 'rejected' && record.reason) {
      result.reason = record.reason;
    }

    // Replay canonical_entity_id for tag/note_tag deduplication
    if (record.canonical_entity_id) {
      result.canonical_entity_id = record.canonical_entity_id;
    }

    return result;
  }

  // 2. Fetch current entity state
  const currentEntity = await fetchEntityByIdVersioned(client, userId, entity_type, entity_id);

  // 3. Handle creates vs updates
  if (base_version === null) {
    // CREATE operation
    if (currentEntity !== null) {
      // Entity already exists - conflict
      await recordMutation(client, userId, deviceId, pushItem, 'conflict', null, {
        reason: 'entity_exists',
        server_version: currentEntity.version,
        result_server_updated_at: currentEntity.server_updated_at,
        server_entity: currentEntity.entity
      });
      return {
        mutation_id,
        entity_type,
        entity_id,
        status: 'conflict',
        reason: 'entity_exists',
        server_version: currentEntity.version,
        server_updated_at: currentEntity.server_updated_at,
        server_entity: currentEntity.entity
      };
    }

    // Check for tag name deduplication
    if (entity_type === 'tags' && entity && op === 'upsert') {
      const existingTag = await findExistingTagByName(client, userId, entity.name as string);
      if (existingTag) {
        // Return the canonical tag ID
        await recordMutation(client, userId, deviceId, pushItem, 'applied', null, {
          canonical_entity_id: existingTag.entity_id,
          result_version: existingTag.version,
          result_server_updated_at: existingTag.server_updated_at
        });
        return {
          mutation_id,
          entity_type,
          entity_id,
          status: 'applied',
          canonical_entity_id: existingTag.entity_id,
          version: existingTag.version,
          server_updated_at: existingTag.server_updated_at
        };
      }
    }

    // Check for note_tag deduplication
    if (entity_type === 'note_tags' && entity && op === 'upsert') {
      const existingNoteTag = await findExistingNoteTag(
        client,
        userId,
        entity.note_id as string,
        entity.tag_id as string
      );
      if (existingNoteTag) {
        await recordMutation(client, userId, deviceId, pushItem, 'applied', null, {
          canonical_entity_id: existingNoteTag.entity_id,
          result_version: existingNoteTag.version,
          result_server_updated_at: existingNoteTag.server_updated_at
        });
        return {
          mutation_id,
          entity_type,
          entity_id,
          status: 'applied',
          canonical_entity_id: existingNoteTag.entity_id,
          version: existingNoteTag.version,
          server_updated_at: existingNoteTag.server_updated_at
        };
      }
    }

    // Check for conflicts binder deduplication
    // Use normalizeBoolean() to handle various truthy values (true, 1, "true", "1", "TRUE", etc.)
    const isConflictsBinder = entity_type === 'binders' &&
      entity &&
      op === 'upsert' &&
      normalizeBoolean(entity.is_conflicts);
    if (isConflictsBinder) {
      const existingConflicts = await findExistingConflictsBinder(client, userId);
      if (existingConflicts) {
        await recordMutation(client, userId, deviceId, pushItem, 'applied', null, {
          canonical_entity_id: existingConflicts.entity_id,
          result_version: existingConflicts.version,
          result_server_updated_at: existingConflicts.server_updated_at
        });
        return {
          mutation_id,
          entity_type,
          entity_id,
          status: 'applied',
          canonical_entity_id: existingConflicts.entity_id,
          version: existingConflicts.version,
          server_updated_at: existingConflicts.server_updated_at
        };
      }
    }

    // Validate entity for creates
    if (op === 'upsert' && entity) {
      const validator = getValidator(entity_type);
      if (validator) {
        const entityWithUser = { ...entity, user_id: userId, id: entity_id };
        const validation = validator(entityWithUser);
        if (!validation.valid) {
          const reason = `validation_failed: ${validation.errors.join('; ')}`;
          await recordMutation(client, userId, deviceId, pushItem, 'rejected', null, { reason });
          return {
            mutation_id,
            entity_type,
            entity_id,
            status: 'rejected',
            reason
          };
        }
      }

      // Create entity
      const newVersion = 1;
      const createSuccess = await upsertEntity(
        client,
        userId,
        entity_type,
        entity_id,
        { ...entity, user_id: userId, id: entity_id },
        newVersion,
        serverTimeMs
      );

      if (!createSuccess) {
        // Concurrent create detected - re-fetch entity and return conflict
        const conflictEntity = await fetchEntityByIdVersioned(client, userId, entity_type, entity_id);
        await recordMutation(client, userId, deviceId, pushItem, 'conflict', null, {
          reason: 'entity_exists',
          server_version: conflictEntity?.version,
          result_server_updated_at: conflictEntity?.server_updated_at,
          server_entity: conflictEntity?.entity
        });
        return {
          mutation_id,
          entity_type,
          entity_id,
          status: 'conflict',
          reason: 'entity_exists',
          server_version: conflictEntity?.version,
          server_updated_at: conflictEntity?.server_updated_at,
          server_entity: conflictEntity?.entity
        };
      }

      // Record in sync_changes
      const changeResult = await client.query<{ seq: number }>(
        `INSERT INTO client_sync.sync_changes (user_id, entity_type, entity_id, op, version, server_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING seq`,
        [userId, entity_type, entity_id, 'upsert', newVersion, serverTimeMs]
      );

      await recordMutation(client, userId, deviceId, pushItem, 'applied', changeResult.rows[0].seq, {
        result_version: newVersion,
        result_server_updated_at: serverTimeMs
      });

      return {
        mutation_id,
        entity_type,
        entity_id,
        status: 'applied',
        version: newVersion,
        server_updated_at: serverTimeMs
      };
    }
  } else {
    // UPDATE or DELETE operation
    if (currentEntity === null) {
      // Entity doesn't exist - conflict
      await recordMutation(client, userId, deviceId, pushItem, 'conflict', null, {
        reason: 'entity_not_found'
      });
      return {
        mutation_id,
        entity_type,
        entity_id,
        status: 'conflict',
        reason: 'entity_not_found'
      };
    }

    // Version check
    if (currentEntity.version !== base_version) {
      await recordMutation(client, userId, deviceId, pushItem, 'conflict', null, {
        reason: 'version_mismatch',
        server_version: currentEntity.version,
        result_server_updated_at: currentEntity.server_updated_at,
        server_entity: currentEntity.entity
      });
      return {
        mutation_id,
        entity_type,
        entity_id,
        status: 'conflict',
        reason: 'version_mismatch',
        server_version: currentEntity.version,
        server_updated_at: currentEntity.server_updated_at,
        server_entity: currentEntity.entity
      };
    }

    const newVersion = currentEntity.version + 1;

    if (op === 'delete') {
      // Soft delete with optimistic concurrency
      const deleteSuccess = await softDeleteEntity(client, userId, entity_type, entity_id, newVersion, serverTimeMs);

      if (!deleteSuccess) {
        // Concurrent modification detected - re-fetch entity and return conflict
        const conflictEntity = await fetchEntityByIdVersioned(client, userId, entity_type, entity_id);
        await recordMutation(client, userId, deviceId, pushItem, 'conflict', null, {
          reason: 'version_mismatch',
          server_version: conflictEntity?.version,
          result_server_updated_at: conflictEntity?.server_updated_at,
          server_entity: conflictEntity?.entity
        });
        return {
          mutation_id,
          entity_type,
          entity_id,
          status: 'conflict',
          reason: 'version_mismatch',
          server_version: conflictEntity?.version,
          server_updated_at: conflictEntity?.server_updated_at,
          server_entity: conflictEntity?.entity
        };
      }

      const changeResult = await client.query<{ seq: number }>(
        `INSERT INTO client_sync.sync_changes (user_id, entity_type, entity_id, op, version, server_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING seq`,
        [userId, entity_type, entity_id, 'delete', newVersion, serverTimeMs]
      );

      await recordMutation(client, userId, deviceId, pushItem, 'applied', changeResult.rows[0].seq, {
        result_version: newVersion,
        result_server_updated_at: serverTimeMs
      });

      return {
        mutation_id,
        entity_type,
        entity_id,
        status: 'applied',
        version: newVersion,
        server_updated_at: serverTimeMs
      };
    }

    // Update
    if (entity) {
      // Validate entity for updates
      const validator = getValidator(entity_type);
      if (validator) {
        const entityWithUser = { ...entity, user_id: userId, id: entity_id };
        const validation = validator(entityWithUser);
        if (!validation.valid) {
          const reason = `validation_failed: ${validation.errors.join('; ')}`;
          await recordMutation(client, userId, deviceId, pushItem, 'rejected', null, { reason });
          return {
            mutation_id,
            entity_type,
            entity_id,
            status: 'rejected',
            reason
          };
        }
      }

      // Update with optimistic concurrency
      const updateSuccess = await upsertEntity(
        client,
        userId,
        entity_type,
        entity_id,
        { ...entity, user_id: userId, id: entity_id },
        newVersion,
        serverTimeMs
      );

      if (!updateSuccess) {
        // Concurrent modification detected - re-fetch entity and return conflict
        const conflictEntity = await fetchEntityByIdVersioned(client, userId, entity_type, entity_id);
        await recordMutation(client, userId, deviceId, pushItem, 'conflict', null, {
          reason: 'version_mismatch',
          server_version: conflictEntity?.version,
          result_server_updated_at: conflictEntity?.server_updated_at,
          server_entity: conflictEntity?.entity
        });
        return {
          mutation_id,
          entity_type,
          entity_id,
          status: 'conflict',
          reason: 'version_mismatch',
          server_version: conflictEntity?.version,
          server_updated_at: conflictEntity?.server_updated_at,
          server_entity: conflictEntity?.entity
        };
      }

      const changeResult = await client.query<{ seq: number }>(
        `INSERT INTO client_sync.sync_changes (user_id, entity_type, entity_id, op, version, server_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING seq`,
        [userId, entity_type, entity_id, 'upsert', newVersion, serverTimeMs]
      );

      await recordMutation(client, userId, deviceId, pushItem, 'applied', changeResult.rows[0].seq, {
        result_version: newVersion,
        result_server_updated_at: serverTimeMs
      });

      return {
        mutation_id,
        entity_type,
        entity_id,
        status: 'applied',
        version: newVersion,
        server_updated_at: serverTimeMs
      };
    }
  }

  // Fallback error case
  await recordMutation(client, userId, deviceId, pushItem, 'rejected', null, {
    reason: 'invalid_operation'
  });
  return {
    mutation_id,
    entity_type,
    entity_id,
    status: 'rejected',
    reason: 'invalid_operation'
  };
}

// ============================================================================
// Main Endpoint Handler
// ============================================================================

syncRouter.post('/', async (req: Request, res: Response) => {
  const pool = getPool();
  let client: PoolClient | null = null;

  try {
    // Get user ID from auth context
    const userId = (req as any).authContext?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    // Validate request
    const validation = validateSyncRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: validation.errors
      });
    }

    const syncReq = validation.request!;
    const serverTimeMs = Date.now();

    // Compute clock skew
    const deviceTimeSkewMs = syncReq.client_time_ms - serverTimeMs;
    const clockSuspect = Math.abs(deviceTimeSkewMs) > CLOCK_SKEW_THRESHOLD_MS;

    if (clockSuspect) {
      console.warn('[sync] Clock skew detected', {
        userId,
        deviceId: syncReq.device_id,
        clientTime: syncReq.client_time_ms,
        serverTime: serverTimeMs,
        skewMs: deviceTimeSkewMs
      });
    }

    // Get a client from the pool and start a transaction
    client = await pool.connect();
    await client.query('BEGIN');

    // Set session variable for Row-Level Security policies
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

    // Ensure conflicts binder exists (lazy creation)
    await ensureConflictsBinder(client, userId, serverTimeMs);

    // Check cursor expiry
    const cursorExpiry = await checkCursorExpiry(client, userId, syncReq.cursor);
    if (cursorExpiry.expired && !syncReq.snapshot) {
      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        data: {
          cursor: syncReq.cursor,
          has_more: false,
          requires_snapshot: true,
          oldest_available_cursor: cursorExpiry.oldestAvailableCursor,
          server_time_ms: serverTimeMs,
          device_time_skew_ms: deviceTimeSkewMs,
          clock_suspect: clockSuspect,
          items: [],
          results: []
        } satisfies SyncResponse
      });
    }

    // Process push items
    const results: PushResult[] = [];
    let appliedCount = 0;

    if (syncReq.push && syncReq.push.length > 0) {
      for (const pushItem of syncReq.push) {
        // Clamp future timestamps
        if (pushItem.entity && typeof pushItem.entity.updated_at === 'number') {
          if (pushItem.entity.updated_at > serverTimeMs + FUTURE_TIMESTAMP_CLAMP_MS) {
            console.warn('[sync] Clamping future timestamp', {
              userId,
              entityId: pushItem.entity_id,
              original: pushItem.entity.updated_at,
              clamped: serverTimeMs
            });
            pushItem.entity.updated_at = serverTimeMs;
          }
        }

        const result = await processPushItem(client, userId, syncReq.device_id, pushItem, serverTimeMs);
        results.push(result);

        if (result.status === 'applied') {
          appliedCount++;
        }
      }
    }

    // Fetch items (delta pull or snapshot)
    let items: SyncItem[] = [];
    let newCursor = syncReq.cursor;
    let hasMore = false;
    let snapshotToken: string | null = null;
    let snapshotDone = false;

    const limit = syncReq.limit || DEFAULT_LIMIT;

    if (syncReq.snapshot || syncReq.cursor === 0) {
      // Snapshot mode
      const token = parseSnapshotToken(syncReq.snapshot_token);
      const snapshotResult = await fetchSnapshotPage(client, userId, limit, token);

      items = snapshotResult.items;
      hasMore = !snapshotResult.done;
      snapshotToken = snapshotResult.nextToken;
      snapshotDone = snapshotResult.done;

      if (snapshotDone) {
        // Get the current max cursor for incremental sync
        const maxCursorResult = await client.query<{ max_seq: number | null }>(
          `SELECT MAX(seq) as max_seq FROM client_sync.sync_changes WHERE user_id = $1`,
          [userId]
        );
        newCursor = maxCursorResult.rows[0]?.max_seq || 0;
      }
    } else {
      // Delta pull
      const deltaResult = await fetchDeltaChanges(client, userId, syncReq.cursor, limit);
      items = deltaResult.items;
      newCursor = deltaResult.newCursor;
      hasMore = deltaResult.hasMore;
    }

    // Update device cursor
    await updateDeviceCursorWithSkew(client, userId, syncReq.device_id, syncReq.device_name || syncReq.device_id, {
      last_cursor: newCursor,
      device_time_skew_ms: deviceTimeSkewMs,
      clock_suspect: clockSuspect,
      last_client_time_ms: syncReq.client_time_ms
    });

    await client.query('COMMIT');

    // Publish sync notification (non-blocking)
    if (appliedCount > 0) {
      publishSyncNotification(userId, syncReq.device_id, appliedCount)
        .catch(err => console.warn('[sync] Redis publish failed (non-critical):', err.message));
    }

    // Log sync operation
    console.log('[sync] Sync completed', {
      userId,
      deviceId: syncReq.device_id,
      pushCount: syncReq.push?.length || 0,
      appliedCount,
      itemsReturned: items.length,
      newCursor,
      hasMore,
      isSnapshot: syncReq.snapshot || syncReq.cursor === 0
    });

    // Build response
    const response: SyncResponse = {
      cursor: newCursor,
      has_more: hasMore,
      server_time_ms: serverTimeMs,
      device_time_skew_ms: deviceTimeSkewMs,
      clock_suspect: clockSuspect,
      items,
      results
    };

    if (syncReq.snapshot || syncReq.cursor === 0) {
      response.snapshot_token = snapshotToken;
      response.snapshot_done = snapshotDone;
    }

    // Wrap response in success envelope (client expects { success: true, data: ... })
    return res.status(200).json({
      success: true,
      data: response
    });

  } catch (error: any) {
    console.error('[sync] Error processing sync request', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).authContext?.userId
    });

    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });

  } finally {
    if (client) {
      client.release();
    }
  }
});
