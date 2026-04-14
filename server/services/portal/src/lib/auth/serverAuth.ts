/**
 * Server-Side Authentication Utilities
 * For use in getServerSideProps to protect pages
 *
 * AUTHENTICATION BEHAVIOR (Role-Aware Expiry Handling):
 * - No token: 404 (hides admin routes from unauthenticated users)
 * - Invalid/tampered token: 404 (suspicious activity)
 * - Expired token (admin role): Redirect to login (good UX for admins)
 * - Expired token (non-admin role): 404 (hide admin routes)
 * - Valid token (wrong role): 404 (hide admin routes from non-admins)
 * - Valid token (correct role): Allow access
 */

import { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import jwt from 'jsonwebtoken';
import logger from '../logger';
import { normalizeUserRole } from '@/utils/role';
import { isAdmin as isAdminRole, isSuperAdmin } from '@notely/shared/constants/roles';

export type UserRole = 'super_admin' | 'admin' | 'user';

interface DecodedToken {
  userId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

/**
 * Result of token verification
 */
interface TokenVerifyResult {
  user: DecodedToken | null;
  expiredAdminSession: boolean;
}

/**
 * Check if a role is an admin-type role
 */

/**
 * Verify JWT token and extract user info
 * Returns additional info about whether this was an expired admin session
 */
async function verifyToken(token: string): Promise<TokenVerifyResult> {
  try {
    // V3 uses RS256 (public key) instead of HS256 (secret)
    const publicKey = process.env.JWT_PUBLIC_KEY;

    if (!publicKey) {
      logger.error('[SERVER_AUTH] JWT_PUBLIC_KEY not configured');
      return { user: null, expiredAdminSession: false };
    }

    // Normalise PEM format (handle escaped newlines)
    const normalisedKey = publicKey.replace(/\\n/g, '\n');

    logger.debug('[SERVER_AUTH] Verifying token', { tokenPrefix: token.substring(0, 20) });
    const decoded = jwt.verify(token, normalisedKey, {
      algorithms: ['RS256']
    }) as any;
    const normalizedRole = normalizeUserRole(decoded.role);

    if (!normalizedRole) {
      logger.warn('[SERVER_AUTH] Unsupported role from token', {
        role: decoded.role,
        email: decoded.email,
      });
      return { user: null, expiredAdminSession: false };
    }

    const userId = decoded.userId || decoded.sub;

    if (!userId) {
      logger.warn('[SERVER_AUTH] Token payload missing user identifier', {
        email: decoded.email,
        role: decoded.role,
      });
      return { user: null, expiredAdminSession: false };
    }

    logger.info('[SERVER_AUTH] Token decoded successfully', {
      email: decoded.email,
      role: normalizedRole,
      iat: decoded.iat,
      exp: decoded.exp
    });

    return {
      user: {
        userId,
        email: decoded.email,
        role: normalizedRole,
        iat: decoded.iat,
        exp: decoded.exp
      },
      expiredAdminSession: false
    };
  } catch (error: any) {
    // Check if this is a token expiration error (signature was valid)
    if (error.name === 'TokenExpiredError') {
      logger.info('[SERVER_AUTH] Token expired, checking role for redirect decision');
      try {
        // Decode without verification to check role
        // This is safe because TokenExpiredError means signature WAS valid
        const decoded = jwt.decode(token) as any;
        if (decoded) {
          const wasAdmin = isAdminRole(decoded.role);
          logger.info('[SERVER_AUTH] Expired token decoded', {
            email: decoded.email,
            role: decoded.role,
            wasAdmin
          });
          return { user: null, expiredAdminSession: wasAdmin };
        }
      } catch (decodeError) {
        logger.debug('[SERVER_AUTH] Failed to decode expired token');
      }
    } else {
      logger.error('[SERVER_AUTH] Token verification failed', {
        error: error.message,
        errorType: error.name
      });
    }
    return { user: null, expiredAdminSession: false };
  }
}

/**
 * Check if user has required role
 */
function hasRequiredRole(userRole: string | null | undefined, allowedRoles: UserRole[]): boolean {
  const normalized = normalizeUserRole(userRole);
  return normalized ? allowedRoles.includes(normalized) : false;
}

/**
 * Get token from cookies or headers
 */
function getToken(context: GetServerSidePropsContext): string | null {
  // Try OAuth cookie first (access_token from auth service)
  const oauthToken = context.req.cookies.access_token;

  // Fall back to legacy cookie (notely_token from email/password login)
  const legacyToken = context.req.cookies.notely_token;

  const cookieToken = oauthToken || legacyToken;

  logger.debug('[SERVER_AUTH] Cookie token check', {
    found: !!cookieToken,
    source: oauthToken ? 'access_token (OAuth)' : legacyToken ? 'notely_token (legacy)' : 'none',
    availableCookies: Object.keys(context.req.cookies)
  });

  if (cookieToken) {
    return cookieToken;
  }

  // Try Authorization header
  const authHeader = context.req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '').trim();
  }

  logger.debug('[SERVER_AUTH] No token found in cookies or headers');
  return null;
}

