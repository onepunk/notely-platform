const { v4: uuidv4 } = require('uuid');

/**
 * Request tracing middleware for Express.js applications
 * Generates and manages trace_id and request_id for correlation across services
 */
function requestTracingMiddleware(options = {}) {
  const {
    traceIdHeader = 'x-trace-id',
    requestIdHeader = 'x-request-id',
    generateTraceId = true,
    generateRequestId = true,
    addToResponse = true
  } = options;

  return (req, res, next) => {
    // Generate or extract trace ID (for distributed tracing across services)
    let traceId = req.headers[traceIdHeader.toLowerCase()];
    if (!traceId && generateTraceId) {
      traceId = uuidv4();
    }

    // Always generate a new request ID for this specific request
    const requestId = generateRequestId ? uuidv4() : null;

    // Store in request object for use throughout the request lifecycle
    if (traceId) {
      req.traceId = traceId;
      req.trace_id = traceId; // For consistency with log format
    }
    if (requestId) {
      req.requestId = requestId;
      req.request_id = requestId; // For consistency with log format
    }

    // Add to response headers if enabled
    if (addToResponse) {
      if (traceId) res.setHeader(traceIdHeader, traceId);
      if (requestId) res.setHeader(requestIdHeader, requestId);
    }

    // Add helper method to get logging context
    req.getLoggingContext = () => {
      const context = {};
      if (traceId) context.trace_id = traceId;
      if (requestId) context.request_id = requestId;

      // Add user ID if available (from auth middleware)
      if (req.user?.id) context.user_id = req.user.id;
      if (req.user?.email) context.user_email = req.user.email;

      return context;
    };

    next();
  };
}

/**
 * Helper function to create HTTP client with tracing headers
 * Use this when making requests to other services to propagate trace ID
 */
function addTracingHeaders(req, headers = {}) {
  const tracingHeaders = { ...headers };

  if (req.traceId) {
    tracingHeaders['x-trace-id'] = req.traceId;
  }

  // Don't propagate request ID - each service should generate its own
  // But we can add the parent request ID for reference
  if (req.requestId) {
    tracingHeaders['x-parent-request-id'] = req.requestId;
  }

  return tracingHeaders;
}

/**
 * Express error handler that includes tracing information
 */
function tracingErrorHandler(logger) {
  return (err, req, res, next) => {
    const context = req.getLoggingContext ? req.getLoggingContext() : {};

    logger.error('Request error', {
      ...context,
      error: {
        message: err.message,
        stack: err.stack,
        name: err.name
      },
      request: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    // Don't expose internal errors in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    const statusCode = err.statusCode || err.status || 500;

    res.status(statusCode).json({
      success: false,
      error: isDevelopment ? err.message : 'Internal server error',
      ...(req.traceId && { trace_id: req.traceId }),
      ...(req.requestId && { request_id: req.requestId }),
      ...(isDevelopment && err.stack && { stack: err.stack })
    });
  };
}

module.exports = {
  requestTracingMiddleware,
  addTracingHeaders,
  tracingErrorHandler
};