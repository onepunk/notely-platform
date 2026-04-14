/**
 * OAuth2 Client for Portal
 *
 * Simplified OAuth client for direct Microsoft OAuth without OIDC provider.
 * Uses HTTP-only cookies for token storage (managed server-side).
 */

import { sanitizeRedirectUrl } from '@/lib/urlSecurity';

/**
 * Start Microsoft OAuth login flow
 * Redirects to auth service which handles PKCE and redirects to Microsoft
 *
 * @param returnTo - Path to return to after login (default: /dashboard)
 * @param betaToken - Optional beta access token for beta invite flow
 */
export function startMicrosoftLogin(returnTo: string = '/dashboard', betaToken?: string) {
  // Validate return_to using shared URL security utility
  const safeReturnTo = sanitizeRedirectUrl(returnTo, '/dashboard');

  // CRITICAL: Always redirect through /oauth/callback to hydrate AuthContext
  // The callback page fetches /api/auth/session and updates React state
  // Direct redirects skip this step, leaving the user appearing unauthenticated
  // Use 'redirect' parameter to match desktop upgrade flow expectations
  const callbackPath = `/oauth/callback?redirect=${encodeURIComponent(safeReturnTo)}`;

  // Build auth service URL (direct to auth service, not through portal API)
  // OAuth endpoints are at /api/auth/*, not /api/portal/*
  const authUrl = new URL('/api/auth/microsoft/login', window.location.origin);
  authUrl.searchParams.set('return_to', callbackPath);
  authUrl.searchParams.set('client_type', 'portal');

  // Pass beta token if provided (for beta invite flow)
  if (betaToken) {
    authUrl.searchParams.set('beta_token', betaToken);
  }

  // Redirect to auth service (which will redirect to Microsoft)
  window.location.href = authUrl.toString();
}

/**
 * Complete OAuth login by fetching session from auth service
 * Auth service reads HTTP-only cookies and returns user data
 *
 * @returns User session data
 */
export async function completeOAuthLogin() {
  // OAuth endpoints are at /api/auth/*, not /api/portal/*
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include', // Send HTTP-only cookies
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.message || 'Failed to retrieve session');
  }

  return await response.json();
}

/**
 * Refresh access token using refresh token (stored in HTTP-only cookie)
 * Auth service automatically rotates refresh tokens
 *
 * @returns Success status
 */
export async function refreshAccessToken() {
  // OAuth endpoints are at /api/auth/*, not /api/portal/*
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include', // Send HTTP-only cookies (refresh_token)
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_type: 'portal'
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.message || 'Failed to refresh token');
  }

  return await response.json();
}

/**
 * Logout and revoke tokens
 * Clears HTTP-only cookies and blacklists tokens
 */
export async function logout() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    // OAuth endpoints are at /api/auth/*, not /api/portal/*
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include', // Send HTTP-only cookies
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error) {
    console.warn('[OAuth] Logout request failed', error);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if user is authenticated by fetching session
 * Returns null if not authenticated
 */
export async function checkAuthStatus() {
  try {
    const session = await completeOAuthLogin();
    return session.user || null;
  } catch (error) {
    return null;
  }
}
