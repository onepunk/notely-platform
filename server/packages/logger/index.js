const winston = require('winston');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Async Local Storage for request context
 * Stores request ID for correlation across async calls
 */
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Custom format for adding request context to logs
 */
const requestContextFormat = winston.format((info) => {
  const store = asyncLocalStorage.getStore();
  if (store) {
    info.request_id = store.requestId;
    info.user_id = store.userId;
  }
  return info;
});

/**
 * Winston logger instance configured for structured logging
 *
 * Features:
 * - JSON formatted logs
 * - Request correlation IDs
 * - Timestamp in ISO format
 * - Error stack traces
 * - Environment-aware log levels
 * - Console output (Loki integration added in Phase 2)
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    requestContextFormat(),
    winston.format.json()
  ),
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'platform-v3-shared',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, request_id, user_id, ...meta }) => {
          let log = `${timestamp} [${level}]: ${message}`;

          // Add request ID if present
          if (request_id) {
            log += ` [req: ${request_id}]`;
          }

          // Add user ID if present
          if (user_id) {
            log += ` [user: ${user_id}]`;
          }

          // Add metadata if present
          if (Object.keys(meta).length > 0) {
            // Filter out service and environment from console output
            const { service, environment, ...restMeta } = meta;
            if (Object.keys(restMeta).length > 0) {
              log += ` ${JSON.stringify(restMeta)}`;
            }
          }

          return log;
        })
      )
    })
    // Loki transport will be added in Phase 2
  ]
});

/**
 * Store request context for correlation
 *
 * @param {string} requestId - Request correlation ID
 * @param {string} userId - User ID (optional)
 * @param {Function} callback - Function to execute with context
 * @returns {any} Result from callback
 */
function runWithContext(requestId, userId, callback) {
  return asyncLocalStorage.run({ requestId, userId }, callback);
}

/**
 * Get current request ID from context
 *
 * @returns {string|undefined} Request ID
 */
function getRequestId() {
  const store = asyncLocalStorage.getStore();
  return store?.requestId;
}

/**
 * Get current user ID from context
 *
 * @returns {string|undefined} User ID
 */
function getUserId() {
  const store = asyncLocalStorage.getStore();
  return store?.userId;
}

/**
 * Log with explicit request context (fallback if async context unavailable)
 *
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} meta - Metadata
 * @param {string} meta.request_id - Request ID
 * @param {string} meta.user_id - User ID
 */
function logWithContext(level, message, meta = {}) {
  logger.log(level, message, meta);
}

/**
 * Create a child logger with additional default metadata
 *
 * @param {Object} meta - Additional metadata
 * @returns {Logger} Child logger instance
 */
function child(meta) {
  return logger.child(meta);
}

// Export logger with context utilities
module.exports = {
  // Winston logger instance
  logger,

  // Context management
  runWithContext,
  getRequestId,
  getUserId,

  // Convenience methods
  logWithContext,
  child,

  // Standard log methods (proxied for convenience)
  error: (message, meta) => logger.error(message, meta),
  warn: (message, meta) => logger.warn(message, meta),
  info: (message, meta) => logger.info(message, meta),
  http: (message, meta) => logger.http(message, meta),
  debug: (message, meta) => logger.debug(message, meta),

  // Async local storage (for advanced use cases)
  asyncLocalStorage
};
