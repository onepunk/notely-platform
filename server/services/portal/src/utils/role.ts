import type { UserRole } from '@/types/user';

const ROLE_ALIASES: Record<string, UserRole> = {
  super_admin: 'super_admin',
  superadmin: 'super_admin',
  admin: 'admin',
  user: 'user',
};

/**
 * Normalise user roles coming from various auth flows.
 * Maps legacy role names to the portal's canonical roles.
 *
 * Returns null for unknown/unsupported roles.
 */
export function normalizeUserRole(role?: string | null): UserRole | null {
  if (!role) {
    return null;
  }

  const key = role.toLowerCase().replace(/[-\s]/g, '_');
  return ROLE_ALIASES[key] ?? null;
}

/**
 * Convenience helper to check if a role string maps to one of the allowed roles.
 */
export function isAllowedRole(role: string | null | undefined, allowed: UserRole[]): boolean {
  const normalized = normalizeUserRole(role);
  if (!normalized) {
    return false;
  }

  return allowed.includes(normalized);
}
