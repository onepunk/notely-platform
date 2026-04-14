/**
 * Auth Routes
 *
 * Handles login, logout, token refresh, and token validation.
 */

const express = require('express');
const router = express.Router();
const shared = require('@notely/shared');
const { isSuperAdmin } = shared.constants.roles;
const logger = shared.logger;
const {
  loginRateLimiter,
  consumeLoginPoints,
  registerRateLimiter,
  validateRateLimiter,
  changePasswordRateLimiter
} = shared.middleware.rateLimiter;
const { createEndpointLimiter } = shared.middleware.rateLimiter;
const authService = require('../services/authService');
const registrationService = require('../services/registrationService');
const verificationService = require('../services/verificationService');
const authMiddleware = require('../middleware/auth');
const { buildPortalCookieOptions, inferSecureCookieFlag, shouldDefaultSecureCookies } = require('../utils/cookieOptions');

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token
 *
 * Rate limited by:
 * - IP address: 10 attempts per 15 minutes
 * - Email address: 5 attempts per 15 minutes
 * - Consecutive failures: Account locked after 5 consecutive failures
 */
router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      // Don't consume rate limit points for validation errors
      return res.status(400).json({
        error: 'Missing credentials',
        message: 'Email and password are required'
      });
    }

    const result = await authService.login(email, password, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    // Consume rate limit points based on success/failure
    await consumeLoginPoints(req, result.success);

    if (!result.success) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: result.message,
        code: result.code || undefined
      });
    }

    logger.info('User logged in', { userId: result.user.id, email, mustChangePassword: result.mustChangePassword });

    // Build cookie options with proper domain for cross-subdomain sharing
    const useSecureCookies = inferSecureCookieFlag(req, shouldDefaultSecureCookies());
    const cookieOptions = buildPortalCookieOptions({ secure: useSecureCookies });

    // Clear any stale auth cookies to prevent conflicts (use same domain as we'll set)
    res.clearCookie('access_token', cookieOptions);
    res.clearCookie('notely_token', cookieOptions);

    // Set new token as HTTP-only secure cookie for SSR
    // maxAge: 7 days (matches typical JWT expiry)
    const cookieOptionsWithMaxAge = {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000
    };

    res.cookie('access_token', result.token, cookieOptionsWithMaxAge);
    logger.info('Set access_token cookie', {
      userId: result.user.id,
      role: result.user.role,
      email: result.user.email,
      domain: cookieOptions.domain || '(no domain)',
      secure: cookieOptions.secure
    });

    // Return in format expected by portal authService
    // Token is only in HTTP-only cookie for security
    res.json({
      success: true,
      data: {
        expiresAt: result.expiresAt,
        scopes: result.scopes,
        mustChangePassword: result.mustChangePassword || false,
        user: {
          id: result.user.id,
          credentialId: result.user.credentialId,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/session
 * Retrieve current session from HTTP-only cookie
 * Works for both password-based and OAuth sessions
 */
router.get('/session', async (req, res, next) => {
  try {
    // Get access token from cookie
    const accessToken = req.cookies.access_token;

    if (!accessToken) {
      return res.status(401).json({
        error: 'No session',
        message: 'No access token found in cookies'
      });
    }

    // Verify token
    const result = await authService.validateToken(accessToken);

    if (!result.valid) {
      return res.status(401).json({
        error: 'Invalid session',
        message: result.message || 'Session is invalid'
      });
    }

    // Return user data (matching OAuth session format)
    res.json({
      user: {
        id: result.userId,
        email: result.email,
        role: result.role,
        scopes: result.scopes || []
      }
    });
  } catch (error) {
    logger.error('Session retrieval error', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/auth/register
 * Register a new user account (email/password)
 *
 * Rate limited by IP address: 5 registrations per hour
 */
router.post('/register', registerRateLimiter, async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, betaToken } = req.body || {};

    const user = await registrationService.registerLocalUser({
      email,
      password,
      firstName,
      lastName,
      betaToken,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || null
    });

    res.status(201).json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout
 * Invalidate JWT token (remove from session store)
 *
 * NOTE: This is for password-based auth logout.
 * For OAuth2 logout, use /api/auth/logout from oauth2.js routes.
 * Accepts token from either:
 * - Authorization header (Bearer token)
 * - HTTP-only access_token cookie (for password sessions)
 */
router.post('/logout', async (req, res, next) => {
  try {
    // Accept token from header OR cookie (password sessions use HTTP-only cookies)
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies.access_token;

    // CSRF protection: require a token to be present (cookie or header).
    // Cookies use sameSite: 'lax', so cross-origin POSTs won't include them.
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Build cookie options for clearing - do this regardless of token validity
    const useSecureCookies = inferSecureCookieFlag(req, shouldDefaultSecureCookies());
    const cookieOptions = buildPortalCookieOptions({ secure: useSecureCookies });

    // Always clear ALL auth cookies - ensures clean logout for both password and OAuth sessions
    res.clearCookie('access_token', cookieOptions);
    res.clearCookie('refresh_token', cookieOptions); // OAuth sessions use this
    res.clearCookie('notely_token', cookieOptions);

    if (token && token !== 'password-session' && token !== 'oauth2-session') {
      // Only attempt to invalidate if it looks like a real JWT
      try {
        await authService.logout(token);
        logger.info('User logged out', {
          token: token.substring(0, 20) + '...',
          clearedCookies: true,
          domain: cookieOptions.domain || '(no domain)'
        });
      } catch (logoutError) {
        // Log but don't fail - we still want to clear cookies
        logger.warn('Token invalidation failed during logout', {
          error: logoutError.message
        });
      }
    } else {
      logger.info('User logged out (no token to invalidate)', {
        clearedCookies: true,
        domain: cookieOptions.domain || '(no domain)'
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/password/refresh
 * Refresh access token for password-based auth
 * Note: OAuth refresh is at /api/auth/refresh (in oauth2.js)
 */
router.post('/password/refresh', async (req, res, next) => {
  try {
    const accessToken = req.cookies.access_token;

    if (!accessToken) {
      return res.status(401).json({
        error: 'No session',
        message: 'No access token found'
      });
    }

    // Validate and refresh token
    const result = await authService.refreshToken(accessToken);

    if (!result.success) {
      return res.status(401).json({
        error: 'Refresh failed',
        message: result.message || 'Could not refresh token'
      });
    }

    // Set new token in cookie
    const useSecureCookies = inferSecureCookieFlag(req, shouldDefaultSecureCookies());
    const cookieOptions = buildPortalCookieOptions({ secure: useSecureCookies });

    res.cookie('access_token', result.token, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    logger.info('Password auth token refreshed', {
      token: result.token.substring(0, 20) + '...'
    });

    res.json({
      success: true,
      expiresAt: result.expiresAt
    });
  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/auth/validate
 * Validate JWT token (used by other services)
 *
 * Rate limited by IP address: 100 validations per minute
 * (Higher limit since this is used for service-to-service communication)
 */
router.post('/validate', validateRateLimiter, async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Missing token',
        message: 'Token is required'
      });
    }

    const result = await authService.validateToken(token);

    if (!result.valid) {
      return res.status(401).json({
        valid: false,
        message: result.message
      });
    }

    res.json({
      valid: true,
      userId: result.userId,
      email: result.email,
      role: result.role,
      scopes: result.scopes
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/roles/:role/permissions
 * Get permissions for a role (used by portal-bff to enrich user profile)
 */
router.get('/roles/:role/permissions', async (req, res, next) => {
  try {
    const { role } = req.params;

    if (!role) {
      return res.status(400).json({
        error: 'Invalid role',
        message: 'Role parameter is required'
      });
    }

    const aclModel = require('../models/aclModel');
    const permissions = await aclModel.getPermissionsForRole(role);

    res.json(permissions);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/change-password
 * Change user password (requires authentication)
 *
 * SECURITY: This endpoint requires authentication and only allows users to change
 * their own password. The user ID is extracted from the authenticated session,
 * NOT from the request body. This prevents attackers from changing other users' passwords.
 *
 * Rate limited by authenticated user: 3 attempts per 15 minutes
 *
 * Request body:
 * - currentPassword: string - User's current password for verification
 * - newPassword: string - New password to set
 *
 * The credentialId is derived from the authenticated user's session (req.userId).
 */
router.post('/change-password', authMiddleware, changePasswordRateLimiter, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get the authenticated user's ID from the session - NEVER trust client-provided IDs
    const credentialId = req.userId;

    if (!credentialId) {
      // This should never happen if authMiddleware is working correctly
      logger.error('Change password attempted without authenticated user ID', {
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
      return res.status(401).json({
        error: 'Authentication required',
        message: 'You must be logged in to change your password'
      });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'currentPassword and newPassword are required'
      });
    }

    // Audit log the attempt (before we know if it succeeded)
    logger.info('Password change attempt', {
      userId: credentialId,
      email: req.userEmail,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    const result = await authService.changePassword(credentialId, currentPassword, newPassword);

    if (!result.success) {
      // Log failed attempt for security monitoring
      logger.warn('Password change failed', {
        userId: credentialId,
        email: req.userEmail,
        reason: result.message,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      return res.status(400).json({
        success: false,
        error: result.message,
        errors: result.errors || [],
        checks: result.checks || {}
      });
    }

    // Log successful password change
    logger.info('Password changed successfully', {
      userId: credentialId,
      email: req.userEmail,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/security-settings
 * Get public security settings (local login status, password requirements)
 * This endpoint is public so the login page can check if local login is enabled
 */
router.get('/security-settings', async (req, res, next) => {
  try {
    const settings = await authService.getSecuritySettings();

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/verify-email
 * Verify email address with an 8-character code
 *
 * Rate limited: 5 attempts per 15 minutes
 */
const verifyEmailLimiter = createEndpointLimiter('verify-email', {
  points: 5,
  duration: 900,
  blockDuration: 900
});

router.post('/verify-email', verifyEmailLimiter, async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        error: 'Missing fields',
        message: 'Email and verification code are required'
      });
    }

    const result = await verificationService.verifyCode(email, code);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/resend-verification
 * Resend verification code to an unverified user
 *
 * Rate limited: 5 attempts per 15 minutes
 */
const resendVerificationLimiter = createEndpointLimiter('resend-verification', {
  points: 5,
  duration: 900,
  blockDuration: 900
});

router.post('/resend-verification', resendVerificationLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Missing field',
        message: 'Email is required'
      });
    }

    const result = await verificationService.resendCode(email);

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/acl/check
 * Check if a role has access to a given path
 * Used internally by portal middleware and getServerSideProps
 */
router.get('/acl/check', async (req, res, next) => {
  try {
    const { role, path } = req.query;

    if (!role || !path) {
      return res.status(400).json({
        allowed: false,
        error: 'role and path query parameters are required'
      });
    }

    // super_admin bypasses all checks
    if (isSuperAdmin(role)) {
      return res.json({ allowed: true });
    }

    const aclModel = require('../models/aclModel');
    const result = await aclModel.checkAccess([role], path, 'GET', 'portal');

    res.json({ allowed: result.allowed });
  } catch (error) {
    logger.error('ACL check failed', { error: error.message, query: req.query });
    // On error, deny access (fail closed)
    res.json({ allowed: false });
  }
});

module.exports = router;
