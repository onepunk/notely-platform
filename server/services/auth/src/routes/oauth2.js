/**
 * OAuth2 Routes
 *
 * Direct OAuth2 + JWT authentication flow without OIDC provider.
 * Supports both portal (web) and desktop clients.
 */

const express = require('express');
const router = express.Router();
const shared = require('@notely/shared');
const logger = shared.logger;

const pkce = require('../utils/pkce');
const oauth = require('../utils/oauth');
const jwtOAuth = require('../utils/jwtOAuth');
const microsoftProvider = require('../oidc/microsoftProvider');
const microsoftAccountService = require('../oidc/microsoftAccountService');
const authModel = require('../models/authModel');
const eventPublisher = require('../services/eventPublisher');
const cookieUtils = require('../utils/cookieOptions');

// Redis client (injected by parent app)
let redisClient;

function setRedis(redis) {
  redisClient = redis;
}

/**
 * GET /api/auth/microsoft/login
 * Initiates Microsoft OAuth flow with PKCE
 *
 * Query params:
 *   - return_to: Where to redirect after successful login (optional, default: /dashboard)
 *   - client_type: 'portal' or 'desktop' (optional, default: 'portal')
 *   - desktop_session_id: Required if client_type=desktop
 */
router.get('/microsoft/login', async (req, res, next) => {
  try {
    const returnTo = req.query.return_to || '/dashboard';
    const clientType = req.query.client_type || 'portal';
    const desktopSessionId = req.query.desktop_session_id;
    const betaToken = req.query.beta_token || null;

    // Validate client type
    if (!['portal', 'desktop'].includes(clientType)) {
      return res.status(400).json({
        error: 'Invalid client_type',
        message: 'client_type must be either "portal" or "desktop"'
      });
    }

    // Desktop requires desktop_session_id
    if (clientType === 'desktop' && !desktopSessionId) {
      return res.status(400).json({
        error: 'Missing desktop_session_id',
        message: 'desktop_session_id is required for desktop authentication'
      });
    }

    // Validate return_to to prevent open redirect
    let validatedReturnTo;
    try {
      validatedReturnTo = oauth.validateReturnTo(returnTo, clientType);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid return_to',
        message: error.message
      });
    }

    // Generate PKCE pair
    const { codeVerifier, codeChallenge, codeChallengeMethod } = pkce.generatePKCEPair();

    // Generate state parameter
    const state = oauth.generateState();

    // Store state + PKCE in Redis (10 min TTL)
    await oauth.storeOAuthState(
      redisClient,
      state,
      {
        codeVerifier,
        clientType,
        returnTo: validatedReturnTo,
        desktopSessionId: desktopSessionId || null,
        betaToken // Pass beta token through OAuth flow
      },
      600 // 10 minutes
    );

    // Build Microsoft OAuth URL
    const authorizeUrl = microsoftProvider.buildAuthorizeUrl({
      state,
      codeChallenge,
      codeChallengeMethod,
      scope: microsoftProvider.DEFAULT_SCOPE,
      prompt: 'select_account' // Allow user to choose account
    });

    logger.info('OAuth flow initiated', {
      clientType,
      state: state.substring(0, 10) + '...',
      returnTo: validatedReturnTo,
      hasBetaToken: !!betaToken
    });

    // Redirect to Microsoft
    res.redirect(authorizeUrl);
  } catch (error) {
    logger.error('Microsoft login error', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/auth/microsoft/callback
 * Handles Microsoft OAuth callback
 *
 * Query params:
 *   - code: Authorization code from Microsoft
 *   - state: State parameter for CSRF protection
 *   - error: Error code (if OAuth failed)
 *   - error_description: Error description (if OAuth failed)
 */
router.get('/microsoft/callback', async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Handle Microsoft OAuth errors
    if (error) {
      logger.warn('Microsoft OAuth error', { error, error_description });
      return res.status(400).json({
        error: 'OAuth failed',
        message: error_description || error,
        code: error
      });
    }

    // Validate required params
    if (!code || !state) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'Both code and state are required'
      });
    }

    // Retrieve and consume state from Redis (one-time use)
    const storedState = await oauth.consumeOAuthState(redisClient, state);

    if (!storedState) {
      return res.status(400).json({
        error: 'Invalid or expired state',
        message: 'OAuth session expired or state parameter is invalid. Please try logging in again.'
      });
    }

    const { codeVerifier, clientType, returnTo, desktopSessionId, betaToken } = storedState;

    // Exchange authorization code for tokens (with Microsoft)
    let microsoftTokens;
    try {
      microsoftTokens = await microsoftProvider.exchangeCodeForTokens({
        code,
        codeVerifier
      });
    } catch (error) {
      logger.error('Microsoft token exchange failed', { error: error.message });
      return res.status(500).json({
        error: 'Token exchange failed',
        message: 'Failed to exchange authorization code with Microsoft. Please try again.'
      });
    }

    // Fetch user profile from Microsoft Graph
    let profile;
    try {
      profile = await microsoftProvider.fetchUserProfile(microsoftTokens.access_token);
    } catch (error) {
      logger.error('Failed to fetch Microsoft profile', { error: error.message });
      return res.status(500).json({
        error: 'Profile fetch failed',
        message: 'Failed to retrieve user profile from Microsoft. Please try again.'
      });
    }

    // Create or update user in our database
    let user;
    try {
      user = await microsoftAccountService.ensureMicrosoftAccount({
        profile,
        tokens: microsoftTokens,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        betaToken // Pass beta token for beta invite flow
      });
    } catch (error) {
      // Check if this is a signup restriction error
      const isSignupDisabled = error.name === 'ForbiddenError' ||
        error.message?.includes('Sign-ups are currently disabled');

      if (isSignupDisabled) {
        logger.info('OAuth login blocked - signups disabled', {
          email: profile?.mail || profile?.userPrincipalName,
          clientType
        });

        // For portal clients, redirect with error message
        if (clientType === 'portal') {
          const portalUrl = process.env.PORTAL_URL;
          const portalDomain = process.env.PORTAL_DOMAIN;
          const isLocalhost = portalDomain?.includes('localhost') || portalDomain?.includes('127.0.0.1');
          const protocol = isLocalhost ? 'http' : 'https';

          const baseUrl = portalUrl || `${protocol}://${portalDomain}`;
          const errorUrl = new URL('/login', baseUrl);
          errorUrl.searchParams.set('error', 'signups_disabled');
          errorUrl.searchParams.set('error_description', 'Sign-ups are currently disabled. If you already have an account, please contact support.');

          return res.redirect(errorUrl.toString());
        }

        // For desktop clients, return JSON error
        return res.status(403).json({
          error: 'Signups disabled',
          code: 'SIGNUPS_DISABLED',
          message: 'Sign-ups are currently disabled. If you already have an account, please contact support.'
        });
      }

      logger.error('Failed to provision user', { error: error.message });
      return res.status(500).json({
        error: 'User provisioning failed',
        message: error.message || 'Failed to create user account. Please contact support.'
      });
    }

    // Generate our JWT tokens
    const { token: accessToken, expiresAt: accessExpiresAt } = jwtOAuth.generateAccessToken(user);
    const { token: refreshToken, expiresAt: refreshExpiresAt } = jwtOAuth.generateRefreshToken(user);

    try {
      await authModel.createSession(user.id, accessToken, new Date(accessExpiresAt));
    } catch (error) {
      logger.warn('Failed to persist OAuth session token', {
        error: error.message,
        userId: user.id
      });
    }

    // Store refresh token in Redis with user mapping
    await oauth.storeRefreshToken(redisClient, refreshToken, user.id, 7 * 24 * 60 * 60);

    // Publish login success event
    try {
      await eventPublisher.publishLoginSuccess({
        userId: user.id,
        email: user.email,
        sessionToken: accessToken,
        provider: 'microsoft',
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
    } catch (error) {
      logger.warn('Failed to publish login success event', { error: error.message });
    }

    logger.info('OAuth login successful', {
      userId: user.id,
      email: user.email,
      clientType
    });

    // Branch on client type
    if (clientType === 'portal') {
      // Redirect to portal (no tokens in URL)
      // Use PORTAL_URL from .env which includes protocol and port (configured via configure-domains.sh)
      // Falls back to constructing from PORTAL_DOMAIN for backwards compatibility
      const portalDomain = process.env.PORTAL_DOMAIN;
      const portalUrl = process.env.PORTAL_URL;

      if (!portalDomain && !portalUrl) {
        logger.error('Neither PORTAL_URL nor PORTAL_DOMAIN configured in environment');
        return res.status(500).json({
          error: 'Configuration error',
          message: 'Portal domain not configured. Please contact support.'
        });
      }

      // Determine protocol: use HTTPS for all domains except localhost/127.0.0.1
      const isLocalhost = portalDomain?.includes('localhost') || portalDomain?.includes('127.0.0.1');
      const protocol = isLocalhost ? 'http' : 'https';
      const useSecureCookies = cookieUtils.inferSecureCookieFlag(req, cookieUtils.shouldDefaultSecureCookies());

      const baseCookieOptions = cookieUtils.buildPortalCookieOptions({
        secure: useSecureCookies,
        portalDomain,
        apiDomain: process.env.API_DOMAIN
      });

      // PORTAL: Set HTTP-only cookies with security matching the protocol
      res.cookie('access_token', accessToken, {
        ...baseCookieOptions,
        maxAge: 15 * 60 * 1000 // 15 minutes
      });

      res.cookie('refresh_token', refreshToken, {
        ...baseCookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      // Use PORTAL_URL (includes port) if available, otherwise construct from PORTAL_DOMAIN
      const redirectUrl = portalUrl
        ? `${portalUrl}${returnTo}`
        : `${protocol}://${portalDomain}${returnTo}`;

      const logDetails = {
        redirectUrl,
        secure: useSecureCookies
      };

      if (baseCookieOptions.domain) {
        logDetails.cookieDomain = baseCookieOptions.domain;
      }

      logger.info('Redirecting to portal', logDetails);
      return res.redirect(redirectUrl);
    } else if (clientType === 'desktop') {
      // DESKTOP: Generate exchange code and redirect to notely:// URL
      const exchangeCode = oauth.generateExchangeCode();

      // Store exchange code in Redis (60s TTL)
      await oauth.storeExchangeCode(
        redisClient,
        exchangeCode,
        {
          userId: user.id,
          accessToken,
          refreshToken,
          accessExpiresAt,
          refreshExpiresAt,
          desktopSessionId
        },
        60 // 60 seconds
      );

      // Build notely:// deep link (no tokens in URL, only exchange code)
      const deepLinkUrl = new URL('notely://auth/callback');
      deepLinkUrl.searchParams.set('code', exchangeCode);
      deepLinkUrl.searchParams.set('desktop_session_id', desktopSessionId);
      deepLinkUrl.searchParams.set('state', state);

      logger.info('Redirecting to desktop', {
        userId: user.id,
        desktopSessionId,
        state: typeof state === 'string' ? `${state.substring(0, 8)}...` : null
      });

      return res.redirect(deepLinkUrl.toString());
    } else {
      return res.status(400).json({
        error: 'Invalid client_type',
        message: 'Unknown client type'
      });
    }
  } catch (error) {
    logger.error('Microsoft callback error', { error: error.message, stack: error.stack });
    next(error);
  }
});

/**
 * POST /api/auth/desktop/exchange
 * Exchanges one-time code for tokens (desktop only)
 *
 * Body:
 *   - code: Exchange code from deep link
 *   - desktop_session_id: Desktop session identifier
 */
router.post('/desktop/exchange', async (req, res, next) => {
  try {
    const { code, desktop_session_id } = req.body;

    if (!code || !desktop_session_id) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'Both code and desktop_session_id are required'
      });
    }

    // Retrieve and consume exchange code (one-time use)
    const exchangeData = await oauth.consumeExchangeCode(redisClient, code);

    if (!exchangeData) {
      return res.status(400).json({
        error: 'Invalid or expired code',
        message: 'Exchange code is invalid or has expired (60s TTL). Please try logging in again.'
      });
    }

    // Validate desktop_session_id matches
    if (exchangeData.desktopSessionId !== desktop_session_id) {
      logger.warn('Desktop session ID mismatch', {
        expected: exchangeData.desktopSessionId,
        received: desktop_session_id
      });
      return res.status(400).json({
        error: 'Session mismatch',
        message: 'Desktop session ID does not match. Please try logging in again.'
      });
    }

    logger.info('Desktop exchange successful', {
      userId: exchangeData.userId,
      desktopSessionId: desktop_session_id
    });

    // Return tokens in response body over HTTPS
    res.json({
      access_token: exchangeData.accessToken,
      refresh_token: exchangeData.refreshToken,
      token_type: 'Bearer',
      expires_in: 15 * 60, // 15 minutes
      access_expires_at: exchangeData.accessExpiresAt,
      refresh_expires_at: exchangeData.refreshExpiresAt
    });
  } catch (error) {
    logger.error('Desktop exchange error', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/auth/session
 * Returns current user session (portal only)
 * Reads HTTP-only cookies server-side
 */
router.get('/session', async (req, res, next) => {
  try {
    const accessToken = req.cookies.access_token;

    if (!accessToken) {
      return res.status(401).json({
        error: 'Not authenticated',
        message: 'No access token found in cookies'
      });
    }

    // Check if token is blacklisted
    const isBlacklisted = await oauth.isTokenBlacklisted(redisClient, accessToken);
    if (isBlacklisted) {
      return res.status(401).json({
        error: 'Token revoked',
        message: 'Access token has been revoked'
      });
    }

    // Verify and decode token
    let payload;
    try {
      payload = jwtOAuth.verifyToken(accessToken);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expired',
          message: 'Access token has expired. Please refresh.'
        });
      }

      return res.status(401).json({
        error: 'Invalid token',
        message: 'Access token is invalid'
      });
    }

    // Return user data (without exposing token)
    res.json({
      user: {
        id: payload.userId,
        email: payload.email,
        role: payload.role,
        firstName: payload.firstName,
        lastName: payload.lastName,
        scopes: payload.scopes
      },
      expiresAt: new Date(payload.exp * 1000).toISOString()
    });
  } catch (error) {
    logger.error('Session retrieval error', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/auth/refresh
 * Refreshes access token using refresh token
 * Implements automatic token rotation with replay detection
 */
router.post('/refresh', async (req, res, next) => {
  try {
    // Get refresh token from cookie (portal) or body (desktop)
    const refreshToken = req.cookies.refresh_token || req.body.refresh_token;

    if (!refreshToken) {
      return res.status(401).json({
        error: 'Missing refresh token',
        message: 'No refresh token provided'
      });
    }

    // Verify refresh token
    let payload;
    try {
      payload = jwtOAuth.verifyToken(refreshToken);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Refresh token expired',
          message: 'Refresh token has expired. Please log in again.'
        });
      }

      return res.status(401).json({
        error: 'Invalid refresh token',
        message: 'Refresh token is invalid'
      });
    }

    // Check if token type is 'refresh'
    if (payload.tokenType !== 'refresh') {
      return res.status(401).json({
        error: 'Invalid token type',
        message: 'Token is not a refresh token'
      });
    }

    // Block refresh attempts for accounts that have been globally revoked
    const sessionsRevoked = await oauth.isUserSessionsRevoked(redisClient, payload.userId);

    if (sessionsRevoked) {
      logger.warn('Refresh attempt blocked for revoked user', {
        userId: payload.userId,
        email: payload.email
      });

      await oauth.markRefreshTokenUsed(redisClient, refreshToken);

      return res.status(401).json({
        error: 'Session revoked',
        message: 'All sessions for this account have been revoked. Please sign in again.'
      });
    }

    // CRITICAL: Check if token has been used before (replay detection)
    const alreadyUsed = await oauth.isRefreshTokenUsed(redisClient, refreshToken);

    if (alreadyUsed) {
      // SECURITY BREACH: Refresh token reused
      logger.security('Refresh token replay detected', {
        userId: payload.userId,
        email: payload.email
      });

      // Revoke ALL tokens for this user immediately
      await oauth.revokeAllUserSessions(redisClient, payload.userId);

      return res.status(401).json({
        error: 'Token reuse detected',
        message: 'Security breach: Refresh token was reused. All sessions have been revoked. Please log in again.'
      });
    }

    // Mark old token as used (TTL = 7 days)
    await oauth.markRefreshTokenUsed(redisClient, refreshToken, 7 * 24 * 60 * 60);

    // Generate NEW tokens (rotation)
    const user = {
      id: payload.userId,
      email: payload.email,
      role: payload.role || 'user'
    };

    const { token: newAccessToken, expiresAt: newAccessExpiresAt } = jwtOAuth.generateAccessToken(user);
    const { token: newRefreshToken, expiresAt: newRefreshExpiresAt } = jwtOAuth.generateRefreshToken(user);

    // Store new refresh token in Redis with user mapping
    await oauth.storeRefreshToken(redisClient, newRefreshToken, user.id, 7 * 24 * 60 * 60);

    // Store rotation mapping (audit trail)
    await oauth.storeTokenRotation(redisClient, refreshToken, newRefreshToken, 7 * 24 * 60 * 60);

    // Persist new access token session in database (required for gateway introspection)
    try {
      await authModel.createSession(user.id, newAccessToken, new Date(newAccessExpiresAt));
    } catch (error) {
      logger.warn('Failed to persist refreshed access token session', {
        error: error.message,
        userId: user.id
      });
    }

    logger.info('Token refreshed successfully', {
      userId: payload.userId,
      email: payload.email
    });

    // Determine response format based on client type
    const clientType = req.body.client_type || (req.cookies.refresh_token ? 'portal' : 'desktop');

    if (clientType === 'portal') {
      // Determine if we should use secure cookies based on the request protocol
      const useSecureCookies = cookieUtils.inferSecureCookieFlag(req, cookieUtils.shouldDefaultSecureCookies());
      const cookieOptions = cookieUtils.buildPortalCookieOptions({ secure: useSecureCookies });

      // Portal: Set new cookies with security matching the request protocol
      res.cookie('access_token', newAccessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000
      });

      res.cookie('refresh_token', newRefreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.json({
        success: true,
        expires_at: newAccessExpiresAt
      });
    } else {
      // Desktop: Return tokens in body
      res.json({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        token_type: 'Bearer',
        expires_in: 15 * 60,
        access_expires_at: newAccessExpiresAt,
        refresh_expires_at: newRefreshExpiresAt
      });
    }
  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    next(error);
  }
});

module.exports = router;
module.exports.setRedis = setRedis;
