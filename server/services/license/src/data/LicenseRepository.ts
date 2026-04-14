import { getPool } from '../lib/database';
import { License, CreateLicenseInput } from '../models/types';

/**
 * Repository for license CRUD operations
 */
export class LicenseRepository {
  /**
   * Create a new license
   * @param license - License data (without id, created_at, updated_at)
   * @returns The created license record
   */
  async create(license: CreateLicenseInput, options?: { id?: string }): Promise<License> {
    const pool = getPool();
    const columns = [
      'license_key',
      'license_type',
      'organization_id',
      'user_id',
      'features',
      'limits',
      'issued_at',
      'expires_at',
      'revoked_at',
      'revocation_reason',
      'hardware_id',
      'issued_by',
      'notes',
      'tier_id',  // Required FK to tiers table
      'grant_type',  // How the license was acquired
    ];

    const values: unknown[] = [
      license.license_key,
      license.license_type,
      license.organization_id,
      license.user_id,
      JSON.stringify(license.features),
      JSON.stringify(license.limits),
      license.issued_at,
      license.expires_at,
      license.revoked_at,
      license.revocation_reason,
      license.hardware_id,
      license.issued_by,
      license.notes,
      license.tier_id,
      license.grant_type || 'purchase',  // Default to 'purchase' if not specified
    ];

    if (options?.id) {
      columns.unshift('id');
      values.unshift(options.id);
    }

    const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
    const result = await pool.query<License>(
      `INSERT INTO licensing.licenses (${columns.join(', ')})
       VALUES (${placeholders})
       RETURNING *`,
      values
    );
    return result.rows[0];
  }

  /**
   * Find a license by ID
   * @param id - License UUID
   * @returns License or null if not found
   */
  async findById(id: string): Promise<License | null> {
    const pool = getPool();
    const result = await pool.query<License>(
      'SELECT * FROM licensing.licenses WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Find a license by license key
   * @param licenseKey - The license key string
   * @returns License or null if not found
   */
  async findByKey(licenseKey: string): Promise<License | null> {
    const pool = getPool();
    const result = await pool.query<License>(
      'SELECT * FROM licensing.licenses WHERE license_key = $1',
      [licenseKey]
    );
    return result.rows[0] || null;
  }

  /**
   * Find all licenses for an organization
   * @param orgId - Organization UUID
   * @returns Array of licenses
   */
  async findByOrganization(orgId: string): Promise<License[]> {
    const pool = getPool();
    const result = await pool.query<License>(
      'SELECT * FROM licensing.licenses WHERE organization_id = $1 ORDER BY created_at DESC',
      [orgId]
    );
    return result.rows;
  }

  /**
   * Find all licenses for a user
   * @param userId - User UUID
   * @returns Array of licenses
   */
  async findByUser(userId: string): Promise<License[]> {
    const pool = getPool();
    const result = await pool.query<License>(
      'SELECT * FROM licensing.licenses WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  }

  /**
   * Find the most recently issued license for an organization
   */
  async findLatestPortalLicense(orgId: string): Promise<License | null> {
    const pool = getPool();
    const result = await pool.query<License>(
      `SELECT * FROM licensing.licenses
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [orgId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find the most recently issued desktop license for a user
   */
  async findLatestDesktopLicense(userId: string): Promise<License | null> {
    const pool = getPool();
    const result = await pool.query<License>(
      `SELECT * FROM licensing.licenses
       WHERE user_id = $1
         AND license_type = 'desktop'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find active (non-revoked, non-expired) portal license for an organization
   */
  async findActivePortalLicense(orgId: string): Promise<License | null> {
    const pool = getPool();
    const result = await pool.query<License>(
      `SELECT * FROM licensing.licenses
       WHERE organization_id = $1
         AND license_type = 'portal'
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 1`,
      [orgId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find active (non-revoked, non-expired) desktop license for a user
   */
  async findActiveDesktopLicense(userId: string): Promise<License | null> {
    const pool = getPool();
    const result = await pool.query<License>(
      `SELECT * FROM licensing.licenses
       WHERE user_id = $1
         AND license_type = 'desktop'
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find active (non-revoked, non-expired) notely-ai license for a user
   */
  async findActiveNotelyAiLicense(userId: string): Promise<License | null> {
    const pool = getPool();
    const result = await pool.query<License>(
      `SELECT * FROM licensing.licenses
       WHERE user_id = $1
         AND license_type = 'notely-ai'
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find the most recently issued notely-ai license for a user
   */
  async findLatestNotelyAiLicense(userId: string): Promise<License | null> {
    const pool = getPool();
    const result = await pool.query<License>(
      `SELECT * FROM licensing.licenses
       WHERE user_id = $1
         AND license_type = 'notely-ai'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Revoke a license
   * @param id - License UUID
   * @param reason - Revocation reason
   */
  async revoke(id: string, reason: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.licenses
       SET revoked_at = NOW(), revocation_reason = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, reason]
    );
  }

  /**
   * Find all active (non-revoked, non-expired) licenses
   * @returns Array of active licenses
   */
  async findActive(): Promise<License[]> {
    const pool = getPool();
    const result = await pool.query<License>(
      `SELECT * FROM licensing.licenses
       WHERE revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  /**
   * Update license limits
   * @param id - License UUID
   * @param limits - New limits object
   */
  async updateLimits(id: string, limits: Record<string, any>): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.licenses
       SET limits = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, JSON.stringify(limits)]
    );
  }

  /**
   * Update license features
   * @param id - License UUID
   * @param features - New features array
   */
  async updateFeatures(id: string, features: string[]): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.licenses
       SET features = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, JSON.stringify(features)]
    );
  }

  /**
   * Update hardware ID for a license
   * @param id - License UUID
   * @param hardwareId - Hardware identifier
   */
  async updateHardwareId(id: string, hardwareId: string | null): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.licenses
       SET hardware_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, hardwareId]
    );
  }

  /**
   * Extend license expiration date
   * @param id - License UUID
   * @param newExpiresAt - New expiration date
   */
  async extendExpiration(id: string, newExpiresAt: Date | null): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.licenses
       SET expires_at = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, newExpiresAt]
    );
  }

  /**
   * Find all licenses for a user with tier information
   * Returns ALL licenses (active, revoked, expired) ordered by creation date
   */
  async findByUserWithTiers(userId: string): Promise<(License & { tier_key?: string; tier_name?: string })[]> {
    const pool = getPool();
    const result = await pool.query<License & { tier_key?: string; tier_name?: string }>(
      `SELECT l.*, t.tier_key, t.display_name as tier_name
       FROM licensing.licenses l
       LEFT JOIN licensing.tiers t ON l.tier_id = t.id
       WHERE l.user_id = $1
       ORDER BY l.created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Revoke all active (non-revoked, non-expired) licenses for a user
   * Returns the count of revoked licenses
   */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE licensing.licenses
       SET revoked_at = NOW(), revocation_reason = $2, updated_at = NOW()
       WHERE user_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId, reason]
    );
    return result.rowCount ?? 0;
  }
}

// Export singleton instance
export const licenseRepository = new LicenseRepository();
