import { PoolClient } from 'pg';
import { getPool } from '../lib/database';

/**
 * Binder data structure matching the client_notes.binders table schema
 */
export interface BinderData {
  id: string;
  user_id: string;
  name: string;
  binder_type: 'personal' | 'shared' | 'archived';
  color?: string | null;
  icon?: string | null;
  sort_index: number;
  deleted: number; // 0 = false, 1 = true (matches SQLite)
  created_at: number; // milliseconds since epoch
  updated_at: number; // milliseconds since epoch
  deleted_at?: number | null; // milliseconds since epoch, NULL if not deleted
}

/**
 * Input data for creating or updating a binder
 */
export interface BinderInput {
  name: string;
  binder_type?: 'personal' | 'shared' | 'archived';
  color?: string | null;
  icon?: string | null;
  sort_index?: number;
}

/**
 * Repository for managing binder CRUD operations
 * Handles data access to the client_notes.binders table
 */
export class BinderRepository {
  /**
   * Insert or update a binder
   * @param userId - User ID who owns the binder
   * @param binder - Complete binder data
   * @param client - Optional transaction client
   * @returns The upserted binder data
   */
  async upsert(
    userId: string,
    binder: BinderData,
    client?: PoolClient
  ): Promise<BinderData> {
    const executor = client || getPool();

    const result = await executor.query<BinderData>(
      `INSERT INTO client_notes.binders (
        id, user_id, name, binder_type, color, icon,
        sort_index, deleted, created_at, updated_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        binder_type = EXCLUDED.binder_type,
        color = EXCLUDED.color,
        icon = EXCLUDED.icon,
        sort_index = EXCLUDED.sort_index,
        deleted = EXCLUDED.deleted,
        updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at
      RETURNING *`,
      [
        binder.id,
        userId,
        binder.name,
        binder.binder_type,
        binder.color || null,
        binder.icon || null,
        binder.sort_index,
        binder.deleted,
        binder.created_at,
        binder.updated_at,
        binder.deleted_at || null
      ]
    );

    if (result.rows.length === 0) {
      throw new Error(`Failed to upsert binder ${binder.id}`);
    }

    return result.rows[0];
  }

