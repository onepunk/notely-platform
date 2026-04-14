/**
 * Next.js Middleware for Route Protection
 * Enforces role-based access control for admin routes
 *
 * SECURITY LAYERS:
 * 1. This middleware (primary protection - runs at edge before page rendering)
 * 2. getServerSideProps validation (secondary - defense in depth)
 * 3. Client-side guards (tertiary - UX and client-side navigation)
 * 4. API middleware (already implemented - backend protection)
 *
 * AUTHENTICATION BEHAVIOR (Role-Aware Expiry Handling):
 * - No token: 404 (hides admin routes from unauthenticated users)
 * - Invalid/tampered token: 404 (suspicious activity)
 * - Expired token (admin role): Redirect to login (good UX for admins)
 * - Expired token (non-admin role): 404 (hide admin routes)
 * - Valid token (wrong role): 404 (hide admin routes from non-admins)
 * - Valid token (correct role): Allow access
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { importSPKI, jwtVerify, decodeJwt, errors } from 'jose';
import { hasRouteAccess, type UserRole } from './src/config/access-control';

const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY;
let cachedPublicKey: CryptoKey | null = null;

// Admin-type roles — mirrors shared.constants.roles.isAdmin()
// Kept local because Edge Runtime cannot import CommonJS packages
const ADMIN_ROLES: UserRole[] = ['super_admin', 'admin'];

/**
 * Structured logging helper for Edge Runtime (Winston not available)
 * Outputs JSON format that Promtail can parse
 */
const log = {
  info: (message: string, meta?: Record<string, any>) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'portal',
      message,
      ...meta
    }));
  },
  warn: (message: string, meta?: Record<string, any>) => {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'portal',
      message,
      ...meta
    }));
  },
  error: (message: string, meta?: Record<string, any>) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'portal',
      message,
      ...meta
    }));
  },
  debug: (message: string, meta?: Record<string, any>) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'debug',
        service: 'portal',
        message,
        ...meta
      }));
    }
  }
};

/**
 * Get JWT public key (RS256) for jose verification in Edge runtime
 * Cached to avoid re-importing on every request
 */
const getJwtPublicKey = async (): Promise<CryptoKey> => {
  if (cachedPublicKey) {
    return cachedPublicKey;
  }

  if (!JWT_PUBLIC_KEY) {
    log.error('[MIDDLEWARE] JWT_PUBLIC_KEY environment variable is not set');
    throw new Error('JWT_PUBLIC_KEY environment variable is not set');
  }

  const normalizedKey = JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
  cachedPublicKey = await importSPKI(normalizedKey, 'RS256');
  return cachedPublicKey;
};

/**
 * Extract JWT token from request (supports both cookie and header)
 */
function getToken(request: NextRequest): { token: string; source: string } | null {
  // Try access_token first (primary method for browser sessions)
  const accessToken = request.cookies.get('access_token')?.value;
  if (accessToken) {
    return { token: accessToken, source: 'access_token' };
  }

  // Fallback to legacy/placeholder cookie
  const legacyToken = request.cookies.get('notely_token')?.value;
  if (legacyToken) {
    return { token: legacyToken, source: 'notely_token' };
  }

  // Fallback to Authorization header (for API-style requests)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return { token: authHeader.replace('Bearer ', '').trim(), source: 'authorization' };
  }

  return null;
}

/**
 * Check if a role is an admin-type role (admin, operator, viewer)
 * These users know admin routes exist and should get login redirects on expiry
 */
function isAdminRole(role: string | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role as UserRole);
}

/**
 * Extract the actual page path from request
 * Handles both direct page requests and Next.js data fetching requests
 */
function extractPagePath(requestPath: string): string {
  // Check if this is a Next.js data request
  if (requestPath.startsWith('/_next/data/')) {
    // Path format: /_next/data/BUILD_ID/admin/settings.json
    // Extract everything after BUILD_ID and remove .json extension
    const match = requestPath.match(/\/_next\/data\/[^/]+(.+)\.json$/);
    if (match) {
      return match[1];
    }
  }
  return requestPath;
}

