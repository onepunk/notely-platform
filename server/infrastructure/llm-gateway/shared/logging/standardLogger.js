const winston = require('winston');
const path = require('path');

// Standard log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Standard colors for console output
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

/**
 * Creates a standardized logger for Notely services
 * @param {string} serviceName - Name of the service (e.g., 'api', 'docker-manager')
 * @param {object} options - Configuration options
 * @returns {winston.Logger} Configured winston logger
 */
function createStandardLogger(serviceName, options = {}) {
  const {
    logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
    logFormat = process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty'),
    enableFileLogging = process.env.ENABLE_FILE_LOGGING === 'true',
    logsDir = options.logsDir || path.join(__dirname, '../../logs')
  } = options;

  // Standard JSON format for production/structured logging
  const jsonFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.printf((info) => {
      const {
        timestamp,
        level,
        message,
        trace_id,
        request_id,
        user_id,
        error,
        stack,
        ...metadata
      } = info;

      const logEntry = {
        timestamp,
        level,
        service: serviceName,
        message,
        ...(trace_id && { trace_id }),
        ...(request_id && { request_id }),
        ...(user_id && { user_id }),
        ...(Object.keys(metadata).length > 0 && { metadata }),
        ...(error && { error: typeof error === 'object' ? error : { message: error } }),
        ...(stack && { stack })
      };

      return JSON.stringify(logEntry);
    })
  );

  // Pretty format for development
  const prettyFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize({ all: true }),
    winston.format.printf((info) => {
      const {
        timestamp,
        level,
        message,
        trace_id,
        request_id,
        user_id,
        error,
        stack,
        ...metadata
      } = info;

      let logMessage = `${timestamp} [${serviceName}] ${level}: ${message}`;

      // Add trace/request IDs if present
      if (trace_id || request_id) {
        const ids = [];
        if (trace_id) ids.push(`trace:${trace_id.slice(0, 8)}`);
        if (request_id) ids.push(`req:${request_id.slice(0, 8)}`);
        logMessage += ` [${ids.join(',')}]`;
      }

      // Add user ID if present
      if (user_id) {
        logMessage += ` [user:${user_id}]`;
      }

      // Add metadata if present
      if (Object.keys(metadata).length > 0) {
        try {
          logMessage += ` ${JSON.stringify(metadata, (key, value) => {
            // Handle circular references and complex objects
            if (value && typeof value === 'object') {
              if (value.constructor && (
                value.constructor.name === 'IncomingMessage' ||
                value.constructor.name === 'ServerResponse' ||
                value.constructor.name === 'Socket' ||
                value.constructor.name === 'ClientRequest' ||
                value.constructor.name === 'TLSSocket'
              )) {
                return `[${value.constructor.name}]`;
              }
            }
            return value;
          })}`;
        } catch (error) {
          logMessage += ` [metadata: ${Object.keys(metadata).join(', ')}]`;
        }
      }

      // Add error details if present
      if (error) {
        logMessage += `\n  Error: ${typeof error === 'object' ? JSON.stringify(error) : error}`;
      }

      // Add stack trace if present
      if (stack) {
        logMessage += `\n${stack}`;
      }

      return logMessage;
    })
  );

  // Configure transports
  const transports = [
    new winston.transports.Console({
      format: logFormat === 'json' ? jsonFormat : prettyFormat
    })
  ];

  // Add file transports if enabled
  if (enableFileLogging) {
    // Ensure logs directory exists
    const fs = require('fs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    transports.push(
      new winston.transports.File({
        filename: path.join(logsDir, `${serviceName}-error.log`),
        level: 'error',
        format: jsonFormat,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5
      }),
      new winston.transports.File({
        filename: path.join(logsDir, `${serviceName}.log`),
        format: jsonFormat,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5
      })
    );
  }

  const logger = winston.createLogger({
    level: logLevel,
    levels,
    transports,
    // Handle uncaught exceptions and rejections
    exceptionHandlers: enableFileLogging ? [
      new winston.transports.File({
        filename: path.join(logsDir, `${serviceName}-exceptions.log`),
        format: jsonFormat
      })
    ] : undefined,
    rejectionHandlers: enableFileLogging ? [
      new winston.transports.File({
        filename: path.join(logsDir, `${serviceName}-rejections.log`),
        format: jsonFormat
      })
    ] : undefined
  });

  // Add convenience methods for structured logging
  logger.withContext = function(context = {}) {
    return {
      error: (message, meta = {}) => logger.error(message, { ...context, ...meta }),
      warn: (message, meta = {}) => logger.warn(message, { ...context, ...meta }),
      info: (message, meta = {}) => logger.info(message, { ...context, ...meta }),
      http: (message, meta = {}) => logger.http(message, { ...context, ...meta }),
      debug: (message, meta = {}) => logger.debug(message, { ...context, ...meta })
    };
  };

  return logger;
}

module.exports = { createStandardLogger };