"use strict";

/**
 * User Role Constants
 *
 * Centralized role definitions for the Notely Platform V3.
 * These roles are used throughout the system for access control,
 * route permissions, and authorization checks.
 *
 * @see server/ops/migrations/V100__rbac_role_and_route_sync.sql for database role definitions
 * @see server/services/portal/src/config/access-control.ts for route permissions
 */

/**
 * User role constants
 * @enum {string}
 */
const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  USER: 'user'
});

/**
 * Array of all available user roles
 * Ordered from highest to lowest privilege level
 * @type {string[]}
 */
const ALL_USER_ROLES = Object.freeze([
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.USER
]);

/**
 * Check if a given string is a valid user role
 * @param {string} role - The role to validate
 * @returns {boolean} True if the role is valid
 */
function isValidRole(role) {
  if (typeof role !== 'string') {
    return false;
  }
  return ALL_USER_ROLES.includes(role.toLowerCase());
}

/**
 * Normalize role string to lowercase
 * @param {string} role - The role to normalize
 * @returns {string|null} Normalized role or null if invalid
 */
function normalizeRole(role) {
  if (!role || typeof role !== 'string') {
    return null;
  }
  const normalized = role.toLowerCase();
  return isValidRole(normalized) ? normalized : null;
}

/**
 * Check if a role has super_admin privileges
 * @param {string} role - The role to check
 * @returns {boolean} True if the role is super_admin
 */
function isSuperAdmin(role) {
  return normalizeRole(role) === ROLES.SUPER_ADMIN;
}

/**
 * Check if a role has admin privileges (admin or super_admin)
 * @param {string} role - The role to check
 * @returns {boolean} True if the role is admin or super_admin
 */
function isAdmin(role) {
  const normalized = normalizeRole(role);
  return normalized === ROLES.ADMIN || normalized === ROLES.SUPER_ADMIN;
}

/**
 * Get role hierarchy level (higher number = more privileges)
 * @param {string} role - The role to check
 * @returns {number} Role level (0-3), or -1 if invalid
 */
function getRoleLevel(role) {
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
 * @param {string} roleA - First role to compare
 * @param {string} roleB - Second role to compare
 * @returns {boolean} True if roleA >= roleB in privilege level
 */
function hasEqualOrHigherPrivilege(roleA, roleB) {
  return getRoleLevel(roleA) >= getRoleLevel(roleB);
}

module.exports = {
  ROLES,
  ALL_USER_ROLES,
  isValidRole,
  normalizeRole,
  isSuperAdmin,
  isAdmin,
  getRoleLevel,
  hasEqualOrHigherPrivilege
};
