/**
 * Authentication middleware for Calendar service
 * Verifies JWT tokens via the auth service or gateway-injected headers
 */

const shared = require('@notely/shared');
const logger = shared.logger;

/**
 * Extract user info from gateway-injected headers or validate token directly
 */
async function authMiddleware(req, res, next) {
  try {
    // First, check for gateway-injected auth headers (preferred path)
    const authSubject = req.headers['x-auth-subject'];
    const authEmail = req.headers['x-auth-email'];
    const authRole = req.headers['x-auth-role'];
    const authScopes = req.headers['x-auth-scopes'];

    if (authSubject) {
      // Gateway has already validated the token
      req.userId = authSubject;
      req.userEmail = authEmail;
      req.userRole = authRole;
      req.userScopes = authScopes ? authScopes.split(',') : [];

      logger.debug('Auth from gateway headers', {
        userId: req.userId,
        email: req.userEmail,
      });

      return next();
    }

    // Fallback: Extract token from Authorization header or cookie
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.access_token;

    let token = null;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '');
    } else if (cookieToken) {
      token = cookieToken;
    }

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization token',
      });
    }

    // Validate token via auth service
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://auth:3201';
    const response = await fetch(`${authServiceUrl}/internal/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.warn('Token validation failed', {
        status: response.status,
        error: errorData.message,
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: errorData.message || 'Invalid or expired token',
      });
    }

    const decoded = await response.json();

    req.userId = decoded.userId || decoded.sub;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    req.userScopes = decoded.scopes || [];

    logger.debug('Auth from token validation', {
      userId: req.userId,
      email: req.userEmail,
    });

    next();
  } catch (error) {
    logger.error('Auth middleware error', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication check failed',
    });
  }
}

module.exports = authMiddleware;
