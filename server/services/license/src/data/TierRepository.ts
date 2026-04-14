import { getPool } from '../lib/database';

/**
 * Tier definition from database
 */
export interface Tier {
  id: string;
  tier_key: string;
  display_name: string;
  description: string | null;
  tier_level: number;
  is_active: boolean;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Tier with resolved feature array (includes inherited features)
 */
export interface TierWithFeatures extends Tier {
  features: string[];
}

/**
 * Input type for creating a new tier
 */
export type CreateTierInput = Omit<Tier, 'id' | 'created_at' | 'updated_at'>;

/**
 * Input type for updating a tier
 */
export type UpdateTierInput = Partial<Omit<Tier, 'id' | 'tier_key' | 'tier_level' | 'created_at' | 'updated_at'>>;

/**
 * Repository for tier and tier-feature queries
 */
export class TierRepository {
  /**
   * Get all active tiers with their features (includes inheritance via tier_level)
   * @returns Array of active tiers with resolved feature arrays
   */
  async getAllWithFeatures(): Promise<TierWithFeatures[]> {
    const pool = getPool();
    const result = await pool.query<TierWithFeatures>(
      `SELECT
        t.id, t.tier_key, t.display_name, t.description, t.tier_level, t.is_active, t.metadata,
        t.created_at, t.updated_at,
        COALESCE(
          array_agg(f.feature_key ORDER BY f.feature_key) FILTER (WHERE f.feature_key IS NOT NULL),
          '{}'::text[]
        ) as features
      FROM licensing.tiers t
      LEFT JOIN licensing.tier_features tf ON t.id = tf.tier_id
      LEFT JOIN licensing.feature_definitions f ON tf.feature_id = f.id AND f.is_active = true
      WHERE t.is_active = true
      GROUP BY t.id
      ORDER BY t.tier_level ASC`
    );
    return result.rows;
  }

  /**
   * Get a single tier by key with all its features (includes inheritance)
   * @param tierKey - The tier key to lookup
   * @returns Tier with features or null
   */
  async getByKeyWithFeatures(tierKey: string): Promise<TierWithFeatures | null> {
    const pool = getPool();

    // First get the tier
    const tierResult = await pool.query<Tier>(
      'SELECT * FROM licensing.tiers WHERE tier_key = $1',
      [tierKey]
    );

    if (tierResult.rows.length === 0) {
      return null;
    }

    const tier = tierResult.rows[0];

    // Get all features for this tier (including inherited)
    const features = await this.getFeaturesForTier(tierKey);

    return {
      ...tier,
      features,
    };
  }

  /**
   * Get just the feature keys array for a tier (includes tier inheritance)
   * Features from all tiers at or below this tier's level are included
   * @param tierKey - The tier key to lookup
   * @returns Array of feature keys
   */
  async getFeaturesForTier(tierKey: string): Promise<string[]> {
    const pool = getPool();
    const result = await pool.query<{ feature_key: string }>(
      `SELECT DISTINCT f.feature_key
      FROM licensing.feature_definitions f
      JOIN licensing.tier_features tf ON tf.feature_id = f.id
      JOIN licensing.tiers t ON t.id = tf.tier_id
      WHERE t.tier_level <= (SELECT tier_level FROM licensing.tiers WHERE tier_key = $1)
        AND f.is_active = TRUE
        AND t.is_active = TRUE
      ORDER BY f.feature_key ASC`,
      [tierKey]
    );
    return result.rows.map(row => row.feature_key);
  }

  /**
   * Get all tiers (including inactive, for admin purposes)
   * @returns Array of all tiers
   */
  async getAll(): Promise<Tier[]> {
    const pool = getPool();
    const result = await pool.query<Tier>(
      'SELECT * FROM licensing.tiers ORDER BY tier_level ASC'
    );
    return result.rows;
  }

