const { database: db, logger } = require('@notely/shared');

/**
 * ACL Model - Access Control List operations
 * Manages route permissions and role-based access control
 */

/**
 * Check if user roles have access to a route
 * @param {string[]} userRoles - Array of user roles
 * @param {string} routePattern - Route path pattern (e.g., '/admin/users')
 * @param {string} httpMethod - HTTP method (GET, POST, etc.)
 * @param {string} serviceName - Service name (e.g., 'portal')
 * @returns {Promise<{allowed: boolean, routeKey?: string, matchedRoles?: string[]}>}
 */
async function checkAccess(userRoles, routePattern, httpMethod = 'GET', serviceName = 'portal') {
  try {
    // Query to find matching route and check if any user role has access
    const query = `
      SELECT
        rp.id,
        rp.route_key,
        rp.path_pattern,
        rp.http_method,
        array_agg(DISTINCT rra.role) as allowed_roles
      FROM admin_settings.route_permissions rp
      LEFT JOIN admin_settings.route_role_access rra ON rp.id = rra.route_id
      WHERE rp.service_name = $1
        AND rp.is_active = true
        AND rp.path_pattern = $2
        AND (rp.http_method = $3 OR rp.http_method = 'ANY')
      GROUP BY rp.id, rp.route_key, rp.path_pattern, rp.http_method
    `;

    const result = await db.query(query, [serviceName, routePattern, httpMethod]);

    if (result.rows.length === 0) {
      // No route found - deny by default
      return { allowed: false };
    }

    const route = result.rows[0];
    const allowedRoles = route.allowed_roles || [];

    // Check if any user role is in the allowed roles
    const matchedRoles = userRoles.filter(role => allowedRoles.includes(role));

    return {
      allowed: matchedRoles.length > 0,
      routeKey: route.route_key,
      matchedRoles: matchedRoles
    };
  } catch (error) {
    logger.error('ACL access check failed', {
      error: error.message,
      userRoles,
      routePattern,
      httpMethod,
      serviceName
    });
    throw error;
  }
}

/**
 * Get all permissions for a role
 * @param {string} role - User role
 * @returns {Promise<string[]>} Array of permission codes (e.g., ['users:read', 'users:write'])
 */
async function getPermissionsForRole(role) {
  if (!role) {
    return [];
  }

  try {
    const query = `
      SELECT DISTINCT
        (rp.permission_resource || ':' || rp.permission_action) AS permission_code
      FROM admin_settings.route_role_access rra
      JOIN admin_settings.route_permissions rp ON rp.id = rra.route_id
      WHERE rra.role = $1
        AND rp.is_active = TRUE
        AND rp.permission_resource IS NOT NULL
        AND rp.permission_action IS NOT NULL
      ORDER BY permission_code
    `;

    const result = await db.query(query, [role]);
    return result.rows.map(row => row.permission_code);
  } catch (error) {
    logger.error('Failed to get permissions for role', {
      error: error.message,
      role
    });
    throw error;
  }
}

/**
 * Get all routes accessible by a role
 * @param {string} role - User role
 * @param {string} serviceName - Optional service filter
 * @returns {Promise<Array>} List of accessible routes
 */
async function getRoutesByRole(role, serviceName = null) {
  try {
    const query = `
      SELECT
        rp.id,
        rp.route_key,
        rp.path_pattern,
        rp.http_method,
        rp.description,
        rp.service_name,
        rp.is_active
      FROM admin_settings.route_permissions rp
      INNER JOIN admin_settings.route_role_access rra ON rp.id = rra.route_id
      WHERE rra.role = $1
        AND rp.is_active = true
        ${serviceName ? 'AND rp.service_name = $2' : ''}
      ORDER BY rp.service_name, rp.path_pattern
    `;

    const params = serviceName ? [role, serviceName] : [role];
    const result = await db.query(query, params);

    return result.rows;
  } catch (error) {
    logger.error('Failed to get routes by role', {
      error: error.message,
      role,
      serviceName
    });
    throw error;
  }
}

/**
 * Get all routes with their role assignments
 * @param {string} serviceName - Optional service filter
 * @returns {Promise<Array>} List of routes with roles
 */
