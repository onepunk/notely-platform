const logger = require('../logger');

/**
 * Centralized Error Handler Middleware
 *
 * Handles all errors consistently across the application:
 * - Database errors (PostgreSQL codes)
 * - JWT authentication errors
 * - Validation errors
 * - Rate limiting errors
 * - File upload errors
 * - Custom application errors
 *
 * Features:
 * - Structured error logging with request context
 * - Error code mapping
 * - Safe error responses (no stack trace leakage in production)
 * - Request correlation IDs in all errors
 */

/**
 * Error handler middleware
 *
 * @param {Error} err - Error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
const errorHandler = (err, req, res, next) => {
  // Log the error with full context
  logger.error('Error occurred', {
    error: err.message,
    stack: err.stack,
    code: err.code,
    status: err.status || err.statusCode,
    url: req.url,
    method: req.method,
    ip: req.ip,
    user_id: req.user?.id,
    user_agent: req.get('User-Agent'),
    request_id: req.requestId,
    timestamp: new Date().toISOString()
  });

  // Default error
  let error = { ...err };
  error.message = err.message;

  // ========================================================================
  // Database Errors (PostgreSQL)
  // ========================================================================

  // PostgreSQL duplicate key error
  if (err.code === '23505') {
    error.message = 'Duplicate entry. Resource already exists.';
    error.status = 409; // Conflict
  }

  // PostgreSQL foreign key constraint error
  if (err.code === '23503') {
    error.message = 'Referenced resource does not exist.';
    error.status = 400; // Bad Request
  }

  // PostgreSQL not null constraint error
  if (err.code === '23502') {
    error.message = 'Required field is missing.';
    error.status = 400; // Bad Request
  }

  // PostgreSQL check constraint error
  if (err.code === '23514') {
    error.message = 'Data validation failed.';
    error.status = 400; // Bad Request
  }

  // PostgreSQL unique constraint error
  if (err.code === '23505') {
    error.message = 'Value must be unique.';
    error.status = 409; // Conflict
  }

  // Database connection error
  if (err.code === 'ECONNREFUSED' || err.code === '57P01') {
    error.message = 'Database connection failed.';
    error.status = 503; // Service Unavailable
  }

  // ========================================================================
  // JWT Errors
  // ========================================================================

  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid authentication token.';
    error.status = 401; // Unauthorized
  }

  if (err.name === 'TokenExpiredError') {
    error.message = 'Authentication token expired.';
    error.status = 401; // Unauthorized
  }

  if (err.name === 'NotBeforeError') {
    error.message = 'Authentication token not yet valid.';
    error.status = 401; // Unauthorized
  }

  // ========================================================================
  // Validation Errors
  // ========================================================================

  // Joi validation error
  if (err.name === 'ValidationError' && err.isJoi) {
    error.message = err.details.map(d => d.message).join(', ');
    error.status = 400; // Bad Request
  }

  // Mongoose validation error (if using Mongoose)
  if (err.name === 'ValidationError' && !err.isJoi) {
    error.message = Object.values(err.errors || {}).map(val => val.message).join(', ');
    error.status = 400; // Bad Request
  }

  // Express validator error
  if (err.array && typeof err.array === 'function') {
    error.message = err.array().map(e => e.msg).join(', ');
    error.status = 400; // Bad Request
  }

  // ========================================================================
  // File Upload Errors (Multer)
  // ========================================================================

  if (err.code === 'LIMIT_FILE_SIZE') {
    error.message = 'File too large. Maximum size exceeded.';
    error.status = 400; // Bad Request
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    error.message = 'Too many files. Maximum count exceeded.';
    error.status = 400; // Bad Request
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error.message = 'Unexpected file field.';
    error.status = 400; // Bad Request
  }

  // ========================================================================
  // Rate Limiting Errors
  // ========================================================================

  if (err.status === 429 || err.statusCode === 429) {
    error.message = 'Too many requests. Please try again later.';
    error.status = 429; // Too Many Requests
  }

  // ========================================================================
  // HTTP Client Errors (Axios)
  // ========================================================================

  if (err.isAxiosError) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      error.message = 'External service request timed out.';
      error.status = 504; // Gateway Timeout
    } else if (err.response) {
      // External API returned an error
      error.message = `External service error: ${err.response.status}`;
      error.status = 502; // Bad Gateway
    } else {
      // Request failed to be sent
      error.message = 'Failed to connect to external service.';
      error.status = 503; // Service Unavailable
    }
  }

  // ========================================================================
  // Custom Application Errors
  // ========================================================================

  // License validation errors
  if (err.name === 'LicenseError') {
    error.message = err.message;
    error.status = 403; // Forbidden
  }

  // Storage errors
  if (err.name === 'StorageError') {
    error.message = 'Storage operation failed.';
    error.status = 500; // Internal Server Error
  }

  // Processing errors
  if (err.name === 'ProcessingError') {
    error.message = 'Processing operation failed.';
    error.status = 500; // Internal Server Error
  }

  // Authorization errors
  if (err.name === 'UnauthorizedError' || err.name === 'ForbiddenError') {
    error.message = err.message || 'Access denied.';
    error.status = err.name === 'UnauthorizedError' ? 401 : 403;
  }

  // Not found errors
  if (err.name === 'NotFoundError') {
    error.message = err.message || 'Resource not found.';
    error.status = 404; // Not Found
  }

  // ========================================================================
  // Build Response
  // ========================================================================

  const statusCode = error.status || err.statusCode || 500;
  const message = error.message || 'Internal Server Error';

  // Build error response
  const response = {
    success: false,
    error: message,
    request_id: req.requestId,
    timestamp: new Date().toISOString()
  };

  // Include stack trace in development only
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.details = {
      name: err.name,
      code: err.code
    };
  }

  // Send error response
  res.status(statusCode).json(response);
};

/**
 * Custom error classes for application-specific errors
 */

class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * Async route handler wrapper
 * Catches errors from async route handlers and passes to error middleware
 *
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  asyncHandler,
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError
};
