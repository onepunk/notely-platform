/**
 * User and Permission types for unified portal
 */

export type UserRole = 'super_admin' | 'admin' | 'user';

export type ConsentStatus = 'not_started' | 'started' | 'completed';

export interface Permission {
  resource: string;
  actions: string[];
}

export interface UserProfile {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string;
  role: UserRole;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string | null;

  // Teams integration fields
  teamsEnabled?: boolean;
  teamsAutoJoin?: boolean;
  teamsLicenseActive?: boolean;
  teamsConsentStatus?: ConsentStatus;
  teamsTenantId?: string | null;
  teamsEmailMode?: string;

  // User settings
  timezone?: string;

  // Admin-specific fields
  permissions?: Permission[] | string[];
  scopes?: string[];
}

export interface AuthState {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  tokenExpiresAt?: number | null;
  sessionProvider?: 'local' | 'oidc' | null;
  adminIpWhitelisted?: boolean; // Whether client IP is whitelisted for admin access
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}
