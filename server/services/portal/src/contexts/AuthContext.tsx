/**
 * Authentication Context for Unified Portal
 * Supports both OAuth and local authentication, role-based access control
 */

'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  ReactNode,
} from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { UserProfile, AuthState, Permission } from '@/types/user';
import { authService } from '@/services/authService';
import { refreshAccessToken, logout as oauthLogout, completeOAuthLogin } from '@/lib/oauth/client';
import clientLogger from '@/lib/clientLogger';
import { normalizeUserRole } from '@/utils/role';
import { isSuperAdmin } from '@notely/shared/constants/roles';

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  completeOAuthLogin: (session: any) => Promise<void>;
  completePasswordSession: (expiresAt?: string | null) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasPermission: (resource: string, action: string) => boolean;
  hasRole: (role: string) => boolean;
  checkPermissions: (permissions: string[]) => boolean;
}

type SessionProvider = 'local' | 'oidc';

type SessionMetadata = {
  expiresAt?: number | null;
  provider?: SessionProvider;
};

// CRIT-04: TOKEN_KEY removed - tokens are no longer stored client-side
// Only metadata is stored in sessionStorage for session expiry tracking
const SESSION_META_KEY = 'notely_sess';
const REFRESH_BUFFER_MS = 60 * 1000;
const MIN_REFRESH_DELAY_MS = 5 * 1000;

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  tokenExpiresAt: null,
  sessionProvider: null,
  adminIpWhitelisted: true, // Default to true (no restrictions)
};

type AuthAction =
  | { type: 'AUTH_START' }
  | { type: 'AUTH_SUCCESS'; payload: { user: UserProfile; token: string; metadata?: SessionMetadata; adminIpWhitelisted?: boolean } }
  | { type: 'AUTH_FAILURE'; payload: string }
  | { type: 'LOGOUT' }
  | { type: 'UPDATE_USER'; payload: UserProfile }
  | { type: 'TOKEN_REFRESH'; payload: { token: string; metadata?: SessionMetadata } };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'AUTH_START':
      return { ...state, isLoading: true, error: null };
    case 'AUTH_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        tokenExpiresAt: action.payload.metadata?.expiresAt ?? state.tokenExpiresAt ?? null,
        sessionProvider: action.payload.metadata?.provider ?? state.sessionProvider ?? null,
        adminIpWhitelisted: action.payload.adminIpWhitelisted ?? true,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      };
    case 'AUTH_FAILURE':
      return {
        user: null,
        token: null,
        tokenExpiresAt: null,
        sessionProvider: null,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload,
      };
    case 'LOGOUT':
      return {
        user: null,
        token: null,
        tokenExpiresAt: null,
        sessionProvider: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: action.payload,
      };
    case 'TOKEN_REFRESH':
      return {
        ...state,
        token: action.payload.token,
        tokenExpiresAt: action.payload.metadata?.expiresAt ?? state.tokenExpiresAt ?? null,
        sessionProvider: action.payload.metadata?.provider ?? state.sessionProvider ?? null,
        isAuthenticated: true,
        isLoading: false,
      };
    default:
      return state;
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchProfile(token: string): Promise<UserProfile> {
  const response = await authService.validateToken(token);

  if (!response.success || !response.data) {
    throw new Error(response.error || 'Failed to load profile');
  }

  const profile = response.data;
  if (!profile.id) {
    throw new Error('Invalid profile response');
  }

  const profileData = profile as any; // API may return snake_case fields
  const normalizedRole = normalizeUserRole(profile.role || profileData.role);

  if (!normalizedRole) {
    throw new Error(`Unsupported role "${profile.role || profileData.role}" for portal access`);
  }

  return {
    id: String(profile.id),
    email: profile.email,
    firstName: profile.firstName || profileData.first_name,
    lastName: profile.lastName || profileData.last_name,
    name: profile.name || `${profile.firstName || profileData.first_name || ''} ${profile.lastName || profileData.last_name || ''}`.trim() || profile.email,
    role: normalizedRole,
    isActive: profile.isActive ?? true,
    lastLogin: profile.lastLogin || null,
    createdAt: profile.createdAt || null,
    teamsEnabled: !!profile.teamsEnabled,
    teamsAutoJoin: !!profile.teamsAutoJoin,
    teamsLicenseActive: !!profile.teamsLicenseActive,
    teamsConsentStatus: profile.teamsConsentStatus || 'not_started',
    teamsTenantId: profile.teamsTenantId || null,
    teamsEmailMode: profile.teamsEmailMode || 'notely_smtp',
    timezone: profile.timezone || 'UTC',
    permissions: profile.permissions || [],
  };
}