/**
 * Result of authentication check
 */
interface AuthResult {
  authorized: boolean;
  user: DecodedToken | null;
  expiredAdminSession: boolean;
}

/**
 * Require authentication for a page
 * Returns authorization status along with info about expired admin sessions
 */
export async function requireAuth(
  context: GetServerSidePropsContext,
  options: {
    allowedRoles?: UserRole[];
    redirectTo?: string;
  } = {}
): Promise<AuthResult> {
  const { allowedRoles } = options;

  const token = getToken(context);

  if (!token) {
    return { authorized: false, user: null, expiredAdminSession: false };
  }

  const result = await verifyToken(token);

  if (!result.user) {
    // Token invalid or expired - pass through expiredAdminSession flag
    return { authorized: false, user: null, expiredAdminSession: result.expiredAdminSession };
  }

  // Check role requirements
  if (allowedRoles && allowedRoles.length > 0) {
    if (!hasRequiredRole(result.user.role, allowedRoles)) {
      // Valid token but wrong role - not an expired admin session
      return { authorized: false, user: result.user, expiredAdminSession: false };
    }
  }

  return { authorized: true, user: result.user, expiredAdminSession: false };
}

/**
 * Configuration options for withAuth protection
 */
interface WithAuthOptions {
  /**
   * URL to redirect to when user is not authenticated
   * If not provided, returns 404 (security through obscurity for admin pages)
   * Set to '/login' for user-facing pages that should redirect
   */
  redirectTo?: string;
  /**
   * Permission required for this page (e.g. 'calendar:read')
   * Checked against the DB via the auth service ACL endpoint.
   * super_admin bypasses this check.
   */
  requiredPermission?: string;
}

// In-memory ACL cache: "role:path" → { allowed, expiry }
const aclCache = new Map<string, { allowed: boolean; expiry: number }>();
const ACL_CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Check ACL via the auth service (internal HTTP call)
 * Caches results for 60 seconds per role:path pair
 */
async function checkAcl(role: string, pagePath: string): Promise<boolean> {
  // super_admin bypasses all checks
  if (isSuperAdmin(role)) return true;

  const cacheKey = `${role}:${pagePath}`;
  const cached = aclCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.allowed;
  }

  try {
    const authBaseUrl = process.env.SERVICE_AUTH_URL || process.env.AUTH_SERVICE_URL || 'http://auth:3201';
    const url = `${authBaseUrl}/api/auth/acl/check?role=${encodeURIComponent(role)}&path=${encodeURIComponent(pagePath)}`;
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn('[SERVER_AUTH] ACL check HTTP error', { status: response.status, pagePath, role });
      return false;
    }
    const data = await response.json();
    const allowed = !!data.allowed;

    aclCache.set(cacheKey, { allowed, expiry: Date.now() + ACL_CACHE_TTL_MS });
    return allowed;
  } catch (error: any) {
    logger.error('[SERVER_AUTH] ACL check failed, denying access', {
      error: error.message,
      role,
      pagePath
    });
    return false;
  }
}

