/**
 * Error handler middleware
 *
 * Provides consistent error handling across all API endpoints.
 * Catches all errors, logs them, and returns standardized error responses.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { createErrorResponse } from '../api/schemas/licenseSchemas';

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error handler middleware
 *
 * Catches all errors thrown in the application and formats them
 * into consistent JSON responses per the Phase 04 specification.
 *
 * @param err - Error object
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  // Log the error
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
  });

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map((error) => ({
      field: error.path.join('.'),
      message: error.message,
    }));

    res.status(400).json(
      createErrorResponse(
        'VALIDATION_ERROR',
        'Request validation failed',
        details
      )
    );
    return;
  }

  // Handle custom AppError instances
  if (err instanceof AppError) {
    res.status(err.statusCode).json(
      createErrorResponse(err.code, err.message, err.details)
    );
    return;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json(
      createErrorResponse('INVALID_TOKEN', 'Invalid authentication token')
    );
    return;
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json(
      createErrorResponse('TOKEN_EXPIRED', 'Authentication token has expired')
    );
    return;
  }

  // Handle database errors
  if (err.message.includes('duplicate key')) {
    res.status(409).json(
      createErrorResponse(
        'DUPLICATE_ENTRY',
        'A record with this identifier already exists'
      )
    );
    return;
  }

  if (err.message.includes('violates foreign key constraint')) {
    res.status(400).json(
      createErrorResponse(
        'INVALID_REFERENCE',
        'Referenced record does not exist'
      )
    );
    return;
  }

  // Handle generic errors
  const isDevelopment = process.env.NODE_ENV === 'development';
  const statusCode = 500;

  res.status(statusCode).json(
    createErrorResponse(
      'INTERNAL_SERVER_ERROR',
      'An unexpected error occurred',
      isDevelopment ? { error: err.message, stack: err.stack } : undefined
    )
  );
}

/**
 * Not found handler
 *
 * Handles requests to non-existent routes.
 *
 * @param req - Express request
 * @param res - Express response
 */
export function notFoundHandler(req: Request, res: Response): void {
  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
  });

  res.status(404).json(
    createErrorResponse(
      'NOT_FOUND',
      `Route ${req.method} ${req.path} not found`
    )
  );
}

/**
 * Async handler wrapper
 *
 * Wraps async route handlers to catch errors and pass them to error middleware.
 *
 * @param fn - Async route handler function
 * @returns Wrapped function that catches errors
 *
 * @example
 * router.get('/licenses', asyncHandler(async (req, res) => {
 *   const licenses = await licenseRepository.findAll();
 *   res.json(licenses);
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
