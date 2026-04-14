const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

/**
 * Request ID Middleware
 *
 * Generates or extracts request correlation ID for tracking
 * requests across services and log entries.
 *
 * Features:
 * - Generates UUID v4 if not provided
 * - Extracts from X-Request-ID header if present
 * - Sets X-Request-ID response header
 * - Stores in request context for logging
 * - Tracks request start time for duration measurement
 */

module.exports = (req, res, next) => {
  // Extract or generate request ID
  req.requestId = req.header('X-Request-ID') || uuidv4();

  // Set response header
  res.setHeader('X-Request-ID', req.requestId);

  // Record request start time
  req.startTime = Date.now();

  // Run subsequent middleware with request context
  logger.runWithContext(req.requestId, req.user?.id, () => {
    next();
  });
};
