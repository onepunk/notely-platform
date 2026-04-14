/**
 * Access Control Configuration
 * Defines default route-to-role mappings for the portal
 *
 * NOTE: These are DEFAULT permissions used as fallback.
 * The RBAC admin page controls dynamic permissions stored in the database.
 */

export type UserRole = 'super_admin' | 'admin' | 'user';

export interface RoutePermission {
  path: string;
  allowedRoles: UserRole[];
  description: string;
}

/**
 * Default route permissions (fallback when DB is unavailable)
 */
export const DEFAULT_ROUTE_PERMISSIONS: RoutePermission[] = [
  // User-facing pages
  { path: '/',             allowedRoles: ['super_admin', 'admin', 'user'], description: 'Main dashboard and overview' },
  { path: '/calendar',     allowedRoles: ['super_admin', 'admin', 'user'], description: 'Calendar view and meeting management' },
  { path: '/transcripts',  allowedRoles: ['super_admin', 'admin', 'user'], description: 'Meeting transcripts' },
  { path: '/recordings',   allowedRoles: ['super_admin', 'admin', 'user'], description: 'Upload and manage audio recordings' },
  { path: '/actions',      allowedRoles: ['super_admin', 'admin', 'user'], description: 'Action items and tasks from meetings' },
  { path: '/insights',     allowedRoles: ['super_admin', 'admin', 'user'], description: 'Meeting insights and analytics' },
  { path: '/integrations', allowedRoles: ['super_admin', 'admin', 'user'], description: 'Third-party integrations and connections' },
  { path: '/settings',     allowedRoles: ['super_admin', 'admin', 'user'], description: 'User profile and account settings' },
  { path: '/license',      allowedRoles: ['super_admin', 'admin', 'user'], description: 'License information and activation' },
  { path: '/meetings',     allowedRoles: ['super_admin', 'admin', 'user'], description: 'Meetings list and history' },
  { path: '/teams',        allowedRoles: ['super_admin', 'admin', 'user'], description: 'Microsoft Teams integration' },
  { path: '/support',      allowedRoles: ['super_admin', 'admin', 'user'], description: 'Support and help resources' },

  // Admin pages
  { path: '/admin/settings',        allowedRoles: ['super_admin', 'admin'], description: 'System-wide configuration and settings' },
  { path: '/admin/users',           allowedRoles: ['super_admin', 'admin'], description: 'User account management and permissions' },
  { path: '/admin/services',        allowedRoles: ['super_admin', 'admin'], description: 'Docker service control and monitoring' },
  { path: '/admin/teams',           allowedRoles: ['super_admin', 'admin'], description: 'Microsoft Teams integration settings' },
  { path: '/admin/observatory',     allowedRoles: ['super_admin', 'admin'], description: 'Observatory - Grafana monitoring dashboards' },
  { path: '/admin/licenses',        allowedRoles: ['super_admin', 'admin'], description: 'User license management' },
  { path: '/admin/license-manager', allowedRoles: ['super_admin', 'admin'], description: 'License management and key generation' },
  { path: '/admin/releases',        allowedRoles: ['super_admin', 'admin'], description: 'Desktop client release management' },
  { path: '/admin/prompts',         allowedRoles: ['super_admin', 'admin'], description: 'AI prompt template management' },
  { path: '/admin/support',         allowedRoles: ['super_admin', 'admin'], description: 'Support ticket administration' },
  { path: '/admin/comms',           allowedRoles: ['super_admin', 'admin'], description: 'Communications and email management' },
  { path: '/admin/access',          allowedRoles: ['super_admin', 'admin'], description: 'Access control configuration' },

  // Catch-all for /admin/*
  { path: '/admin', allowedRoles: ['super_admin', 'admin'], description: 'Admin dashboard and general admin pages' },
];

/**
 * Check if a user role has access to a specific route
 * Uses longest-match routing (e.g., /admin/users matches before /admin)
 * super_admin always has access to everything
 */
export function hasRouteAccess(route: string, userRole: UserRole, customPermissions?: RoutePermission[]): boolean {
  // super_admin bypasses all checks
  if (userRole === 'super_admin') return true;

  const permissions = customPermissions || DEFAULT_ROUTE_PERMISSIONS;

  // Find all matching routes (most specific first)
  const matchingRoutes = permissions
    .filter(p => route.startsWith(p.path))
    .sort((a, b) => b.path.length - a.path.length);

  if (matchingRoutes.length === 0) {
    if (route.startsWith('/admin')) {
      return false;
    }
    return true;
  }

  const permission = matchingRoutes[0];
  return permission.allowedRoles.includes(userRole);
}

/**
 * Get all routes with their allowed roles
 */
export function getAllRoutePermissions(customPermissions?: RoutePermission[]): RoutePermission[] {
  return customPermissions || DEFAULT_ROUTE_PERMISSIONS;
}

/**
 * Get all available user roles
 */
export const ALL_USER_ROLES: UserRole[] = [
  'super_admin',
  'admin',
  'user',
];
