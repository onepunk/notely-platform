import { getPool } from '../lib/database';
import { LicenseValidation, CreateValidationInput } from '../models/types';

/**
 * Repository for license validation logging and history
 */
export class ValidationRepository {
  /**
   * Log a license validation attempt
   * @param validation - Validation data (without id, validated_at)
   */
  async logValidation(validation: CreateValidationInput): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO licensing.license_validations (
        license_id, license_key_hash, is_valid, validation_type,
        failure_reason, validated_by_service, client_version,
        ip_address, user_agent, request_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        validation.license_id,
        validation.license_key_hash,
        validation.is_valid,
        validation.validation_type,
        validation.failure_reason,
        validation.validated_by_service,
        validation.client_version,
        validation.ip_address,
        validation.user_agent,
        JSON.stringify(validation.request_metadata),
      ]
    );
  }

  /**
   * Get validation history for a license
   * @param licenseId - License UUID
   * @param limit - Maximum number of records to return (default: 100)
   * @returns Array of validation records
   */
  async getValidationHistory(licenseId: string, limit: number = 100): Promise<LicenseValidation[]> {
    const pool = getPool();
    const result = await pool.query<LicenseValidation>(
      `SELECT * FROM licensing.license_validations
       WHERE license_id = $1
       ORDER BY validated_at DESC
       LIMIT $2`,
      [licenseId, limit]
    );
    return result.rows;
  }

  /**
   * Get validation history by license key hash
   * @param licenseKeyHash - Hashed license key
   * @param limit - Maximum number of records to return (default: 100)
   * @returns Array of validation records
   */
  async getValidationHistoryByHash(licenseKeyHash: string, limit: number = 100): Promise<LicenseValidation[]> {
    const pool = getPool();
    const result = await pool.query<LicenseValidation>(
      `SELECT * FROM licensing.license_validations
       WHERE license_key_hash = $1
       ORDER BY validated_at DESC
       LIMIT $2`,
      [licenseKeyHash, limit]
    );
    return result.rows;
  }

  /**
   * Count total validations for a license
   * @param licenseId - License UUID
   * @returns Total validation count
   */
  async getValidationCount(licenseId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM licensing.license_validations WHERE license_id = $1',
      [licenseId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Count failed validations for a license
   * @param licenseId - License UUID
   * @returns Failed validation count
   */
  async getFailedValidationCount(licenseId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM licensing.license_validations
       WHERE license_id = $1 AND is_valid = false`,
      [licenseId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get recent failed validations across all licenses
   * @param limit - Maximum number of records to return (default: 50)
   * @returns Array of failed validation records
   */
  async getRecentFailures(limit: number = 50): Promise<LicenseValidation[]> {
    const pool = getPool();
    const result = await pool.query<LicenseValidation>(
      `SELECT * FROM licensing.license_validations
       WHERE is_valid = false
       ORDER BY validated_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  /**
   * Get validation statistics for a time period
   * @param sinceDate - Start date for statistics
   * @returns Object with success/failure counts
   */
  async getValidationStats(sinceDate: Date): Promise<{ total: number; successful: number; failed: number }> {
    const pool = getPool();
    const result = await pool.query<{ total: string; successful: string; failed: string }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_valid = true) as successful,
        COUNT(*) FILTER (WHERE is_valid = false) as failed
       FROM licensing.license_validations
       WHERE validated_at >= $1`,
      [sinceDate]
    );
    const row = result.rows[0];
    return {
      total: parseInt(row.total, 10),
      successful: parseInt(row.successful, 10),
      failed: parseInt(row.failed, 10),
    };
  }

  /**
   * Get validation attempts from a specific IP address
   * @param ipAddress - IP address to search for
   * @param limit - Maximum number of records to return (default: 50)
   * @returns Array of validation records
   */
  async getValidationsByIp(ipAddress: string, limit: number = 50): Promise<LicenseValidation[]> {
    const pool = getPool();
    const result = await pool.query<LicenseValidation>(
      `SELECT * FROM licensing.license_validations
       WHERE ip_address = $1
       ORDER BY validated_at DESC
       LIMIT $2`,
      [ipAddress, limit]
    );
    return result.rows;
  }
}

// Export singleton instance
export const validationRepository = new ValidationRepository();