async function getAllRoutes(serviceName = null) {
  try {
    const query = `
      SELECT
        rp.id,
        rp.route_key,
        rp.path_pattern,
        rp.http_method,
        rp.description,
        rp.service_name,
        rp.is_active,
        array_agg(DISTINCT rra.role) FILTER (WHERE rra.role IS NOT NULL) as roles,
        rp.created_at,
        rp.updated_at
      FROM admin_settings.route_permissions rp
      LEFT JOIN admin_settings.route_role_access rra ON rp.id = rra.route_id
      ${serviceName ? 'WHERE rp.service_name = $1' : ''}
      GROUP BY rp.id
      ORDER BY rp.service_name, rp.path_pattern
    `;

    const params = serviceName ? [serviceName] : [];
    const result = await db.query(query, params);

    return result.rows;
  } catch (error) {
    logger.error('Failed to get all routes', {
      error: error.message,
      serviceName
    });
    throw error;
  }
}

/**
 * Create a new route permission
 * @param {Object} routeData - Route data
 * @param {string} routeData.routeKey - Unique route identifier
 * @param {string} routeData.pathPattern - URL path pattern
 * @param {string} routeData.httpMethod - HTTP method
 * @param {string} routeData.description - Route description
 * @param {string} routeData.serviceName - Service name
 * @param {string[]} routeData.allowedRoles - Roles allowed to access
 * @param {string} changedBy - User ID making the change
 * @returns {Promise<Object>} Created route with roles
 */
async function createRoute(routeData, changedBy) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Insert route permission
    const insertRouteQuery = `
      INSERT INTO admin_settings.route_permissions
        (route_key, path_pattern, http_method, description, service_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const routeResult = await client.query(insertRouteQuery, [
      routeData.routeKey,
      routeData.pathPattern,
      routeData.httpMethod || 'GET',
      routeData.description,
      routeData.serviceName || 'portal'
    ]);

    const route = routeResult.rows[0];

    // Insert role mappings
    if (routeData.allowedRoles && routeData.allowedRoles.length > 0) {
      const insertRolesQuery = `
        INSERT INTO admin_settings.route_role_access (route_id, role)
        VALUES ${routeData.allowedRoles.map((_, i) => `($1, $${i + 2})`).join(', ')}
      `;

      await client.query(insertRolesQuery, [route.id, ...routeData.allowedRoles]);
    }

    // Audit log
    const auditQuery = `
      INSERT INTO admin_settings.route_access_audit (route_key, action, changed_by, new_value)
      VALUES ($1, $2, $3, $4)
    `;

    await client.query(auditQuery, [
      route.route_key,
      'create',
      changedBy,
      JSON.stringify({ route, roles: routeData.allowedRoles })
    ]);

    await client.query('COMMIT');

    return {
      ...route,
      roles: routeData.allowedRoles || []
    };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to create route', {
      error: error.message,
      routeData
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update route role assignments
 * @param {number} routeId - Route ID
 * @param {string[]} newRoles - New roles to assign
 * @param {string} changedBy - User ID making the change
 * @returns {Promise<Object>} Updated route
 */
async function updateRouteRoles(routeId, newRoles, changedBy) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get current state for audit
    const currentQuery = `
      SELECT rp.*, array_agg(rra.role) as current_roles
      FROM admin_settings.route_permissions rp
      LEFT JOIN admin_settings.route_role_access rra ON rp.id = rra.route_id
      WHERE rp.id = $1
      GROUP BY rp.id
    `;

    const currentResult = await client.query(currentQuery, [routeId]);
    if (currentResult.rows.length === 0) {
      throw new Error('Route not found');
    }

    const route = currentResult.rows[0];

    // Delete existing role mappings
    await client.query('DELETE FROM admin_settings.route_role_access WHERE route_id = $1', [routeId]);

    // Insert new role mappings
    if (newRoles && newRoles.length > 0) {
      const insertRolesQuery = `
        INSERT INTO admin_settings.route_role_access (route_id, role)
        VALUES ${newRoles.map((_, i) => `($1, $${i + 2})`).join(', ')}
      `;

      await client.query(insertRolesQuery, [routeId, ...newRoles]);
    }

    // Audit log
    const auditQuery = `
      INSERT INTO admin_settings.route_access_audit (route_key, action, changed_by, previous_value, new_value)
      VALUES ($1, $2, $3, $4, $5)
    `;

    await client.query(auditQuery, [
      route.route_key,
      'update_roles',
      changedBy,
      JSON.stringify({ roles: route.current_roles }),
      JSON.stringify({ roles: newRoles })
    ]);

    await client.query('COMMIT');

    return {
      ...route,
      roles: newRoles
    };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to update route roles', {
      error: error.message,
      routeId,
      newRoles
    });
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  checkAccess,
  getPermissionsForRole,
  getRoutesByRole,
  getAllRoutes,
  createRoute,
  updateRouteRoles
};
