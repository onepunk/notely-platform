"use strict";

const shared = require('@notely/shared');

const db = shared.database;
const logger = shared.logger.child({ module: 'users-login-activity' });

async function recordLoginEvent({ authUserId, occurredAt, ip, userAgent }) {
  if (!authUserId || !occurredAt) {
    logger.warn('Skipping login activity record due to missing fields', { authUserId, occurredAt });
    return;
  }

  const query = `
    INSERT INTO user_profiles.login_activity (auth_user_id, last_login_at, last_login_ip, last_login_user_agent, login_count)
    VALUES ($1, $2, $3::inet, $4, 1)
    ON CONFLICT (auth_user_id)
    DO UPDATE SET
      last_login_at = EXCLUDED.last_login_at,
      last_login_ip = COALESCE(EXCLUDED.last_login_ip, user_profiles.login_activity.last_login_ip),
      last_login_user_agent = COALESCE(EXCLUDED.last_login_user_agent, user_profiles.login_activity.last_login_user_agent),
      login_count = user_profiles.login_activity.login_count + 1,
      updated_at = NOW()
    RETURNING auth_user_id, last_login_at, login_count;
  `;

  try {
    const result = await db.query(query, [authUserId, occurredAt, ip || null, userAgent || null]);
    const row = result.rows[0];
    logger.debug('Login activity recorded', {
      authUserId,
      lastLoginAt: row?.last_login_at,
      loginCount: row?.login_count
    });
  } catch (error) {
    logger.error('Failed to upsert login activity', {
      error: error.message,
      authUserId
    });
  }
}

module.exports = {
  recordLoginEvent
};