// CRIT-04 FIX: Removed localStorage/sessionStorage/document.cookie token storage
// Tokens are now stored exclusively in HTTP-only cookies set by the auth service
// This function only stores metadata in sessionStorage for session state tracking
function storeSessionMetadata(metadata?: SessionMetadata | null) {
  if (typeof window === 'undefined') return;

  if (!metadata) {
    sessionStorage.removeItem(SESSION_META_KEY);
    return;
  }

  const serialized = JSON.stringify(metadata);
  sessionStorage.setItem(SESSION_META_KEY, serialized);
}

// CRIT-04 FIX: Simplified clearSession - only clears metadata
// Actual token cookies are cleared by calling the auth service logout endpoint
function clearSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_META_KEY);
  // Note: HTTP-only cookies are cleared server-side via /api/auth/logout
}

// CRIT-04 FIX: Only retrieves metadata, not tokens
// Tokens are in HTTP-only cookies and cannot be accessed by JavaScript
function getSessionMetadataFromStorage(): SessionMetadata | null {
  if (typeof window === 'undefined') return null;

  const raw = sessionStorage.getItem(SESSION_META_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionMetadata;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const refreshTimeoutRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const loadProfile = useCallback(async (sessionType: string, metadata?: SessionMetadata) => {
    dispatch({ type: 'AUTH_START' });
    try {
      const profile = await fetchProfile(sessionType);
      dispatch({ type: 'AUTH_SUCCESS', payload: { user: profile, token: sessionType, metadata } });
    } catch (error: any) {
      clientLogger.error('[AUTH] Failed to load profile:', { error: error instanceof Error ? error.message : String(error) });
      clearSession();
      dispatch({ type: 'AUTH_FAILURE', payload: error?.message || 'Authentication failed' });
      throw error;
    }
  }, []);

  // CRIT-04 FIX: Initialize by fetching session from server (reads HTTP-only cookies)
  // No longer reads tokens from localStorage/sessionStorage
  const initialize = useCallback(async () => {
    // Try to hydrate session from HTTP-only cookies via server
    try {
      const sessionResponse = await authService.fetchSession();
      const session = sessionResponse.data as any;

      if (session?.user) {
        const normalizedRole = normalizeUserRole(session.user.role);
        if (!normalizedRole) {
          throw new Error(`Unsupported role "${session.user.role}" for portal access`);
        }

        const normalizedUser = {
          ...session.user,
          role: normalizedRole,
        };

        // Determine session provider from response or stored metadata
        // Normalize 'password' → 'local' for backward compatibility with server responses
        const storedMetadata = getSessionMetadataFromStorage();
        const rawProvider = session.provider || storedMetadata?.provider || 'oidc';
        const provider = rawProvider === 'password' ? 'local' : rawProvider;

        const metadata: SessionMetadata = {
          provider: provider as SessionProvider,
          expiresAt: session.expiresAt ? new Date(session.expiresAt).getTime() : null,
        };

        // Store only metadata (for session expiry tracking), not tokens
        storeSessionMetadata(metadata);

        // Use session type as placeholder token (for internal state tracking only)
        const sessionType = provider === 'local' ? 'local-session' : 'oauth2-session';
        // Include IP whitelist status from session response (defaults to true if not present)
        const adminIpWhitelisted = session.adminIpWhitelisted !== false;
        dispatch({ type: 'AUTH_SUCCESS', payload: { user: normalizedUser, token: sessionType, metadata, adminIpWhitelisted } });
        return;
      }
    } catch (error: any) {
      clientLogger.warn('[AUTH] Session hydration failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    dispatch({ type: 'AUTH_FAILURE', payload: 'No active session' });
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const refreshOidcToken = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    if (state.sessionProvider !== 'oidc') {
      return null;
    }

    const refreshPromise = (async () => {
      try {
        // Use new OAuth2 client - server handles cookies and rotation
        const refreshResponse = await refreshAccessToken();

        // Calculate new expiry time (15 minutes from now)
        const expiresAt = Date.now() + 15 * 60 * 1000;

        const metadata: SessionMetadata = {
          provider: 'oidc',
          expiresAt,
        };

        // CRIT-04: Only store metadata, not tokens
        storeSessionMetadata(metadata);
        dispatch({ type: 'TOKEN_REFRESH', payload: { token: 'oauth2-session', metadata } });
      } catch (error: any) {
        clientLogger.error('[AUTH] OAuth token refresh failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        // No need to revoke - server handles token invalidation
        clearSession();
        dispatch({ type: 'AUTH_FAILURE', payload: 'Session expired' });
        toast.error('Your session expired. Please sign in again.');
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [state.sessionProvider, dispatch]);

  const refreshPasswordToken = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    if (state.sessionProvider !== 'local') {
      return null;
    }

    const refreshPromise = (async () => {
      try {
        const refreshResponse = await fetch('/api/auth/password/refresh', {
          method: 'POST',
          credentials: 'include', // Send HTTP-only cookies
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (!refreshResponse.ok) {
          throw new Error('Token refresh failed');
        }

        const data = await refreshResponse.json();

        // Calculate new expiry time
        const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : null;

        const metadata: SessionMetadata = {
          provider: 'local',
          expiresAt,
        };

        // CRIT-04: Only store metadata, not tokens
        storeSessionMetadata(metadata);
        dispatch({ type: 'TOKEN_REFRESH', payload: { token: 'local-session', metadata } });

        clientLogger.info('[AUTH] Local session token refreshed');
      } catch (error: any) {
        clientLogger.error('[AUTH] Local session token refresh failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        clearSession();
        dispatch({ type: 'AUTH_FAILURE', payload: 'Session expired' });
        toast.error('Your session expired. Please sign in again.');
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [state.sessionProvider, dispatch]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    if (!state.isAuthenticated || !state.tokenExpiresAt) {
      return undefined;
    }

    // Handle both OIDC and local providers
    const refreshHandler = state.sessionProvider === 'oidc'
      ? refreshOidcToken
      : state.sessionProvider === 'local'
      ? refreshPasswordToken
      : null;

    if (!refreshHandler) {
      return undefined;
    }

    const delay = Math.max(state.tokenExpiresAt - Date.now() - REFRESH_BUFFER_MS, MIN_REFRESH_DELAY_MS);

    if (delay <= MIN_REFRESH_DELAY_MS) {
      refreshHandler();
      return undefined;
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshHandler();
    }, delay);

    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [state.isAuthenticated, state.sessionProvider, state.tokenExpiresAt, refreshOidcToken, refreshPasswordToken]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Listen for token invalid events
  useEffect(() => {
    const handleTokenInvalid = () => {
      clientLogger.info('[AUTH] Token invalid event received, logging out');
      dispatch({ type: 'LOGOUT' });
      clearSession();

      // Redirect to login page
      if (typeof window !== 'undefined') {
        toast.error('Your session has expired. Please login again.');
        // Use window.location for immediate redirect
        setTimeout(() => {
          window.location.href = '/login';
        }, 100); // Small delay to ensure toast is visible
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('auth:token-invalid', handleTokenInvalid);
      return () => window.removeEventListener('auth:token-invalid', handleTokenInvalid);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      dispatch({ type: 'AUTH_START' });
      try {
        const response = await authService.login(email, password);

        if (!response.success) {
          throw new Error(response.error || 'Login failed');
        }

        // Response data contains user and expiresAt (token is in HTTP-only cookie)
        const responseData = response.data as any;

        if (!responseData?.user) {
          throw new Error('Invalid login response');
        }

        // Token is in HTTP-only cookie set by auth service
        // CRIT-04: Only store metadata, not tokens
        const metadata: SessionMetadata = {
          provider: 'local',
          expiresAt: responseData.expiresAt ? new Date(responseData.expiresAt).getTime() : null
        };

        // Store only session metadata for expiry tracking
        storeSessionMetadata(metadata);

        // Use loadProfile to get normalized user data (same as refresh flow)
        // This ensures all user fields are properly populated including role, permissions, etc.
        await loadProfile('local-session', metadata);

        clientLogger.info('[AUTH] Login successful', {
          userId: responseData.user.id,
        });
      } catch (error: any) {
        clientLogger.error('[AUTH] Login failed:', { error: error instanceof Error ? error.message : String(error) });
        const message = error?.message || 'Failed to login';
        dispatch({ type: 'AUTH_FAILURE', payload: message });
        toast.error(message);
        throw error;
      }
    },
    [loadProfile]
  );

  const completeOAuthLogin = useCallback(
    async (session: any) => {
      // With HTTP-only cookies, we receive a session object with user data
      // Tokens are managed server-side, not exposed to JavaScript
      if (!session?.user) {
        throw new Error('Missing user data in session');
      }

      const user = session.user;
      const normalizedRole = normalizeUserRole(user.role);

      if (!normalizedRole) {
        throw new Error(`Unsupported role "${user.role}" for portal access`);
      }

      const normalizedUser = {
        ...user,
        role: normalizedRole,
      };
      const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : null;

      const metadata: SessionMetadata = {
        provider: 'oidc',
        expiresAt,
      };

      // CRIT-04: Only store metadata, not tokens
      // Real tokens are in HTTP-only cookies managed server-side
      storeSessionMetadata(metadata);
      dispatch({ type: 'AUTH_SUCCESS', payload: { user: normalizedUser, token: 'oauth2-session', metadata } });
    },
    []
  );

  // Complete local auth session after login API has set the HTTP-only cookie
  // This avoids calling the login API twice - just loads the profile from /users/me
  const completePasswordSession = useCallback(
    async (expiresAt?: string | null) => {
      const metadata: SessionMetadata = {
        provider: 'local',
        expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
      };

      // CRIT-04: Only store metadata, not tokens
      storeSessionMetadata(metadata);

      // Load profile to get normalized user data with permissions
      await loadProfile('local-session', metadata);

      clientLogger.info('[AUTH] Session established');
    },
    [loadProfile]
  );

  const logout = useCallback(async () => {
    try {
      // Single logout path for all session types — server clears all cookies regardless
      await oauthLogout();
    } catch (error) {
      clientLogger.error('[AUTH] Logout error:', { error });
    } finally {
      // CRIT-04: Only clear metadata - tokens are cleared server-side
      clearSession();
      dispatch({ type: 'LOGOUT' });
      toast.success('Logged out successfully');
      // Hard redirect to login - small delay so toast is visible (matches auth:token-invalid handler)
      setTimeout(() => { window.location.href = '/login'; }, 100);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!state.token) {
      throw new Error('No active session');
    }
    const metadata: SessionMetadata | undefined = state.sessionProvider || state.tokenExpiresAt
      ? {
          provider: state.sessionProvider ?? undefined,
          expiresAt: state.tokenExpiresAt ?? undefined,
        }
      : undefined;

    await loadProfile(state.token, metadata);
  }, [state.token, state.sessionProvider, state.tokenExpiresAt, loadProfile]);

  // Permission checking functions
  const hasPermission = useCallback((resource: string, action: string): boolean => {
    if (!state.user) return false;

    // super_admin bypasses all RBAC checks
    if (isSuperAdmin(state.user.role)) return true;

    if (!state.user.permissions) return false;

    return state.user.permissions.some((permission: Permission | string) => {
      if (typeof permission === 'string') {
        return permission === '*' || permission === `${resource}:${action}`;
      } else {
        return permission.resource === resource && permission.actions.includes(action);
      }
    });
  }, [state.user]);

  const hasRole = useCallback((role: string): boolean => {
    if (!state.user) return false;
    return state.user.role === role;
  }, [state.user]);

  const checkPermissions = useCallback((permissions: string[]): boolean => {
    if (!state.user) return false;

    return permissions.every(permission => {
      const [resource, action] = permission.split(':');
      return hasPermission(resource, action);
    });
  }, [state.user, hasPermission]);

  const value = useMemo(
    () => ({
      ...state,
      login,
      completeOAuthLogin,
      completePasswordSession,
      logout,
      refreshProfile,
      hasPermission,
      hasRole,
      checkPermissions,
    }),
    [state, login, completeOAuthLogin, completePasswordSession, logout, refreshProfile, hasPermission, hasRole, checkPermissions]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// Higher-order component for protected routes
interface WithAuthProps {
  permissions?: string[];
  roles?: string[];
  fallback?: ReactNode;
}

export function withAuth<P extends object>(
  Component: React.ComponentType<P>,
  options: WithAuthProps = {}
) {
  return function AuthenticatedComponent(props: P) {
    const { isAuthenticated, isLoading, hasRole, checkPermissions } = useAuth();
    const { permissions = [], roles = [], fallback } = options;
    const router = useRouter();

    useEffect(() => {
      if (!isLoading && !isAuthenticated) {
        router.push('/login');
      }
    }, [isLoading, isAuthenticated, router]);

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    if (!isAuthenticated) {
      if (fallback) return <>{fallback}</>;
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-600">Redirecting to login...</div>
        </div>
      );
    }

    // Check role requirements
    if (roles.length > 0 && !roles.some(role => hasRole(role))) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You don't have permission to access this page.</p>
          </div>
        </div>
      );
    }

    // Check permission requirements
    if (permissions.length > 0 && !checkPermissions(permissions)) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You don't have the required permissions.</p>
          </div>
        </div>
      );
    }

    return <Component {...props} />;
  };
}
