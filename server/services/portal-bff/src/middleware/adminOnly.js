/**
 * Admin Authorization Middleware
 *
 * Enforces admin role requirement on protected routes.
 * This provides defense-in-depth authorization checking at the portal-bff layer,
 * complementing the gateway-level authentication.
 *
 * Security Note (HIGH-08 fix):
 * Previously, admin routes relied solely on the gateway to enforce role checks.
 * This middleware ensures that even if the gateway is bypassed or misconfigured,
 * admin routes are still protected.
 */

const shared = require('@notely/shared');
const { getUserContext } = require('../lib/userContext');

const { isAdmin } = shared.constants.roles;
const logger = shared.logger.child({ scope: 'portal-bff-admin-auth' });

/**
 * Middleware that requires admin role for access
 *
 * Extracts user context from request headers (set by gateway after JWT validation)
 * and verifies the user has admin role.
 *
 * @returns {Function} Express middleware function
 */
function adminOnly(req, res, next) {
  try {
    const context = getUserContext(req);

    if (!isAdmin(context.role)) {
      logger.warn('Non-admin user attempted to access admin route', {
        userId: context.userId,
        email: context.email,
        role: context.role,
        path: req.path,
        method: req.method,
      });

      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    // Attach context to request for use in route handlers
    req.userContext = context;
    next();
  } catch (error) {
    // getUserContext throws if authentication context is missing
    if (error.status === 401 || error.code === 'missing_auth_context') {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    logger.error('Error in adminOnly middleware', {
      error: error.message,
      path: req.path,
    });

    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Authorization check failed',
    });
  }
}

module.exports = {
  adminOnly,
};
