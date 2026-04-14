const express = require('express');
const shared = require('@notely/shared');
const desktopAuthService = require('../services/desktopAuthService');

const router = express.Router();
const logger = shared.logger;

/**
 * Desktop OAuth login page (PKCE entry point)
 */
router.get('/login', async (req, res, next) => {
  try {
    const result = await desktopAuthService.prepareLoginPage(req.query, {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (result.headers) {
      Object.entries(result.headers).forEach(([header, value]) => {
        res.set(header, value);
      });
    }

    if (result.type === 'html') {
      return res.status(result.status).type('html').send(result.content);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Desktop OAuth login handler failed', {
      error: error.message,
      stack: error.stack,
      query: req.query
    });
    return next(error);
  }
});

/**
 * Desktop OAuth authorize – kicks off Microsoft OAuth.
 * Placeholder response until Microsoft integration is wired up.
 */
router.post('/authorize', async (req, res, next) => {
  try {
    const result = await desktopAuthService.handleAuthorizeRequest(req.body || {}, {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Desktop OAuth authorize handler failed', {
      error: error.message,
      stack: error.stack
    });
    return next(error);
  }
});

/**
 * Exchange authorization code + PKCE verifier for desktop tokens.
 */
router.post('/token', async (req, res, next) => {
  try {
    const result = await desktopAuthService.exchangeAuthorizationCode(req.body || {}, {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Desktop OAuth token handler failed', {
      error: error.message,
      stack: error.stack
    });
    return next(error);
  }
});

/**
 * Rotate desktop refresh token.
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const result = await desktopAuthService.refreshDesktopSession(req.body || {}, {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Desktop OAuth refresh handler failed', {
      error: error.message,
      stack: error.stack
    });
    return next(error);
  }
});

/**
 * Logout desktop session and revoke refresh token.
 */
router.post('/logout', async (req, res, next) => {
  try {
    const result = await desktopAuthService.logoutDesktopSession(req.body || {}, {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Desktop OAuth logout handler failed', {
      error: error.message,
      stack: error.stack
    });
    return next(error);
  }
});

/**
 * Validate desktop session (for settings / diagnostics screens).
 */
router.post('/validate-session', async (req, res, next) => {
  try {
    const result = await desktopAuthService.validateDesktopSession(req.body || {}, {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Desktop OAuth validate handler failed', {
      error: error.message,
      stack: error.stack
    });
    return next(error);
  }
});

module.exports = router;