  /**
   * Find a single binder by ID
   * @param userId - User ID who owns the binder
   * @param binderId - Binder ID to find
   * @param client - Optional transaction client
   * @returns The binder data or null if not found
   */
  async findById(
    userId: string,
    binderId: string,
    client?: PoolClient
  ): Promise<BinderData | null> {
    const executor = client || getPool();

    const result = await executor.query<BinderData>(
      `SELECT
        id, user_id, name, binder_type, color, icon,
        sort_index, deleted, created_at, updated_at, deleted_at
      FROM client_notes.binders
      WHERE id = $1 AND user_id = $2`,
      [binderId, userId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Find all non-deleted binders for a user
   * @param userId - User ID to query
   * @param client - Optional transaction client
   * @returns Array of binder data
   */
  async findByUser(
    userId: string,
    client?: PoolClient
  ): Promise<BinderData[]> {
    const executor = client || getPool();

    const result = await executor.query<BinderData>(
      `SELECT
        id, user_id, name, binder_type, color, icon,
        sort_index, deleted, created_at, updated_at, deleted_at
      FROM client_notes.binders
      WHERE user_id = $1 AND deleted = 0
      ORDER BY sort_index ASC, created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  /**
   * Soft delete a binder by setting deleted=1 and deleted_at timestamp
   * @param userId - User ID who owns the binder
   * @param binderId - Binder ID to delete
   * @param client - Optional transaction client
   * @returns True if the binder was deleted, false if not found
   */
  async softDelete(
    userId: string,
    binderId: string,
    client?: PoolClient
  ): Promise<boolean> {
    const executor = client || getPool();

    const now = Date.now();
    const result = await executor.query(
      `UPDATE client_notes.binders
      SET
        deleted = 1,
        deleted_at = $3,
        updated_at = $3
      WHERE id = $1 AND user_id = $2 AND deleted = 0`,
      [binderId, userId, now]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Permanently delete a binder (GDPR compliance)
   * WARNING: This is irreversible and will cascade delete all notes
   * @param userId - User ID who owns the binder
   * @param binderId - Binder ID to permanently delete
   * @param client - Optional transaction client
   * @returns True if the binder was deleted, false if not found
   */
  async hardDelete(
    userId: string,
    binderId: string,
    client?: PoolClient
  ): Promise<boolean> {
    const executor = client || getPool();

    const result = await executor.query(
      `DELETE FROM client_notes.binders
      WHERE id = $1 AND user_id = $2`,
      [binderId, userId]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Create a new binder with auto-generated timestamps
   * @param userId - User ID who owns the binder
   * @param binderId - Unique binder ID (UUID)
   * @param input - Binder creation data
   * @param client - Optional transaction client
   * @returns The created binder data
   */
  async create(
    userId: string,
    binderId: string,
    input: BinderInput,
    client?: PoolClient
  ): Promise<BinderData> {
    const now = Date.now();
    const binder: BinderData = {
      id: binderId,
      user_id: userId,
      name: input.name,
      binder_type: input.binder_type || 'personal',
      color: input.color || null,
      icon: input.icon || null,
      sort_index: input.sort_index || 0,
      deleted: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null
    };

    return this.upsert(userId, binder, client);
  }

  /**
   * Update an existing binder
   * @param userId - User ID who owns the binder
   * @param binderId - Binder ID to update
   * @param input - Partial binder data to update
   * @param client - Optional transaction client
   * @returns The updated binder data or null if not found
   */
  async update(
    userId: string,
    binderId: string,
    input: Partial<BinderInput>,
    client?: PoolClient
  ): Promise<BinderData | null> {
    const executor = client || getPool();

    // First, fetch the existing binder
    const existing = await this.findById(userId, binderId, client);
    if (!existing) {
      return null;
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.binder_type !== undefined) {
      updates.push(`binder_type = $${paramIndex++}`);
      values.push(input.binder_type);
    }
    if (input.color !== undefined) {
      updates.push(`color = $${paramIndex++}`);
      values.push(input.color);
    }
    if (input.icon !== undefined) {
      updates.push(`icon = $${paramIndex++}`);
      values.push(input.icon);
    }
    if (input.sort_index !== undefined) {
      updates.push(`sort_index = $${paramIndex++}`);
      values.push(input.sort_index);
    }

    // Always update the updated_at timestamp
    const now = Date.now();
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);

    // Add WHERE clause parameters
    values.push(binderId, userId);

    const result = await executor.query<BinderData>(
      `UPDATE client_notes.binders
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
      RETURNING *`,
      values
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get all binders for a user, including soft-deleted ones
   * Useful for sync operations that need complete state
   * @param userId - User ID to query
   * @param client - Optional transaction client
   * @returns Array of all binder data
   */
  async findAllByUser(
    userId: string,
    client?: PoolClient
  ): Promise<BinderData[]> {
    const executor = client || getPool();

    const result = await executor.query<BinderData>(
      `SELECT
        id, user_id, name, binder_type, color, icon,
        sort_index, deleted, created_at, updated_at, deleted_at
      FROM client_notes.binders
      WHERE user_id = $1
      ORDER BY sort_index ASC, created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  /**
   * Count total binders for a user
   * @param userId - User ID to count
   * @param includeDeleted - Whether to include soft-deleted binders
   * @param client - Optional transaction client
   * @returns Total count of binders
   */
  async countByUser(
    userId: string,
    includeDeleted: boolean = false,
    client?: PoolClient
  ): Promise<number> {
    const executor = client || getPool();

    const whereClause = includeDeleted
      ? 'WHERE user_id = $1'
      : 'WHERE user_id = $1 AND deleted = 0';

    const result = await executor.query<{ count: string }>(
      `SELECT COUNT(*) as count
      FROM client_notes.binders
      ${whereClause}`,
      [userId]
    );

    return parseInt(result.rows[0].count, 10);
  }
}

// Export a singleton instance for convenience
export const binderRepository = new BinderRepository();
