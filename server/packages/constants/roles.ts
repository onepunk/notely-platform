/**
 * User Role Constants (TypeScript)
 *
 * TypeScript-native export of role constants for TypeScript services.
 * This file exports the same constants as roles.js but with proper TypeScript types.
 *
 * Usage in TypeScript services:
 *   import { ROLES, UserRole, ALL_USER_ROLES } from '@notely/shared/constants/roles';
 *
 * Usage in JavaScript services:
 *   const { ROLES, ALL_USER_ROLES } = require('@notely/shared').constants.roles;
 */

/**
 * User role type
 */
export type UserRole = 'super_admin' | 'admin' | 'user';

/**
 * User role constants
 */
export const ROLES = {
  SUPER_ADMIN: 'super_admin' as const,
  ADMIN: 'admin' as const,
  USER: 'user' as const
} as const;

/**
 * Array of all available user roles
 * Ordered from highest to lowest privilege level
 */
export const ALL_USER_ROLES: readonly UserRole[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.USER
] as const;

/**
 * Check if a given string is a valid user role
 */
export function isValidRole(role: string): role is UserRole {
  if (typeof role !== 'string') {
    return false;
  }
  return ALL_USER_ROLES.includes(role.toLowerCase() as UserRole);
}

/**
 * Normalize role string to lowercase
 */
export function normalizeRole(role: string): UserRole | null {
  if (!role || typeof role !== 'string') {
    return null;
  }
  const normalized = role.toLowerCase() as UserRole;
  return isValidRole(normalized) ? normalized : null;
}

/**
 * Check if a role has super_admin privileges
 */
export function isSuperAdmin(role: string): boolean {
  return normalizeRole(role) === ROLES.SUPER_ADMIN;
}

/**
 * Check if a role has admin privileges (admin or super_admin)
 */
export function isAdmin(role: string): boolean {
  const normalized = normalizeRole(role);
  return normalized === ROLES.ADMIN || normalized === ROLES.SUPER_ADMIN;
}

/**
 * Get role hierarchy level (higher number = more privileges)
 */
export function getRoleLevel(role: string): number {
  const normalized = normalizeRole(role);
  switch (normalized) {
    case ROLES.SUPER_ADMIN: return 3;
    case ROLES.ADMIN: return 2;
    case ROLES.USER: return 0;
    default: return -1;
  }
}

/**
 * Check if roleA has equal or higher privileges than roleB
 */
export function hasEqualOrHigherPrivilege(roleA: string, roleB: string): boolean {
  return getRoleLevel(roleA) >= getRoleLevel(roleB);
}
