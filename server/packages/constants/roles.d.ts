/**
 * User Role Constants Type Definitions
 *
 * TypeScript type definitions for the shared roles module.
 * These types can be imported directly by TypeScript services.
 */

/**
 * User role type
 */
export type UserRole = 'super_admin' | 'admin' | 'user';

/**
 * User role constants object
 */
export interface RolesConstants {
  readonly SUPER_ADMIN: 'super_admin';
  readonly ADMIN: 'admin';
  readonly USER: 'user';
}

/**
 * User role constants
 */
export const ROLES: RolesConstants;

/**
 * Array of all available user roles
 * Ordered from highest to lowest privilege level
 */
export const ALL_USER_ROLES: ReadonlyArray<UserRole>;

/**
 * Check if a given string is a valid user role
 * @param role - The role to validate
 * @returns True if the role is valid
 */
export function isValidRole(role: string): boolean;

/**
 * Normalize role string to lowercase
 * @param role - The role to normalize
 * @returns Normalized role or null if invalid
 */
export function normalizeRole(role: string): UserRole | null;

/**
 * Check if a role has super_admin privileges
 * @param role - The role to check
 * @returns True if the role is super_admin
 */
export function isSuperAdmin(role: string): boolean;

/**
 * Check if a role has admin privileges (admin or super_admin)
 * @param role - The role to check
 * @returns True if the role is admin or super_admin
 */
export function isAdmin(role: string): boolean;

/**
 * Get role hierarchy level (higher number = more privileges)
 * @param role - The role to check
 * @returns Role level (0-3), or -1 if invalid
 */
export function getRoleLevel(role: string): number;

/**
 * Check if roleA has equal or higher privileges than roleB
 * @param roleA - First role to compare
 * @param roleB - Second role to compare
 * @returns True if roleA >= roleB in privilege level
 */
export function hasEqualOrHigherPrivilege(roleA: string, roleB: string): boolean;
