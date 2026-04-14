/**
 * Auth Model - Database Queries
 *
 * Handles database operations for authentication (users and sessions).
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const shared = require('@notely/shared');
const db = shared.database;
const cache = shared.cache;
const logger = shared.logger;

/**
 * Get user by email
 */
async function getUserByEmail(email) {
  const cacheKey = `user:email:${email}`;

  try {
    // Check cache first
    const cached = await cache.getCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Query database (auth schema owns credential records)
    const result = await db.query(
      `SELECT id, email, password_hash, first_name, last_name, role,
              is_active, email_verified, password_updated_at, created_at, updated_at,
              is_protected, must_change_password
       FROM global_auth.user_credentials
       WHERE email = $1 AND is_active = true`,
      [email]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];

    // Cache for 5 minutes
    await cache.setCache(cacheKey, user, 300);

    return user;
  } catch (error) {
    logger.error('Error fetching user by email', { error: error.message, email });
    throw error;
  }
}

/**
 * Get user by ID
 */
async function getUserById(userId) {
  const cacheKey = `user:id:${userId}`;

  try {
    // Check cache
    const cached = await cache.getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await db.query(
      `SELECT id, email, first_name, last_name, role, is_active,
              email_verified, password_updated_at, created_at, updated_at,
              is_protected, must_change_password
       FROM global_auth.user_credentials
       WHERE id = $1 AND is_active = true`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];

    // Cache for 5 minutes
    await cache.setCache(cacheKey, user, 300);

    return user;
  } catch (error) {
    logger.error('Error fetching user by ID', { error: error.message, userId });
    throw error;
  }
}

/**
 * Get user by ID including password hash (for password verification operations)
 * This function does NOT cache results for security reasons
 */
