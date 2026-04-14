/**
 * Winston Logger Configuration
 *
 * Provides structured logging with:
 * - JSON format for production
 * - Pretty format for development
 * - Multiple log levels (error, warn, info, debug)
 * - Correlation ID support for request tracking
 * - Console transport for development
 * - File transports for production
 */

import winston from 'winston';
import path from 'path';

const { combine, timestamp, printf, json, colorize, errors } = winston.format;

// Determine log level from environment, default to 'info'
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';
const SERVICE_NAME = 'license-service';

// Define custom format for development (pretty print)
const developmentFormat = printf(({ level, message, timestamp, service, correlationId, ...metadata }) => {
  let log = `${timestamp} [${service}] ${level}: ${message}`;

  if (correlationId) {
    log += ` [correlationId: ${correlationId}]`;
  }

  // Add metadata if present
  if (Object.keys(metadata).length > 0) {
    log += `\n${JSON.stringify(metadata, null, 2)}`;
  }

  return log;
});

// Define format for production (JSON)
const productionFormat = combine(
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  json()
);

// Define format for development (pretty print with colors)
const devFormat = combine(
  errors({ stack: true }),
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  developmentFormat
);

// Create logs directory path
const logsDir = path.join(process.cwd(), 'logs');

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: {
    service: SERVICE_NAME,
  },
  format: NODE_ENV === 'production' ? productionFormat : devFormat,
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      format: NODE_ENV === 'production' ? productionFormat : devFormat,
    }),
  ],
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Add file transports in production
if (NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: productionFormat,
    })
  );

  logger.add(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: productionFormat,
    })
  );
}

/**
 * Create a child logger with correlation ID
 *
 * @param correlationId - Unique identifier for request tracking
 * @returns Child logger instance with correlation ID in metadata
 *
 * @example
 * ```typescript
 * const requestLogger = createRequestLogger(req.id);
 * requestLogger.info('Processing license validation');
 * ```
 */
export function createRequestLogger(correlationId: string): winston.Logger {
  return logger.child({ correlationId });
}

/**
 * Log levels:
 * - error: Error conditions that need immediate attention
 * - warn: Warning conditions that should be reviewed
 * - info: Informational messages about normal operations
 * - debug: Detailed debug information for troubleshooting
 *
 * @example
 * ```typescript
 * import { logger } from './utils/logger';
 *
 * logger.info('Service started', { port: 3000 });
 * logger.error('Failed to connect to database', { error: err.message });
 * logger.debug('Request payload', { payload: req.body });
 * ```
 */
export { logger };
export default logger;
