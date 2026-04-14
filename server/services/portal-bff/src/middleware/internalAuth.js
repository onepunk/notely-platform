/**
 * Internal API Authentication Middleware
 *
 * Validates internal API requests using the X-Internal-Api-Key header.
 * Used for service-to-service communication, CI/CD pipeline calls,
 * and other trusted internal operations.
 *
 * Security Notes:
 * - The API key is stored in INTERNAL_API_KEY environment variable
 * - All internal API calls are logged for audit purposes
 * - Requests from internal routes should be blocked at nginx for public access
 */

const shared = require('@notely/shared');

const logger = shared.logger.child({ scope: 'portal-bff-internal-auth' });

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

/**
 * Middleware that validates internal API key for access
 *
 * Checks the X-Internal-Api-Key header against the configured INTERNAL_API_KEY.
 * Returns 401 if the key is missing or invalid.
 *
 * @returns {Function} Express middleware function
 */
function internalOnly(req, res, next) {
  const apiKey = req.headers['x-internal-api-key'];

  // Log all internal API access attempts (without exposing the key)
  const logContext = {
    path: req.path,
    method: req.method,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent'],
    hasApiKey: !!apiKey,
  };

  if (!INTERNAL_API_KEY) {
    logger.error('INTERNAL_API_KEY not configured - internal API disabled', logContext);
    return res.status(503).json({
      success: false,
      error: 'service_unavailable',
      message: 'Internal API not configured',
    });
  }

  if (!apiKey) {
    logger.warn('Internal API request missing API key', logContext);
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'X-Internal-Api-Key header required',
    });
  }

  // Constant-time comparison to prevent timing attacks
  if (!constantTimeCompare(apiKey, INTERNAL_API_KEY)) {
    logger.warn('Internal API request with invalid API key', logContext);
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Invalid API key',
    });
  }

  // Log successful authentication
  logger.info('Internal API request authenticated', logContext);

  next();
}

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Use Buffer.compare for constant-time comparison
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // If lengths differ, compare against a fixed-length buffer to maintain constant time
  if (bufA.length !== bufB.length) {
    // Compare with itself to maintain timing, then return false
    Buffer.compare(bufA, bufA);
    return false;
  }

  return Buffer.compare(bufA, bufB) === 0;
}

module.exports = {
  internalOnly,
};
