import { getPool } from '../lib/database';
import { ActiveSession, CreateSessionInput } from '../models/types';

/**
 * Repository for concurrent session tracking
 */
export class SessionRepository {
  /**
   * Upsert (insert or update) a session record
   * Updates last_heartbeat if session_token already exists, otherwise creates new session
   * @param session - Session data (without id, created_at, first_seen, last_heartbeat)
   * @returns The upserted session record
   */
  async upsertSession(session: CreateSessionInput): Promise<ActiveSession> {
    const pool = getPool();
    const result = await pool.query<ActiveSession>(
      `INSERT INTO licensing.active_sessions (
        user_id, client_id, session_token, license_id, organization_id,
        client_version, platform, ip_address, is_active, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (session_token)
      DO UPDATE SET
        last_heartbeat = NOW(),
        is_active = EXCLUDED.is_active,
        metadata = EXCLUDED.metadata
      RETURNING *`,
      [
        session.user_id,
        session.client_id,
        session.session_token,
        session.license_id,
        session.organization_id,
        session.client_version,
        session.platform,
        session.ip_address,
        session.is_active,
        JSON.stringify(session.metadata),
      ]
    );
    return result.rows[0];
  }

  /**
   * Record a heartbeat for an active session
   * @param sessionToken - Session token
   */
  async recordHeartbeat(sessionToken: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.active_sessions
       SET last_heartbeat = NOW()
       WHERE session_token = $1`,
      [sessionToken]
    );
  }

  /**
   * Get active session count for an organization
   * @param orgId - Organization UUID
   * @param staleLimitMinutes - Minutes after which a session is considered stale (default: 5)
   * @returns Count of active sessions
   */
  async getActiveCount(orgId: string, staleLimitMinutes: number = 5): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM licensing.active_sessions
       WHERE organization_id = $1
       AND is_active = true
       AND last_heartbeat > NOW() - INTERVAL '${staleLimitMinutes} minutes'`,
      [orgId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get active session count for a user
   * @param userId - User UUID
   * @param staleLimitMinutes - Minutes after which a session is considered stale (default: 5)
   * @returns Count of active sessions
   */
  async getActiveCountByUser(userId: string, staleLimitMinutes: number = 5): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM licensing.active_sessions
       WHERE user_id = $1
       AND is_active = true
       AND last_heartbeat > NOW() - INTERVAL '${staleLimitMinutes} minutes'`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get all active sessions for an organization
   * @param orgId - Organization UUID
   * @param staleLimitMinutes - Minutes after which a session is considered stale (default: 5)
   * @returns Array of active sessions
   */
  async getActiveSessions(orgId: string, staleLimitMinutes: number = 5): Promise<ActiveSession[]> {
    const pool = getPool();
    const result = await pool.query<ActiveSession>(
      `SELECT * FROM licensing.active_sessions
       WHERE organization_id = $1
       AND is_active = true
       AND last_heartbeat > NOW() - INTERVAL '${staleLimitMinutes} minutes'
       ORDER BY last_heartbeat DESC`,
      [orgId]
    );
    return result.rows;
  }

  /**
   * Get all active sessions for a user
   * @param userId - User UUID
   * @param staleLimitMinutes - Minutes after which a session is considered stale (default: 5)
   * @returns Array of active sessions
   */
  async getActiveSessionsByUser(userId: string, staleLimitMinutes: number = 5): Promise<ActiveSession[]> {
    const pool = getPool();
    const result = await pool.query<ActiveSession>(
      `SELECT * FROM licensing.active_sessions
       WHERE user_id = $1
       AND is_active = true
       AND last_heartbeat > NOW() - INTERVAL '${staleLimitMinutes} minutes'
       ORDER BY last_heartbeat DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Deactivate a session by session token
   * @param sessionToken - Session token
   */
  async deactivateSession(sessionToken: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.active_sessions
       SET is_active = false
       WHERE session_token = $1`,
      [sessionToken]
    );
  }

  /**
   * Deactivate all sessions for a user
   * @param userId - User UUID
   */
  async deactivateUserSessions(userId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.active_sessions
       SET is_active = false
       WHERE user_id = $1`,
      [userId]
    );
  }

  /**
   * Deactivate all sessions for an organization
   * @param orgId - Organization UUID
   */
  async deactivateOrgSessions(orgId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE licensing.active_sessions
       SET is_active = false
       WHERE organization_id = $1`,
      [orgId]
    );
  }

  /**
   * Clean up stale sessions (mark as inactive)
   * @param staleLimitMinutes - Minutes after which a session is considered stale (default: 30)
   * @returns Number of sessions cleaned up
   */
  async cleanupStaleSessions(staleLimitMinutes: number = 30): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE licensing.active_sessions
       SET is_active = false
       WHERE is_active = true
       AND last_heartbeat < NOW() - INTERVAL '${staleLimitMinutes} minutes'`
    );
    return result.rowCount || 0;
  }

  /**
   * Get session by token
   * @param sessionToken - Session token
   * @returns Session or null
   */
  async getByToken(sessionToken: string): Promise<ActiveSession | null> {
    const pool = getPool();
    const result = await pool.query<ActiveSession>(
      'SELECT * FROM licensing.active_sessions WHERE session_token = $1',
      [sessionToken]
    );
    return result.rows[0] || null;
  }

  /**
   * Get session statistics for an organization
   * @param orgId - Organization UUID
   * @returns Object with session statistics
   */
  async getSessionStats(orgId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    stale: number;
  }> {
    const pool = getPool();
    const result = await pool.query<{
      total: string;
      active: string;
      inactive: string;
      stale: string;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true AND last_heartbeat > NOW() - INTERVAL '5 minutes') as active,
        COUNT(*) FILTER (WHERE is_active = false) as inactive,
        COUNT(*) FILTER (WHERE is_active = true AND last_heartbeat <= NOW() - INTERVAL '5 minutes') as stale
       FROM licensing.active_sessions
       WHERE organization_id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    return {
      total: parseInt(row.total, 10),
      active: parseInt(row.active, 10),
      inactive: parseInt(row.inactive, 10),
      stale: parseInt(row.stale, 10),
    };
  }

  /**
   * Delete old session records (for cleanup)
   * @param daysOld - Delete sessions older than this many days (default: 90)
   * @returns Number of sessions deleted
   */
  async deleteOldSessions(daysOld: number = 90): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM licensing.active_sessions
       WHERE created_at < NOW() - INTERVAL '${daysOld} days'`
    );
    return result.rowCount || 0;
  }
}

// Export singleton instance
export const sessionRepository = new SessionRepository();
