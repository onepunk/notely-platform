/**
 * Auth Middleware
 *
 * Validates JWT token on protected routes.
 */

const jwt = require('jsonwebtoken');
const shared = require('@notely/shared');
const logger = shared.logger;
const authModel = require('../models/authModel');
const keyManager = require('../utils/keyManager');

/**
 * Middleware to validate JWT token
 * Attaches userId, userEmail, userRole to req object
 */
async function authMiddleware(req, res, next) {
  try {
    // Prefer Authorization header, but support HTTP-only cookies for browser flows
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.access_token || req.cookies?.notely_token;

    let token = null;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '');
    } else if (cookieToken) {
      token = cookieToken;
    }

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization token'
      });
    }

    // Verify JWT
    let decoded;
    try {
      const { publicKeyPem, algorithm } = keyManager.getVerificationKey();
      decoded = jwt.verify(token, publicKeyPem, { algorithms: [algorithm] });
    } catch (error) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token'
      });
    }

    if (decoded.tokenType && decoded.tokenType !== 'user') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Unsupported token type'
      });
    }

    // Check if session exists in database
    const session = await authModel.getSession(token);

    if (!session) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Session not found'
      });
    }

    // Check if session expired
    if (new Date(session.expires_at) < new Date()) {
      await authModel.deleteSession(token);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Session expired'
      });
    }

    // Attach user info to request
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    req.userScopes = decoded.scopes || [];

    next();
  } catch (error) {
    logger.error('Auth middleware error', { error: error.message });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication check failed'
    });
  }
}

module.exports = authMiddleware;
