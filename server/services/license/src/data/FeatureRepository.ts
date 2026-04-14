import { getPool } from '../lib/database';
import { FeatureDefinition } from '../models/types';

/**
 * Repository for feature definition queries
 */
export class FeatureRepository {
  /**
   * Get all active feature definitions
   * @returns Array of active features
   */
  async getAllActive(): Promise<FeatureDefinition[]> {
    const pool = getPool();
    const result = await pool.query<FeatureDefinition>(
      `SELECT * FROM licensing.feature_definitions
       WHERE is_active = true
       ORDER BY feature_key ASC`
    );
    return result.rows;
  }

  /**
   * Get all feature definitions (including inactive)
   * @returns Array of all features
   */
  async getAll(): Promise<FeatureDefinition[]> {
    const pool = getPool();
    const result = await pool.query<FeatureDefinition>(
      'SELECT * FROM licensing.feature_definitions ORDER BY feature_key ASC'
    );
    return result.rows;
  }

  /**
   * Get features by their keys
   * @param keys - Array of feature keys to retrieve
   * @returns Array of matching features
   */
  async getByKeys(keys: string[]): Promise<FeatureDefinition[]> {
    if (keys.length === 0) {
      return [];
    }

    const pool = getPool();
    const result = await pool.query<FeatureDefinition>(
      `SELECT * FROM licensing.feature_definitions
       WHERE feature_key = ANY($1)
       ORDER BY feature_key ASC`,
      [keys]
    );
    return result.rows;
  }

  /**
   * Get a single feature by key
   * @param key - Feature key
   * @returns Feature definition or null
   */
  async getByKey(key: string): Promise<FeatureDefinition | null> {
    const pool = getPool();
    const result = await pool.query<FeatureDefinition>(
      'SELECT * FROM licensing.feature_definitions WHERE feature_key = $1',
      [key]
    );
    return result.rows[0] || null;
  }

  /**
   * Get features by category
   * @param category - Feature category ('desktop', 'portal', 'both')
   * @returns Array of features in the category
   */
  async getByCategory(category: 'desktop' | 'portal' | 'both'): Promise<FeatureDefinition[]> {
    const pool = getPool();
    const result = await pool.query<FeatureDefinition>(
      `SELECT * FROM licensing.feature_definitions
       WHERE feature_category = $1 AND is_active = true
       ORDER BY feature_key ASC`,
      [category]
    );
    return result.rows;
  }

  /**
   * Validate that all provided feature keys exist and are active
   * @param keys - Array of feature keys to validate
   * @returns True if all keys are valid and active
   */
  async validateFeatures(keys: string[]): Promise<boolean> {
    if (keys.length === 0) {
      return true;
    }

    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM licensing.feature_definitions
       WHERE feature_key = ANY($1) AND is_active = true`,
      [keys]
    );
    const count = parseInt(result.rows[0].count, 10);
    return count === keys.length;
  }

  /**
   * Get invalid (non-existent or inactive) feature keys from a list
   * @param keys - Array of feature keys to check
   * @returns Array of invalid feature keys
   */
  async getInvalidFeatures(keys: string[]): Promise<string[]> {
    if (keys.length === 0) {
      return [];
    }

    const pool = getPool();
    const result = await pool.query<{ feature_key: string }>(
      `SELECT feature_key FROM licensing.feature_definitions
       WHERE feature_key = ANY($1) AND is_active = true`,
      [keys]
    );
    const validKeys = new Set(result.rows.map(row => row.feature_key));
    return keys.filter(key => !validKeys.has(key));
  }

  /**
   * Create a new feature definition
   * @param feature - Feature data (without id, created_at, updated_at)
   * @returns The created feature
   */
  async create(feature: Omit<FeatureDefinition, 'id' | 'created_at' | 'updated_at'>): Promise<FeatureDefinition> {
    const pool = getPool();
    const result = await pool.query<FeatureDefinition>(
      `INSERT INTO licensing.feature_definitions (
        feature_key, display_name, description, feature_category, is_active, is_implemented, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        feature.feature_key,
        feature.display_name,
        feature.description,
        feature.feature_category,
        feature.is_active,
        feature.is_implemented ?? false,
        JSON.stringify(feature.metadata),
      ]
    );
    return result.rows[0];
  }

  /**
   * Update a feature definition
   * @param id - Feature UUID
   * @param updates - Partial feature data to update
   */
  async update(
    id: string,
    updates: Partial<Omit<FeatureDefinition, 'id' | 'feature_key' | 'created_at' | 'updated_at'>>
  ): Promise<void> {
    const pool = getPool();
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.display_name !== undefined) {
      fields.push(`display_name = $${paramIndex++}`);
      values.push(updates.display_name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.feature_category !== undefined) {
      fields.push(`feature_category = $${paramIndex++}`);
      values.push(updates.feature_category);
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updates.is_active);
    }
    if (updates.is_implemented !== undefined) {
      fields.push(`is_implemented = $${paramIndex++}`);
      values.push(updates.is_implemented);
    }
    if (updates.metadata !== undefined) {
      fields.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) {
      return;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    await pool.query(
      `UPDATE licensing.feature_definitions SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  /**
   * Deactivate a feature
   * @param id - Feature UUID
   */
  async deactivate(id: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.feature_definitions
       SET is_active = false, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * Activate a feature
   * @param id - Feature UUID
   */
  async activate(id: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.feature_definitions
       SET is_active = true, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * Update the implementation status of a feature
   * @param featureKey - Feature key
   * @param isImplemented - Whether the feature is implemented
   */
  async updateImplementationStatus(featureKey: string, isImplemented: boolean): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.feature_definitions
       SET is_implemented = $2, updated_at = NOW()
       WHERE feature_key = $1`,
      [featureKey, isImplemented]
    );
  }

  /**
   * Get all features with their implementation status
   * @returns Array of features with is_implemented included
   */
  async getAllWithImplementationStatus(): Promise<(FeatureDefinition & { is_implemented: boolean })[]> {
    const pool = getPool();
    const result = await pool.query<FeatureDefinition & { is_implemented: boolean }>(
      `SELECT * FROM licensing.feature_definitions
       WHERE is_active = true
       ORDER BY feature_key ASC`
    );
    return result.rows;
  }

  /**
   * Get features for a specific tier with implementation status
   * Uses tier inheritance - returns features from this tier and all lower tiers
   * @param tierKey - Tier key to get features for
   * @returns Array of features with tier and implementation info
   */
  async getFeaturesForTierWithDetails(tierKey: string): Promise<{
    feature_key: string;
    display_name: string;
    description: string | null;
    feature_category: string;
    is_implemented: boolean;
    minimum_tier_key: string;
    minimum_tier_level: number;
  }[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT
        f.feature_key,
        f.display_name,
        f.description,
        f.feature_category,
        f.is_implemented,
        t.tier_key AS minimum_tier_key,
        t.tier_level AS minimum_tier_level
      FROM licensing.feature_definitions f
      JOIN licensing.tier_features tf ON tf.feature_id = f.id
      JOIN licensing.tiers t ON t.id = tf.tier_id
      WHERE t.tier_level <= (SELECT tier_level FROM licensing.tiers WHERE tier_key = $1)
        AND f.is_active = TRUE
        AND t.is_active = TRUE
      ORDER BY t.tier_level ASC, f.feature_key ASC`,
      [tierKey]
    );
    return result.rows;
  }
}

// Export singleton instance
export const featureRepository = new FeatureRepository();
