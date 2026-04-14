const shared = require('@notely/shared');
const bcrypt = require('bcryptjs');

const db = shared.database;
const cache = shared.cache;
const logger = shared.logger;

async function getProfileByAuthUserId(authUserId) {
  const query = `
    SELECT
      p.auth_user_id,
      p.email,
      p.first_name,
      p.last_name,
      p.display_name,
      p.avatar_url,
      p.locale,
      p.time_zone,
      p.preferences,
      la.last_login_at,
      la.last_login_ip,
      la.last_login_user_agent,
      la.login_count
    FROM user_profiles.profiles p
    LEFT JOIN user_profiles.login_activity la
      ON la.auth_user_id = p.auth_user_id
    WHERE p.auth_user_id = $1
    LIMIT 1
  `;

  try {
    const result = await db.query(query, [authUserId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Users service failed to fetch profile', {
      error: error.message,
      authUserId
    });
    throw error;
  }
}

const FIELD_COLUMN_MAP = {
  firstName: 'first_name',
  lastName: 'last_name',
  displayName: 'display_name',
  locale: 'locale',
  timeZone: 'time_zone',
  preferences: 'preferences'
};

async function getAllUsers({ limit = 1000, offset = 0, search = '' }) {
  let query = `
    SELECT
      c.id,
      c.email,
      c.first_name,
      c.last_name,
      c.role,
      c.is_active,
      c.email_verified,
      c.is_protected,
      c.created_at,
      c.updated_at,
      p.display_name,
      la.last_login_at,
      la.login_count
    FROM global_auth.user_credentials c
    LEFT JOIN user_profiles.profiles p ON p.auth_user_id = c.id
    LEFT JOIN user_profiles.login_activity la ON la.auth_user_id = c.id
  `;

  const values = [];
  let paramCount = 0;

  if (search && search.trim()) {
    paramCount++;
    query += ` WHERE (
      c.email ILIKE $${paramCount}
      OR c.first_name ILIKE $${paramCount}
      OR c.last_name ILIKE $${paramCount}
      OR p.display_name ILIKE $${paramCount}
    )`;
    values.push(`%${search.trim()}%`);
  }

  query += ` ORDER BY c.created_at DESC`;

  paramCount++;
  query += ` LIMIT $${paramCount}`;
  values.push(limit);

  paramCount++;
  query += ` OFFSET $${paramCount}`;
  values.push(offset);

  try {
    const result = await db.query(query, values);
    return result.rows;
  } catch (error) {
    logger.error('Users service failed to fetch all users', {
      error: error.message,
      limit,
      offset,
      search
    });
    throw error;
  }
}

async function updateProfile(authUserId, updates) {
  const setClauses = [];
  const values = [];

  Object.entries(FIELD_COLUMN_MAP).forEach(([field, column]) => {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      let value = updates[field];
      if (field === 'preferences' && value !== undefined) {
        value = JSON.stringify(value ?? {});
      }

      values.push(value);
      setClauses.push(`${column} = $${values.length}`);
    }
  });

  if (setClauses.length === 0) {
    return null;
  }

  values.push(authUserId);

  const query = `
    UPDATE user_profiles.profiles
    SET ${setClauses.join(', ')}, updated_at = NOW()
    WHERE auth_user_id = $${values.length}
    RETURNING
      auth_user_id,
      email,
      first_name,
      last_name,
      display_name,
      avatar_url,
      locale,
      time_zone,
      preferences
  `;

  try {
    const result = await db.query(query, values);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Users service failed to update profile', {
      error: error.message,
      authUserId
    });
    throw error;
  }
}

async function getUserById(userId) {
  const query = `
    SELECT
      c.id,
      c.email,
      c.first_name,
      c.last_name,
      c.role,
      c.is_active,
      c.email_verified,
      c.is_protected,
      c.created_at,
      c.updated_at,
      p.display_name,
      la.last_login_at,
      la.login_count
    FROM global_auth.user_credentials c
    LEFT JOIN user_profiles.profiles p ON p.auth_user_id = c.id
    LEFT JOIN user_profiles.login_activity la ON la.auth_user_id = c.id
    WHERE c.id = $1
    LIMIT 1
  `;

  try {
    const result = await db.query(query, [userId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Users service failed to fetch user by ID', {
      error: error.message,
      userId
    });
    throw error;
  }
}