/**
 * Create a 404 response, optionally clearing auth cookies
 */
function create404Response(request: NextRequest, clearCookies = false): NextResponse {
  const response = NextResponse.rewrite(new URL('/404', request.url));
  if (clearCookies) {
    response.cookies.delete('access_token');
    response.cookies.delete('notely_token');
  }
  return response;
}

/**
 * Create a redirect to login response with return URL
 */
function createLoginRedirect(request: NextRequest, returnPath: string): NextResponse {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', returnPath);
  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete('access_token');
  response.cookies.delete('notely_token');
  return response;
}

/**
 * Main middleware function
 */
export async function middleware(request: NextRequest) {
  const requestPath = request.nextUrl.pathname;
  const actualPath = extractPagePath(requestPath);

  // For data requests that somehow don't match admin paths, skip middleware
  if (requestPath.startsWith('/_next/data/') && !actualPath.startsWith('/admin')) {
    return NextResponse.next();
  }

  // Extract token from request
  const tokenInfo = getToken(request);

  if (!tokenInfo) {
    // No token - return 404 to hide admin routes from unauthenticated users
    // This is intentional: we don't want to reveal that admin routes exist
    log.info('[MIDDLEWARE] No token found, returning 404', { requestPath, actualPath });
    return create404Response(request);
  }

  const { token, source: tokenSource } = tokenInfo;

  try {
    // Verify JWT token (throws if invalid/expired)
    const publicKey = await getJwtPublicKey();
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256']
    });

    const userRole = payload.role as UserRole;

    if (!userRole) {
      log.error('[MIDDLEWARE] JWT payload missing role field');
      return create404Response(request, true);
    }

    // super_admin bypasses all middleware checks
    if (userRole === 'super_admin') {
      log.info('[MIDDLEWARE] super_admin bypass', { requestPath, actualPath, tokenSource });
      return NextResponse.next();
    }

    // Check if user has access to this route (static config fallback)
    // Full DB-driven enforcement happens in getServerSideProps via withAuth
    const hasAccess = hasRouteAccess(actualPath, userRole);

    if (!hasAccess) {
      log.warn('[MIDDLEWARE] Access denied - insufficient role', { userRole, requestPath, actualPath });
      return create404Response(request);
    }

    // Access granted
    log.info('[MIDDLEWARE] Access granted', { userRole, requestPath, actualPath, tokenSource });
    return NextResponse.next();

  } catch (error) {
    // Check if this is an expired token (signature was valid)
    if (error instanceof errors.JWTExpired) {
      log.info('[MIDDLEWARE] Token expired, checking role for redirect decision');
      try {
        // Decode without verification to check role
        // This is safe because JWTExpired means the signature WAS valid, just expired
        const payload = decodeJwt(token);
        const userRole = payload.role as string;

        if (isAdminRole(userRole)) {
          // Admin session expired - redirect to login for good UX
          // These users already know admin routes exist
          log.info('[MIDDLEWARE] Expired admin session, redirecting to login', {
            userRole,
            requestPath,
            actualPath
          });
          return createLoginRedirect(request, actualPath);
        }

        // Non-admin expired token - return 404 to hide admin routes
        log.info('[MIDDLEWARE] Expired non-admin session, returning 404', {
          userRole,
          requestPath,
          actualPath
        });
      } catch (decodeError) {
        log.debug('[MIDDLEWARE] Failed to decode expired token');
      }
    } else {
      // Log other types of verification errors
      log.warn('[MIDDLEWARE] Token verification failed', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        requestPath,
        actualPath
      });
    }

    // All other cases: invalid token, failed decode, non-admin expired → 404
    return create404Response(request, true);
  }
}

/**
 * Configure which routes this middleware runs on
 * Covers both direct page requests and Next.js client-side data fetching
 */
export const config = {
  matcher: [
    // Direct admin page requests
    '/admin/:path*',
    // Next.js data fetching for admin pages (client-side navigation)
    // These paths are used when navigating between pages client-side
    '/_next/data/:buildId/admin.json',
    '/_next/data/:buildId/admin/:path*',
  ],
};
