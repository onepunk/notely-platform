const logger = require('../logger');

/**
 * Request Logging Middleware
 *
 * Logs all incoming requests and outgoing responses with:
 * - Request method, URL, headers
 * - Response status, duration
 * - User ID (if authenticated)
 * - Request correlation ID
 * - Slow request warnings
 */

module.exports = (req, res, next) => {
  // Log incoming request
  if (process.env.LOG_REQUESTS === 'true') {
    logger.info('Incoming request', {
      method: req.method,
      url: req.originalUrl || req.url,
      path: req.path,
      ip: req.ip,
      user_agent: req.get('User-Agent')
    });
  }

  // Capture original send method
  const originalSend = res.send;

  // Override send to log response
  res.send = function(data) {
    const duration = Date.now() - req.startTime;

    // Log response
    if (process.env.LOG_RESPONSES === 'true') {
      const logData = {
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        duration_ms: duration,
        user_id: req.user?.id,
        response_size_bytes: Buffer.byteLength(JSON.stringify(data), 'utf8')
      };

      // Log at appropriate level based on status
      if (res.statusCode >= 500) {
        logger.error('Request failed', logData);
      } else if (res.statusCode >= 400) {
        logger.warn('Request error', logData);
      } else {
        logger.info('Request completed', logData);
      }
    }

    // Log slow requests
    if (process.env.LOG_SLOW_REQUESTS === 'true') {
      const threshold = parseInt(process.env.LOG_SLOW_THRESHOLD_MS || '1000', 10);
      if (duration > threshold) {
        logger.warn('Slow request detected', {
          method: req.method,
          url: req.originalUrl || req.url,
          duration_ms: duration,
          threshold_ms: threshold,
          user_id: req.user?.id
        });
      }
    }

    // Add response time header
    res.setHeader('X-Response-Time', `${duration}ms`);

    // Call original send
    return originalSend.call(this, data);
  };

  next();
};