async function getUserByIdWithPassword(userId) {
  try {
    const result = await db.query(
      `SELECT id, email, password_hash, first_name, last_name, role, is_active,
              email_verified, password_updated_at, created_at, updated_at,
              is_protected, must_change_password
       FROM global_auth.user_credentials
       WHERE id = $1 AND is_active = true`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error fetching user by ID with password', { error: error.message, userId });
    throw error;
  }
}

/**
 * Create session (store JWT token)
 */
async function createSession(userId, token, expiresAt) {
  try {
    await db.query(
      `INSERT INTO global_auth.sessions (user_id, token, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (token) DO UPDATE SET expires_at = $3`,
      [userId, token, expiresAt]
    );

    logger.info('Session created', { userId, expiresAt });
  } catch (error) {
    logger.error('Error creating session', { error: error.message, userId });
    throw error;
  }
}

/**
 * Get session by token
 */
async function getSession(token) {
  const cacheKey = `session:${token}`;

  try {
    // Check cache
    const cached = await cache.getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await db.query(
      `SELECT user_id, token, expires_at, created_at
       FROM global_auth.sessions
       WHERE token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const session = result.rows[0];

    // Cache for 1 minute
    await cache.setCache(cacheKey, session, 60);

    return session;
  } catch (error) {
    logger.error('Error fetching session', { error: error.message });
    throw error;
  }
}

/**
 * Update session (refresh token)
 */
async function updateSession(oldToken, newToken, expiresAt) {
  try {
    await db.query(
      `UPDATE global_auth.sessions
       SET token = $1, expires_at = $2
       WHERE token = $3`,
      [newToken, expiresAt, oldToken]
    );

    // Invalidate old cache
    await cache.deleteCache(`session:${oldToken}`);

    logger.info('Session updated', { oldToken: oldToken.substring(0, 20) + '...' });
  } catch (error) {
    logger.error('Error updating session', { error: error.message });
    throw error;
  }
}

/**
 * Update session by ID (for desktop refresh flow)
 * Fetches the old token, updates with new token and expiry
 */
async function updateSessionById(sessionId, newToken, expiresAt) {
  try {
    // First, fetch the existing session to get the old token
    const result = await db.query(
      `SELECT token FROM global_auth.sessions WHERE id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      logger.warn('Session not found by ID', { sessionId });
      return;
    }

    const oldToken = result.rows[0].token;

    // Update the session with new token and expiry
    await db.query(
      `UPDATE global_auth.sessions
       SET token = $1, expires_at = $2
       WHERE id = $3`,
      [newToken, expiresAt, sessionId]
    );

    // Invalidate old cache
    await cache.deleteCache(`session:${oldToken}`);

    logger.info('Session updated by ID', {
      sessionId,
      oldToken: oldToken.substring(0, 20) + '...',
      newToken: newToken.substring(0, 20) + '...'
    });
  } catch (error) {
    logger.error('Error updating session by ID', { error: error.message, sessionId });
    throw error;
  }
}

/**
 * Delete session (logout)
 */
async function deleteSession(token) {
  try {
    await db.query(
      `DELETE FROM global_auth.sessions
       WHERE token = $1`,
      [token]
    );

    // Invalidate cache
    await cache.deleteCache(`session:${token}`);

    logger.info('Session deleted', { token: token.substring(0, 20) + '...' });
  } catch (error) {
    logger.error('Error deleting session', { error: error.message });
    throw error;
  }
}

/**
 * Delete expired sessions (cleanup job)
 */
async function deleteExpiredSessions() {
  try {
    const result = await db.query(
      `DELETE FROM global_auth.sessions
       WHERE expires_at < NOW()
       RETURNING token`
    );

    // Clear cache for deleted sessions
    for (const row of result.rows) {
      await cache.deleteCache(`session:${row.token}`);
    }

    logger.info('Expired sessions deleted', { count: result.rowCount });
    return result.rowCount;
  } catch (error) {
    logger.error('Error deleting expired sessions', { error: error.message });
    throw error;
  }
}

async function updateUserProfileFromEvent(authUserId, updates = {}, changes = {}) {
  const fieldMap = {
    email: 'email',
    firstName: 'first_name',
    lastName: 'last_name'
  };

  const setClauses = [];
  const values = [];

  Object.entries(fieldMap).forEach(([key, column]) => {
    if (Object.prototype.hasOwnProperty.call(updates, key) && updates[key] !== undefined) {
      values.push(updates[key]);
      setClauses.push(`${column} = $${values.length}`);
    }
  });

  if (setClauses.length === 0) {
    return;
  }

  values.push(authUserId);

  const query = `
    UPDATE global_auth.user_credentials
    SET ${setClauses.join(', ')}, updated_at = NOW()
    WHERE id = $${values.length}
  `;

  try {
    const result = await db.query(query, values);
    if (result.rowCount === 0) {
      logger.warn('No auth user updated from profile event', { authUserId });
    }

    await cache.deleteCache(`user:id:${authUserId}`);

    if (updates.email) {
      await cache.deleteCache(`user:email:${updates.email}`);
    }

    const previousEmail = changes?.email?.previous;
    if (previousEmail) {
      await cache.deleteCache(`user:email:${previousEmail}`);
    }

    logger.debug('Auth user projection updated from profile event', {
      authUserId,
      changedFields: Object.keys(updates).filter((key) => updates[key] !== undefined)
    });
  } catch (error) {
    logger.error('Failed to update auth user projection from event', {
      error: error.message,
      authUserId
    });
    throw error;
  }
}

async function createUserCredential({ email, passwordHash, firstName = null, lastName = null, role = 'user', emailVerified = false }) {
  try {
    const result = await db.query(
      `INSERT INTO global_auth.user_credentials (email, password_hash, role, first_name, last_name, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       RETURNING id, email, password_hash, role, first_name, last_name, is_active, email_verified, created_at`,
      [email, passwordHash, role, firstName, lastName, emailVerified]
    );

    const user = result.rows[0];

    if (user) {
      await cache.setCache(`user:email:${user.email}`, user, 300);
      await cache.setCache(`user:id:${user.id}`, user, 300);
    }

    return user;
  } catch (error) {
    logger.error('Error creating user credential', {
      error: error.message,
      email
    });
    throw error;
  }
}

function generateExternalPasswordHash() {
  const randomSecret = crypto.randomBytes(48).toString('base64');
  return bcrypt.hashSync(randomSecret, 10);
}

async function createExternalUserCredential({
  email,
  firstName = null,
  lastName = null,
  role = 'user',
  emailVerified = true
}) {
  const passwordHash = generateExternalPasswordHash();

  try {
    const result = await db.query(
      `INSERT INTO global_auth.user_credentials (email, password_hash, role, first_name, last_name, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       RETURNING id, email, password_hash, role, first_name, last_name, is_active, email_verified, created_at`,
      [email, passwordHash, role, firstName, lastName, emailVerified]
    );

    const user = result.rows[0];

    if (user) {
      await cache.setCache(`user:email:${user.email}`, user, 300);
      await cache.setCache(`user:id:${user.id}`, user, 300);
    }

    return user;
  } catch (error) {
    logger.error('Error creating external user credential', {
      error: error.message,
      email
    });
    throw error;
  }
}

async function updateUserFromOAuth({ userId, firstName, lastName, emailVerified = true }) {
  const updates = [];
  const values = [];

  if (firstName !== undefined) {
    values.push(firstName);
    updates.push(`first_name = $${values.length}`);
  }

  if (lastName !== undefined) {
    values.push(lastName);
    updates.push(`last_name = $${values.length}`);
  }

  if (emailVerified) {
    updates.push('email_verified = TRUE');
  }

  if (updates.length === 0) {
    return getUserById(userId);
  }

  values.push(userId);

  const query = `
    UPDATE global_auth.user_credentials
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${values.length}
    RETURNING id, email, password_hash, role, first_name, last_name, is_active, email_verified, updated_at
  `;

  try {
    const result = await db.query(query, values);
    const user = result.rows[0];

    await cache.deleteCache(`user:id:${userId}`);
    if (user?.email) {
      await cache.deleteCache(`user:email:${user.email}`);
    }

    if (user) {
      await cache.setCache(`user:id:${user.id}`, user, 300);
      await cache.setCache(`user:email:${user.email}`, user, 300);
    }

    return user;
  } catch (error) {
    logger.error('Error updating user from OAuth profile', {
      error: error.message,
      userId
    });
    throw error;
  }
}

async function upsertOAuthToken({
  userId,
  provider,
  accessToken,
  refreshToken = null,
  expiresIn = null,
  scope = null,
  tokenType = 'Bearer'
}) {
  try {
    const expiresAt = expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000) : null;

    await db.query(
      `INSERT INTO global_auth.oauth_tokens (user_id, provider, access_token, refresh_token, token_type, expires_at, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_type = EXCLUDED.token_type,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         updated_at = NOW()`,
      [userId, provider, accessToken, refreshToken, tokenType, expiresAt, scope]
    );
  } catch (error) {
    logger.error('Failed to upsert OAuth token', {
      error: error.message,
      userId,
      provider
    });
    throw error;
  }
}