async function updateUserCredentials(userId, updates) {
  const setClauses = [];
  const values = [];

  const fieldMap = {
    email: 'email',
    role: 'role',
    isActive: 'is_active',
    firstName: 'first_name',
    lastName: 'last_name'
  };

  for (const [field, column] of Object.entries(fieldMap)) {
    if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== undefined) {
      values.push(updates[field]);
      setClauses.push(`${column} = $${values.length}`);
    }
  }

  // Handle password separately (needs hashing)
  if (Object.prototype.hasOwnProperty.call(updates, 'password') && updates.password) {
    const passwordHash = await bcrypt.hash(updates.password, 10);
    values.push(passwordHash);
    setClauses.push(`password_hash = $${values.length}`);
    setClauses.push('password_updated_at = NOW()');
  }

  if (setClauses.length === 0) {
    return null;
  }

  values.push(userId);

  const query = `
    UPDATE global_auth.user_credentials
    SET ${setClauses.join(', ')}, updated_at = NOW()
    WHERE id = $${values.length}
    RETURNING id, email, first_name, last_name, role, is_active, email_verified, updated_at
  `;

  try {
    const result = await db.query(query, values);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Users service failed to update user credentials', {
      error: error.message,
      userId
    });
    throw error;
  }
}

async function deleteUser(userId) {
  // Permanent delete - cascades to all related tables:
  // - user_profiles.profiles (ON DELETE CASCADE)
  // - user_profiles.login_activity (ON DELETE CASCADE)
  // - global_auth.sessions (ON DELETE CASCADE)
  // - global_auth.oauth_tokens (ON DELETE CASCADE)
  // - client_sync.* (all sync tables with ON DELETE CASCADE)
  // - user_portal_settings.user_preferences (ON DELETE CASCADE)
  // - admin_settings.route_access_audit.changed_by (ON DELETE SET NULL)
  // - support.diagnostics_bundles.user_id (ON DELETE CASCADE)
  // - support.diagnostics_bundles.reviewed_by (ON DELETE SET NULL)
  const query = `
    DELETE FROM global_auth.user_credentials
    WHERE id = $1
    RETURNING id, email
  `;

  try {
    const result = await db.query(query, [userId]);
    const deleted = result.rows[0] || null;

    // Invalidate auth service cache so stale entries don't block re-registration
    if (deleted) {
      await cache.deleteCache(`user:id:${deleted.id}`);
      if (deleted.email) {
        await cache.deleteCache(`user:email:${deleted.email}`);
      }
    }

    return deleted;
  } catch (error) {
    logger.error('Users service failed to permanently delete user', {
      error: error.message,
      userId
    });
    throw error;
  }
}

module.exports = {
  getProfileByAuthUserId,
  getAllUsers,
  getUserById,
  updateProfile,
  updateUserCredentials,
  deleteUser,
  createProfileForAuthUser: async ({ authUserId, email, firstName, lastName }) => {
    if (!authUserId) {
      throw new Error('authUserId is required to create profile');
    }

    const sanitizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;
    const sanitizedFirst = typeof firstName === 'string' ? firstName.trim() : null;
    const sanitizedLast = typeof lastName === 'string' ? lastName.trim() : null;
    const displayName = [sanitizedFirst, sanitizedLast].filter(Boolean).join(' ') || sanitizedEmail || null;

    const query = `
      INSERT INTO user_profiles.profiles (auth_user_id, email, first_name, last_name, display_name)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (auth_user_id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, user_profiles.profiles.email),
        first_name = COALESCE(EXCLUDED.first_name, user_profiles.profiles.first_name),
        last_name = COALESCE(EXCLUDED.last_name, user_profiles.profiles.last_name),
        display_name = COALESCE(EXCLUDED.display_name, user_profiles.profiles.display_name),
        updated_at = NOW()
      RETURNING auth_user_id, email, first_name, last_name, display_name
    `;

    try {
      const result = await db.query(query, [
        authUserId,
        sanitizedEmail,
        sanitizedFirst,
        sanitizedLast,
        displayName
      ]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to create user profile from registration', {
        error: error.message,
        authUserId
      });
      throw error;
    }
  }
};
