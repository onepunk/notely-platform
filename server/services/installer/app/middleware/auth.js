/**
 * Authentication Middleware
 *
 * Verifies session tokens for authenticated API requests.
 * Sessions are created after successful setup token verification.
 */

/**
 * Creates middleware that validates session authentication
 * @param {Express.Application} app - Express app with activeSessions stored in locals
 * @returns {Function} Express middleware function
 */
export function setupTokenAuth(app) {
  return (req, res, next) => {
    // Skip auth for certain paths
    const publicPaths = ['/api/health', '/api/auth/verify'];
    if (publicPaths.some((p) => req.path.startsWith(p))) {
      return next();
    }

    // Check for session ID in header or query
    const sessionId =
      req.headers['x-session-id'] ||
      req.headers['authorization']?.replace('Bearer ', '') ||
      req.query.sessionId;

    if (!sessionId) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid session ID',
      });
    }

    // Verify session exists
    const activeSessions = app.locals.activeSessions || new Set();
    if (!activeSessions.has(sessionId)) {
      return res.status(401).json({
        error: 'Invalid session',
        message: 'Session expired or invalid. Please re-authenticate.',
      });
    }

    // Add session info to request
    req.sessionId = sessionId;
    next();
  };
}

/**
 * Invalidates a session (for logout or completion)
 * @param {Express.Application} app - Express app with activeSessions
 * @param {string} sessionId - Session ID to invalidate
 */
export function invalidateSession(app, sessionId) {
  const activeSessions = app.locals.activeSessions || new Set();
  activeSessions.delete(sessionId);
}

export default { setupTokenAuth, invalidateSession };
