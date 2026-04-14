/**
 * Structured Logger for Portal (Server-Side)
 * Provides consistent JSON logging for server-side operations (getServerSideProps, API routes)
 * Uses console.log with JSON formatting - no external dependencies needed
 */

const isProduction = process.env.NODE_ENV === 'production';
const logFormat = process.env.LOG_FORMAT || (isProduction ? 'json' : 'pretty');

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function formatLog(level: LogLevel, message: string, meta?: Record<string, any>) {
  if (logFormat === 'json') {
    // JSON format for production/Loki
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'portal',
      message,
      ...(meta && Object.keys(meta).length > 0 && { metadata: meta }),
    };
    return JSON.stringify(logEntry);
  } else {
    // Pretty format for development
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${new Date().toISOString()}] [portal] ${level.toUpperCase()}: ${message}${metaStr}`;
  }
}

const logger = {
  debug: (message: string, meta?: Record<string, any>) => {
    console.debug(formatLog('debug', message, meta));
  },

  info: (message: string, meta?: Record<string, any>) => {
    console.log(formatLog('info', message, meta));
  },

  warn: (message: string, meta?: Record<string, any>) => {
    console.warn(formatLog('warn', message, meta));
  },

  error: (message: string, meta?: Record<string, any>) => {
    console.error(formatLog('error', message, meta));
  },

  withContext: (context: Record<string, any> = {}) => ({
    debug: (message: string, meta?: Record<string, any>) =>
      logger.debug(message, { ...context, ...meta }),
    info: (message: string, meta?: Record<string, any>) =>
      logger.info(message, { ...context, ...meta }),
    warn: (message: string, meta?: Record<string, any>) =>
      logger.warn(message, { ...context, ...meta }),
    error: (message: string, meta?: Record<string, any>) =>
      logger.error(message, { ...context, ...meta }),
  }),
};

export default logger;