/**
 * Change user password
 * @param {string} userId - The user's credential ID
 * @param {string} newPasswordHash - The new bcrypt password hash
 * @returns {Promise<object>} - Updated user object
 */
async function changePassword(userId, newPasswordHash) {
  try {
    const result = await db.query(
      `UPDATE global_auth.user_credentials
       SET password_hash = $1,
           password_updated_at = NOW(),
           must_change_password = FALSE,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, first_name, last_name, role, is_active,
                 email_verified, password_updated_at, is_protected, must_change_password`,
      [newPasswordHash, userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];

    // Invalidate caches
    await cache.deleteCache(`user:id:${userId}`);
    if (user.email) {
      await cache.deleteCache(`user:email:${user.email}`);
    }

    logger.info('Password changed successfully', { userId });

    return user;
  } catch (error) {
    logger.error('Error changing password', { error: error.message, userId });
    throw error;
  }
}

/**
 * Check if user is protected (cannot be deleted)
 * @param {string} userId - The user's credential ID
 * @returns {Promise<boolean>}
 */
async function isUserProtected(userId) {
  try {
    const result = await db.query(
      `SELECT is_protected FROM global_auth.user_credentials WHERE id = $1`,
      [userId]
    );

    return result.rows.length > 0 && result.rows[0].is_protected === true;
  } catch (error) {
    logger.error('Error checking user protection status', { error: error.message, userId });
    throw error;
  }
}

/**
 * Get security config from admin_settings
 * @returns {Promise<object|null>}
 */
async function getSecurityConfig() {
  try {
    const result = await db.query(
      `SELECT value FROM admin_settings.system_settings WHERE key = 'security_config'`
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].value;
  } catch (error) {
    logger.error('Error fetching security config', { error: error.message });
    return null;
  }
}

module.exports = {
  getUserByEmail,
  getUserById,
  getUserByIdWithPassword,
  createSession,
  getSession,
  updateSession,
  updateSessionById,
  deleteSession,
  deleteExpiredSessions,
  updateUserProfileFromEvent,
  createUserCredential,
  createExternalUserCredential,
  updateUserFromOAuth,
  upsertOAuthToken,
  changePassword,
  isUserProtected,
  getSecurityConfig
};
