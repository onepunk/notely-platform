/**
 * Activation Repository
 *
 * Repository for license activation CRUD operations.
 * Handles email-bound activations for Notely AI (na-) licenses.
 */

import { createHash } from 'crypto';
import { getPool } from '../lib/database';

/**
 * License activation record
 */
export interface LicenseActivation {
  id: string;
  license_id: string;
  user_email: string;
  user_email_hash: string;
  activated_at: Date;
  deactivated_at: Date | null;
  platform: string | null;
  app_version: string | null;
  activation_ip: string | null;
  last_online_validation: Date | null;
  offline_grace_deadline: Date | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input for creating an activation
 */
export interface CreateActivationInput {
  license_id: string;
  user_email: string;
  platform?: string;
  app_version?: string;
  activation_ip?: string;
  offline_grace_deadline?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Activation with license details
 */
export interface ActivationWithLicense extends LicenseActivation {
  license_key: string;
  license_type: string;
  activation_limit: number;
  activation_count: number;
  offline_grace_days: number;
  revalidation_interval_hours: number;
  tier_id: string | null;
  features: string[];
  expires_at: Date | null;
  revoked_at: Date | null;
}

export class ActivationRepository {
  /**
   * Hash an email address for secure lookups
   */
  static hashEmail(email: string): string {
    const normalized = email.toLowerCase().trim();
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Mask an email address for display (e.g., "j***n@example.com")
   */
  static maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!domain || localPart.length <= 2) {
      return `${localPart.charAt(0)}***@${domain || 'unknown'}`;
    }
    return `${localPart.charAt(0)}***${localPart.charAt(localPart.length - 1)}@${domain}`;
  }

  /**
   * Create a new activation
   */
  async create(input: CreateActivationInput): Promise<LicenseActivation> {
    const pool = getPool();
    const emailHash = ActivationRepository.hashEmail(input.user_email);

    const result = await pool.query<LicenseActivation>(
      `INSERT INTO licensing.license_activations (
        license_id, user_email, user_email_hash, platform, app_version,
        activation_ip, offline_grace_deadline, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        input.license_id,
        input.user_email.toLowerCase().trim(),
        emailHash,
        input.platform || null,
        input.app_version || null,
        input.activation_ip || null,
        input.offline_grace_deadline || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );

    return result.rows[0];
  }

  /**
   * Find an activation by ID
   */
  async findById(id: string): Promise<LicenseActivation | null> {
    const pool = getPool();
    const result = await pool.query<LicenseActivation>(
      'SELECT * FROM licensing.license_activations WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Find activation by license ID and email
   */
  async findByLicenseAndEmail(licenseId: string, email: string): Promise<LicenseActivation | null> {
    const pool = getPool();
    const emailHash = ActivationRepository.hashEmail(email);

    const result = await pool.query<LicenseActivation>(
      `SELECT * FROM licensing.license_activations
       WHERE license_id = $1 AND user_email_hash = $2`,
      [licenseId, emailHash]
    );
    return result.rows[0] || null;
  }

  /**
   * Find all active (non-deactivated) activations for a license
   */
  async findActiveByLicense(licenseId: string): Promise<LicenseActivation[]> {
    const pool = getPool();
    const result = await pool.query<LicenseActivation>(
      `SELECT * FROM licensing.license_activations
       WHERE license_id = $1 AND deactivated_at IS NULL
       ORDER BY activated_at DESC`,
      [licenseId]
    );
    return result.rows;
  }

  /**
   * Find activation with full license details
   */
  async findByIdWithLicense(id: string): Promise<ActivationWithLicense | null> {
    const pool = getPool();
    const result = await pool.query<ActivationWithLicense>(
      `SELECT
        a.*,
        l.license_key,
        l.license_type,
        l.activation_limit,
        l.activation_count,
        l.offline_grace_days,
        l.revalidation_interval_hours,
        l.tier_id,
        l.features,
        l.expires_at,
        l.revoked_at
      FROM licensing.license_activations a
      JOIN licensing.licenses l ON a.license_id = l.id
      WHERE a.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Count active activations for a license
   */
  async countActiveByLicense(licenseId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM licensing.license_activations
       WHERE license_id = $1 AND deactivated_at IS NULL`,
      [licenseId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Deactivate an activation
   */
  async deactivate(id: string): Promise<LicenseActivation | null> {
    const pool = getPool();
    const result = await pool.query<LicenseActivation>(
      `UPDATE licensing.license_activations
       SET deactivated_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Deactivate all active activations for a license (bulk reset)
   */
  async deactivateAllByLicense(licenseId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE licensing.license_activations
       SET deactivated_at = NOW(), updated_at = NOW()
       WHERE license_id = $1 AND deactivated_at IS NULL`,
      [licenseId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Update last online validation timestamp and extend grace deadline
   */
  async updateValidation(
    id: string,
    offlineGraceDeadline: Date
  ): Promise<LicenseActivation | null> {
    const pool = getPool();
    const result = await pool.query<LicenseActivation>(
      `UPDATE licensing.license_activations
       SET last_online_validation = NOW(),
           offline_grace_deadline = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, offlineGraceDeadline]
    );
    return result.rows[0] || null;
  }

  /**
   * Get the first (oldest) active activation for a license
   * Used when a user tries to activate with a different email at limit
   */
  async findFirstActiveByLicense(licenseId: string): Promise<LicenseActivation | null> {
    const pool = getPool();
    const result = await pool.query<LicenseActivation>(
      `SELECT * FROM licensing.license_activations
       WHERE license_id = $1 AND deactivated_at IS NULL
       ORDER BY activated_at ASC
       LIMIT 1`,
      [licenseId]
    );
    return result.rows[0] || null;
  }

  /**
   * Check if email is already activated on any license
   */
  async findActiveByEmail(email: string): Promise<LicenseActivation[]> {
    const pool = getPool();
    const emailHash = ActivationRepository.hashEmail(email);

    const result = await pool.query<LicenseActivation>(
      `SELECT * FROM licensing.license_activations
       WHERE user_email_hash = $1 AND deactivated_at IS NULL
       ORDER BY activated_at DESC`,
      [emailHash]
    );
    return result.rows;
  }

  /**
   * Update platform and app version info
   */
  async updateClientInfo(
    id: string,
    platform: string,
    appVersion: string
  ): Promise<LicenseActivation | null> {
    const pool = getPool();
    const result = await pool.query<LicenseActivation>(
      `UPDATE licensing.license_activations
       SET platform = $2, app_version = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, platform, appVersion]
    );
    return result.rows[0] || null;
  }
}

// Export singleton instance
export const activationRepository = new ActivationRepository();
