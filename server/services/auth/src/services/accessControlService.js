const { database: db, logger } = require('@notely/shared');

const AVAILABLE_ROLES = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full system administration access'
  },
  {
    value: 'user',
    label: 'User',
    description: 'Standard portal user access'
  }
];

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) {
    return { valid: [], invalid: [] };
  }

  const allowedSet = new Set(AVAILABLE_ROLES.map((role) => role.value));
  const seen = new Set();
  const valid = [];
  const invalid = [];

  for (const role of roles) {
    if (typeof role !== 'string') {
      invalid.push(role);
      continue;
    }

    const normalized = role.trim().toLowerCase();
    const canonical = normalized;

    if (!canonical) {
      invalid.push(role);
      continue;
    }

    if (!allowedSet.has(canonical)) {
      invalid.push(role);
      continue;
    }

    if (!seen.has(canonical)) {
      seen.add(canonical);
      valid.push(canonical);
    }
  }

  valid.sort();

  return { valid, invalid };
}

function mapRouteRow(row) {
  const allowedRoles = Array.isArray(row.allowed_roles) ? row.allowed_roles.filter(Boolean) : [];

  return {
    id: row.id,
    route_path: row.route_path,
    description: row.description,
    permission_resource: row.permission_resource,
    permission_action: row.permission_action,
    permission_code: row.permission_code,
    allowed_roles: Array.from(new Set(allowedRoles)).sort(),
    is_active: row.is_active,
    route_category: row.route_category || 'admin'
  };
}

async function listRoutes() {
  const query = `
    SELECT
      rp.id,
      rp.path_pattern AS route_path,
      rp.description,
      rp.service_name,
      rp.permission_resource,
      rp.permission_action,
      CASE
        WHEN rp.permission_resource IS NOT NULL AND rp.permission_action IS NOT NULL
          THEN rp.permission_resource || ':' || rp.permission_action
        ELSE NULL
      END AS permission_code,
      rp.is_active,
      rp.route_category,
      COALESCE(
        ARRAY_AGG(DISTINCT rra.role) FILTER (WHERE rra.role IS NOT NULL),
        '{}'
      ) AS allowed_roles
    FROM admin_settings.route_permissions rp
    LEFT JOIN admin_settings.route_role_access rra ON rp.id = rra.route_id
    WHERE rp.is_active = TRUE
    GROUP BY rp.id, rp.path_pattern, rp.description, rp.permission_resource, rp.permission_action, rp.is_active, rp.service_name, rp.route_category
    ORDER BY rp.route_category, rp.path_pattern
  `;

  const result = await db.query(query);
  return result.rows.map(mapRouteRow);
}

async function getRouteById(routeId, { client } = {}) {
  const query = `
    SELECT
      rp.id,
      rp.route_key,
      rp.path_pattern AS route_path,
      rp.description,
      rp.permission_resource,
      rp.permission_action,
      CASE
        WHEN rp.permission_resource IS NOT NULL AND rp.permission_action IS NOT NULL
          THEN rp.permission_resource || ':' || rp.permission_action
        ELSE NULL
      END AS permission_code,
      rp.is_active,
      COALESCE(
        ARRAY_AGG(DISTINCT rra.role) FILTER (WHERE rra.role IS NOT NULL),
        '{}'
      ) AS allowed_roles
    FROM admin_settings.route_permissions rp
    LEFT JOIN admin_settings.route_role_access rra ON rp.id = rra.route_id
    WHERE rp.id = $1
    GROUP BY rp.id, rp.route_key, rp.path_pattern, rp.description, rp.permission_resource, rp.permission_action, rp.is_active
  `;

  const executor = client || db;
  const result = await executor.query(query, [routeId]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRouteRow(result.rows[0]);
}

async function updateRouteRoles(routeId, roles, { changedBy } = {}) {
  const { valid: normalizedRoles, invalid } = normalizeRoles(roles);

  if (invalid.length > 0) {
    const error = new Error('One or more roles are invalid');
    error.code = 'INVALID_ROLES';
    error.details = { invalidRoles: invalid };
    throw error;
  }

  return db.transaction(async (client) => {
    const routeResult = await client.query(
      'SELECT route_key FROM admin_settings.route_permissions WHERE id = $1',
      [routeId]
    );

    if (routeResult.rows.length === 0) {
      const error = new Error('Route not found');
      error.code = 'ROUTE_NOT_FOUND';
      throw error;
    }

    const currentRolesResult = await client.query(
      'SELECT role FROM admin_settings.route_role_access WHERE route_id = $1 ORDER BY role ASC',
      [routeId]
    );

    const previousRoles = currentRolesResult.rows.map((row) => row.role);

    await client.query('DELETE FROM admin_settings.route_role_access WHERE route_id = $1', [routeId]);

    if (normalizedRoles.length > 0) {
      await client.query(
        `INSERT INTO admin_settings.route_role_access (route_id, role)
         SELECT $1, role
         FROM UNNEST($2::text[]) AS t(role)`,
        [routeId, normalizedRoles]
      );
    }

    try {
      await client.query(
        `INSERT INTO admin_settings.route_access_audit (
           route_key,
           action,
           changed_by,
           previous_value,
           new_value
         )
         VALUES ($1, 'update_roles', $2, $3, $4)`,
        [
          routeResult.rows[0].route_key,
          changedBy || null,
          JSON.stringify({ roles: previousRoles }),
          JSON.stringify({ roles: normalizedRoles })
        ]
      );
    } catch (error) {
      logger.warn('Failed to write access control audit log', {
        error: error.message,
        routeId,
        changedBy
      });
    }

    const updatedRoute = await getRouteById(routeId, { client });
    return {
      route: updatedRoute,
      previousRoles,
      newRoles: normalizedRoles
    };
  });
}

module.exports = {
  listRoutes,
  getRouteById,
  updateRouteRoles,
  getAvailableRoles: () => AVAILABLE_ROLES.slice()
};