  /**
   * Get a tier by its UUID
   * @param id - Tier UUID
   * @returns Tier or null
   */
  async getById(id: string): Promise<Tier | null> {
    const pool = getPool();
    const result = await pool.query<Tier>(
      'SELECT * FROM licensing.tiers WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get a tier by its key
   * @param tierKey - Tier key
   * @returns Tier or null
   */
  async getByKey(tierKey: string): Promise<Tier | null> {
    const pool = getPool();
    const result = await pool.query<Tier>(
      'SELECT * FROM licensing.tiers WHERE tier_key = $1',
      [tierKey]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a new tier
   * @param tier - Tier data (without id, created_at, updated_at)
   * @returns The created tier
   */
  async create(tier: CreateTierInput): Promise<Tier> {
    const pool = getPool();
    const result = await pool.query<Tier>(
      `INSERT INTO licensing.tiers (
        tier_key, display_name, description, tier_level, is_active, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        tier.tier_key,
        tier.display_name,
        tier.description,
        tier.tier_level,
        tier.is_active,
        JSON.stringify(tier.metadata),
      ]
    );
    return result.rows[0];
  }

  /**
   * Update a tier's metadata (tier_key and tier_level cannot be changed)
   * @param id - Tier UUID
   * @param updates - Partial tier data to update
   */
  async update(id: string, updates: UpdateTierInput): Promise<void> {
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
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updates.is_active);
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
      `UPDATE licensing.tiers SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  /**
   * Replace all features for a tier (does not affect inheritance)
   * This only sets the direct features for this tier - inherited features come from lower tiers
   * @param tierId - Tier UUID
   * @param featureKeys - Array of feature keys to assign to this tier
   */
  async setTierFeatures(tierId: string, featureKeys: string[]): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Delete existing tier features
      await client.query(
        'DELETE FROM licensing.tier_features WHERE tier_id = $1',
        [tierId]
      );

      // Insert new features if any
      if (featureKeys.length > 0) {
        // Get feature IDs for the keys
        const featureResult = await client.query<{ id: string; feature_key: string }>(
          'SELECT id, feature_key FROM licensing.feature_definitions WHERE feature_key = ANY($1)',
          [featureKeys]
        );

        const featureMap = new Map(featureResult.rows.map(f => [f.feature_key, f.id]));

        // Validate all features exist
        const missingFeatures = featureKeys.filter(key => !featureMap.has(key));
        if (missingFeatures.length > 0) {
          throw new Error(`Feature keys not found: ${missingFeatures.join(', ')}`);
        }

        // Insert tier_features using parameterized queries to prevent SQL injection
        const insertValues: string[] = [];
        const insertParams: string[] = [];
        let paramIndex = 1;

        for (const key of featureKeys) {
          const featureId = featureMap.get(key);
          insertValues.push(`($${paramIndex}, $${paramIndex + 1})`);
          insertParams.push(tierId, featureId!);
          paramIndex += 2;
        }

        await client.query(
          `INSERT INTO licensing.tier_features (tier_id, feature_id) VALUES ${insertValues.join(',')}`,
          insertParams
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Add a single feature to a tier
   * @param tierId - Tier UUID
   * @param featureKey - Feature key to add
   */
  async addFeatureToTier(tierId: string, featureKey: string): Promise<void> {
    const pool = getPool();

    // Get feature ID
    const featureResult = await pool.query<{ id: string }>(
      'SELECT id FROM licensing.feature_definitions WHERE feature_key = $1',
      [featureKey]
    );

    if (featureResult.rows.length === 0) {
      throw new Error(`Feature key not found: ${featureKey}`);
    }

    const featureId = featureResult.rows[0].id;

    // Insert tier_feature (ON CONFLICT DO NOTHING handles duplicates)
    await pool.query(
      `INSERT INTO licensing.tier_features (tier_id, feature_id)
      VALUES ($1, $2)
      ON CONFLICT (tier_id, feature_id) DO NOTHING`,
      [tierId, featureId]
    );
  }

  /**
   * Remove a single feature from a tier
   * @param tierId - Tier UUID
   * @param featureKey - Feature key to remove
   */
  async removeFeatureFromTier(tierId: string, featureKey: string): Promise<void> {
    const pool = getPool();

    await pool.query(
      `DELETE FROM licensing.tier_features tf
      WHERE tf.tier_id = $1
        AND tf.feature_id = (
          SELECT id FROM licensing.feature_definitions WHERE feature_key = $2
        )`,
      [tierId, featureKey]
    );
  }

  /**
   * Deactivate (soft delete) a tier
   * @param id - Tier UUID
   */
  async deactivate(id: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.tiers
       SET is_active = false, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * Activate a tier
   * @param id - Tier UUID
   */
  async activate(id: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.tiers
       SET is_active = true, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * Get the direct (non-inherited) features for a tier
   * @param tierId - Tier UUID
   * @returns Array of feature keys directly assigned to this tier
   */
  async getDirectFeaturesForTier(tierId: string): Promise<string[]> {
    const pool = getPool();
    const result = await pool.query<{ feature_key: string }>(
      `SELECT f.feature_key
      FROM licensing.feature_definitions f
      JOIN licensing.tier_features tf ON tf.feature_id = f.id
      WHERE tf.tier_id = $1
        AND f.is_active = TRUE
      ORDER BY f.feature_key ASC`,
      [tierId]
    );
    return result.rows.map(row => row.feature_key);
  }

  /**
   * Validate that a tier_level is unique (for creating/updating tiers)
   * @param tierLevel - The tier level to check
   * @param excludeTierId - Optional tier ID to exclude (for updates)
   * @returns True if the tier level is available
   */
  async isTierLevelAvailable(tierLevel: number, excludeTierId?: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      excludeTierId
        ? 'SELECT COUNT(*) as count FROM licensing.tiers WHERE tier_level = $1 AND id != $2'
        : 'SELECT COUNT(*) as count FROM licensing.tiers WHERE tier_level = $1',
      excludeTierId ? [tierLevel, excludeTierId] : [tierLevel]
    );
    const count = parseInt(result.rows[0].count, 10);
    return count === 0;
  }

  /**
   * Get features for a tier by ID (includes tier inheritance)
   * @param tierId - Tier UUID
   * @returns Array of feature keys
   */
  async getFeaturesForTierById(tierId: string): Promise<string[]> {
    const pool = getPool();
    const result = await pool.query<{ feature_key: string }>(
      `SELECT DISTINCT f.feature_key
      FROM licensing.feature_definitions f
      JOIN licensing.tier_features tf ON tf.feature_id = f.id
      JOIN licensing.tiers t ON t.id = tf.tier_id
      WHERE t.tier_level <= (SELECT tier_level FROM licensing.tiers WHERE id = $1)
        AND f.is_active = TRUE
        AND t.is_active = TRUE
      ORDER BY f.feature_key ASC`,
      [tierId]
    );
    return result.rows.map(row => row.feature_key);
  }

  /**
   * Get the free tier (tier_key = 'free', tier_level = 0)
   * Used for default license creation
   * @returns Free tier or null
   */
  async getFreeTier(): Promise<Tier | null> {
    const pool = getPool();
    const result = await pool.query<Tier>(
      "SELECT * FROM licensing.tiers WHERE tier_key = 'free' AND is_active = TRUE"
    );
    return result.rows[0] || null;
  }

  /**
   * Get a tier by ID with features (includes inheritance)
   * @param tierId - Tier UUID
   * @returns Tier with features or null
   */
  async getByIdWithFeatures(tierId: string): Promise<TierWithFeatures | null> {
    const pool = getPool();
    const tierResult = await pool.query<Tier>(
      'SELECT * FROM licensing.tiers WHERE id = $1',
      [tierId]
    );

    if (tierResult.rows.length === 0) {
      return null;
    }

    const tier = tierResult.rows[0];
    const features = await this.getFeaturesForTierById(tierId);

    return {
      ...tier,
      features,
    };
  }
}

// Export singleton instance
export const tierRepository = new TierRepository();