/**
 * Higher-order function to protect pages with getServerSideProps
 *
 * Security behavior (Role-Aware Expiry Handling):
 * - No token: 404 (hides admin routes)
 * - Invalid token: 404 (suspicious activity)
 * - Expired admin token: Redirect to login (good UX for admins)
 * - Expired non-admin token: 404 (hide admin routes)
 * - Valid token, wrong role: 404 (hide admin routes from non-admins)
 * - Valid token, correct role + ACL passes: Allow access
 */
export function withAuth<P extends { [key: string]: any }>(
  allowedRoles: UserRole[],
  optionsOrFunc?: WithAuthOptions | ((
    context: GetServerSidePropsContext,
    user: DecodedToken
  ) => Promise<GetServerSidePropsResult<P>>),
  getServerSidePropsFunc?: (
    context: GetServerSidePropsContext,
    user: DecodedToken
  ) => Promise<GetServerSidePropsResult<P>>
) {
  // Handle overloaded parameters
  let options: WithAuthOptions = {};
  let wrappedFunc = getServerSidePropsFunc;

  if (typeof optionsOrFunc === 'function') {
    wrappedFunc = optionsOrFunc;
  } else if (optionsOrFunc) {
    options = optionsOrFunc;
  }

  return async (
    context: GetServerSidePropsContext
  ): Promise<GetServerSidePropsResult<P>> => {
    logger.debug('[SERVER_AUTH] Checking authorization', {
      url: context.resolvedUrl,
      allowedRoles
    });

    const { authorized, user, expiredAdminSession } = await requireAuth(context, { allowedRoles });

    logger.info('[SERVER_AUTH] Authorization result', {
      authorized,
      userRole: user?.role,
      expiredAdminSession
    });

    // Not authenticated or wrong role
    if (!authorized || !user) {
      // Check if this was an expired admin session - redirect to login for good UX
      // These users already know admin routes exist, so no security leak
      if (expiredAdminSession) {
        logger.info('[SERVER_AUTH] Expired admin session, redirecting to login', {
          url: context.resolvedUrl
        });
        const returnUrl = encodeURIComponent(context.resolvedUrl);
        return {
          redirect: {
            destination: `/login?redirect=${returnUrl}`,
            permanent: false,
          },
        };
      }

      logger.warn('[SERVER_AUTH] Access denied', {
        url: context.resolvedUrl,
        userRole: user?.role,
        action: options.redirectTo ? 'redirecting' : 'returning 404'
      });

      // Redirect to login if configured (for user-facing pages)
      if (options.redirectTo) {
        // Include return URL so user is redirected back after login
        const returnUrl = encodeURIComponent(context.resolvedUrl);
        const destination = `${options.redirectTo}?redirect=${returnUrl}`;
        return {
          redirect: {
            destination,
            permanent: false,
          },
        };
      }

      // Return 404 for admin pages (security through obscurity)
      return {
        notFound: true,
      };
    }

    // DB-driven ACL check (super_admin bypasses automatically)
    if (options.requiredPermission) {
      // Extract the page path from the URL for ACL matching
      const pagePath = context.resolvedUrl.split('?')[0];
      const aclAllowed = await checkAcl(user.role, pagePath);
      if (!aclAllowed) {
        logger.warn('[SERVER_AUTH] ACL denied access', {
          url: context.resolvedUrl,
          userRole: user.role,
          requiredPermission: options.requiredPermission
        });
        return { notFound: true };
      }
    }

    logger.info('[SERVER_AUTH] Access granted', {
      url: context.resolvedUrl,
      userRole: user.role
    });

    // User is authorized, execute wrapped function if provided
    if (wrappedFunc) {
      return await wrappedFunc(context, user);
    }

    // No wrapped function, just return empty props
    return {
      props: {} as P,
    };
  };
}
