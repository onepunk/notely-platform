/**
 * Secure Beta Token Exchange Routes
 *
 * These routes handle secure transfer of beta tokens without URL exposure.
 *
 * Flow:
 * 1. Email links point to GET /api/portal/beta/init?token=xxx
 * 2. This endpoint validates the token, stores it in HTTP-only cookie, redirects to /login
 * 3. Login page calls GET /api/portal/beta/token to retrieve the token
 * 4. Token is cleared from cookie after retrieval (one-time use)
 *
 * Security benefits:
 * - Token only appears in URL once (initial email link click)
 * - After redirect, token is stored securely in HTTP-only cookie
 * - Token is not visible in browser history after redirect
 * - Token is not leaked via Referer headers
 * - Token is cleared after first retrieval
 */

const express = require('express');
const shared = require('@notely/shared');

const logger = shared.logger.child({ module: 'portal-bff-beta-token' });
const router = express.Router();

// Support service URL for token validation
const SUPPORT_SERVICE_URL = process.env.SUPPORT_SERVICE_URL || 'http://support:3209';
const PORTAL_DOMAIN = process.env.PORTAL_DOMAIN || 'portal.yourdomain.com';

// Cookie configuration for secure beta token storage
const BETA_TOKEN_COOKIE_NAME = 'notely_beta_token';
const BETA_TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 5 * 60 * 1000, // 5 minutes
  path: '/'
};

/**
 * GET /api/portal/beta/init
 *
 * Entry point for beta invitation links.
 * Validates the token, stores it securely, and redirects to login page.
 *
 * Query params:
 * - token: The beta access token from the invitation email
 * - redirect: Optional redirect path after login (default: /dashboard)
 */
router.get('/init', async (req, res) => {
  const { token, redirect } = req.query;

  // Sanitize redirect parameter
  const sanitizedRedirect = sanitizeRedirectPath(redirect);

  if (!token || typeof token !== 'string' || token.length < 10) {
    logger.warn('Beta token init: invalid or missing token');
    return res.redirect(`/login?beta_error=invalid_token&redirect=${encodeURIComponent(sanitizedRedirect)}`);
  }

  try {
    // Validate the token with the support service
    const validateResponse = await fetch(`${SUPPORT_SERVICE_URL}/api/support/beta/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const validateData = await validateResponse.json();

    if (!validateResponse.ok || !validateData.success) {
      const errorCode = validateData.error || 'invalid_token';
      logger.warn('Beta token init: validation failed', { error: errorCode });
      return res.redirect(`/login?beta_error=${encodeURIComponent(errorCode)}&redirect=${encodeURIComponent(sanitizedRedirect)}`);
    }

    // Token is valid - store it in HTTP-only cookie
    res.cookie(BETA_TOKEN_COOKIE_NAME, token, BETA_TOKEN_COOKIE_OPTIONS);

    logger.info('Beta token init: token stored securely', {
      signupId: validateData.data?.signupId,
      email: validateData.data?.email
    });

    // Redirect to login page (clean URL, no token visible)
    res.redirect(`/login?beta=true&redirect=${encodeURIComponent(sanitizedRedirect)}`);

  } catch (error) {
    logger.error('Beta token init: error validating token', { error: error.message });
    res.redirect(`/login?beta_error=server_error&redirect=${encodeURIComponent(sanitizedRedirect)}`);
  }
});

/**
 * GET /api/portal/beta/token
 *
 * Retrieves the beta token from the secure cookie.
 * Clears the cookie after retrieval (one-time use).
 *
 * Returns:
 * - { success: true, token: "xxx", email: "...", firstName: "...", lastName: "..." } if token exists and is valid
 * - { success: false, error: "no_token" } if no token in cookie
 */
router.get('/token', async (req, res) => {
  const token = req.cookies[BETA_TOKEN_COOKIE_NAME];

  if (!token) {
    return res.json({
      success: false,
      error: 'no_token',
      message: 'No beta token found'
    });
  }

  // Clear the cookie immediately (one-time use)
  res.clearCookie(BETA_TOKEN_COOKIE_NAME, { path: '/' });

  try {
    // Validate the token is still valid
    const validateResponse = await fetch(`${SUPPORT_SERVICE_URL}/api/support/beta/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const validateData = await validateResponse.json();

    if (!validateResponse.ok || !validateData.success) {
      logger.warn('Beta token retrieval: token no longer valid', { error: validateData.error });
      return res.json({
        success: false,
        error: validateData.error || 'invalid_token',
        message: validateData.message || 'Token is no longer valid'
      });
    }

    logger.info('Beta token retrieval: token retrieved and cleared from cookie', {
      signupId: validateData.data?.signupId
    });

    // Return the token and signup info
    res.json({
      success: true,
      token,
      email: validateData.data?.email,
      firstName: validateData.data?.firstName,
      lastName: validateData.data?.lastName,
      expiresAt: validateData.data?.expiresAt
    });

  } catch (error) {
    logger.error('Beta token retrieval: error validating', { error: error.message });
    // Still return the token - let the client handle redemption failures
    res.json({
      success: true,
      token,
      validationError: 'Unable to validate token, please try redemption'
    });
  }
});

/**
 * Sanitize redirect path to prevent open redirects
 */
function sanitizeRedirectPath(redirect) {
  if (!redirect || typeof redirect !== 'string') {
    return '/dashboard';
  }

  const trimmed = redirect.trim();

  // Only allow relative paths starting with /
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/dashboard';
  }

  // Block any URLs that look like they could be protocol-relative or contain auth info
  if (trimmed.includes('@') || trimmed.includes(':')) {
    return '/dashboard';
  }

  return trimmed;
}

module.exports = router;
