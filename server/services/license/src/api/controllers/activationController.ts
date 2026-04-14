/**
 * Activation Controller
 *
 * Handles license activation, revalidation, and deactivation endpoints.
 * These endpoints are used by Notely AI (na-) licenses for email-bound activation.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import {
  activateLicense,
  revalidateLicense,
  deactivateLicense,
} from '../../services/activationService';
import { logger } from '../../utils/logger';

/**
 * Normalize platform values from process.platform (win32, darwin) to canonical names
 */
const platformMap: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
};

const normalizePlatform = (val: unknown) =>
  typeof val === 'string' ? platformMap[val] ?? val : val;

const platformEnum = z.enum(['windows', 'macos', 'linux']);

/**
 * Zod schema for activation request
 */
const activateSchema = z.object({
  licenseKey: z.string().min(1, { message: 'License key is required' }),
  email: z.string().email({ message: 'Valid email is required' }),
  platform: z.preprocess(normalizePlatform, platformEnum).optional(),
  appVersion: z.string().optional(),
});

/**
 * Zod schema for revalidation request
 */
const revalidateSchema = z.object({
  activationId: z.string().uuid({ message: 'Valid activation ID is required' }),
  platform: z.preprocess(normalizePlatform, platformEnum).optional(),
  appVersion: z.string().optional(),
});

/**
 * Zod schema for deactivation request
 */
const deactivateSchema = z.object({
  activationId: z.string().uuid({ message: 'Valid activation ID is required' }),
});

/**
 * Get client IP from request
 */
function getClientIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
}

/**
 * Activate a license with email binding
 *
 * @route POST /api/license/activate
 * @access Public (rate-limited)
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @example
 * Request body:
 * {
 *   "licenseKey": "na-eyJhbGc...",
 *   "email": "user@example.com",
 *   "platform": "windows",
 *   "appVersion": "1.0.0"
 * }
 *
 * Response (success):
 * {
 *   "success": true,
 *   "activationId": "uuid",
 *   "email": "user@example.com",
 *   "tierKey": "professional",
 *   "tierName": "Professional",
 *   "features": { "ai-summary": true, ... },
 *   "offlineToken": "eyJ...",
 *   "offlineGraceDeadline": "2025-02-13T00:00:00Z",
 *   "nextRequiredValidation": "2025-01-20T00:00:00Z"
 * }
 *
 * Response (error):
 * {
 *   "success": false,
 *   "error": {
 *     "code": "ACTIVATION_LIMIT",
 *     "message": "This license has reached its activation limit",
 *     "existingEmail": "j***n@example.com"
 *   }
 * }
 */
export async function handleActivate(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const validationResult = activateSchema.safeParse(req.body);

    if (!validationResult.success) {
      logger.warn('Activation request failed schema validation', {
        errors: validationResult.error.errors,
      });
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: validationResult.error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        },
      });
      return;
    }

    const { licenseKey, email, platform, appVersion } = validationResult.data;
    const clientIp = getClientIp(req);

    logger.info('Processing activation request', {
      licenseKeyPrefix: licenseKey.substring(0, 10) + '...',
      emailDomain: email.split('@')[1],
      platform,
    });

    const result = await activateLicense({
      licenseKey,
      email,
      platform,
      appVersion,
      clientIp,
    });

    if (result.success) {
      logger.info('Activation successful', {
        activationId: result.activationId,
        tierKey: result.tierKey,
      });
      res.status(200).json(result);
    } else {
      // Determine HTTP status based on error code
      let statusCode = 400;
      if (result.error.code === 'INTERNAL_ERROR') {
        statusCode = 500;
      }

      logger.warn('Activation failed', {
        code: result.error.code,
        message: result.error.message,
      });
      res.status(statusCode).json(result);
    }
  } catch (error) {
    logger.error('Error handling activation request', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
      },
    });
  }
}

/**
 * Revalidate an existing activation (periodic online check)
 *
 * @route POST /api/license/revalidate
 * @access Public (rate-limited)
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @example
 * Request body:
 * {
 *   "activationId": "uuid",
 *   "platform": "windows",
 *   "appVersion": "1.0.1"
 * }
 *
 * Response (success):
 * {
 *   "success": true,
 *   "offlineToken": "eyJ...",
 *   "offlineGraceDeadline": "2025-02-13T00:00:00Z",
 *   "nextRequiredValidation": "2025-01-20T00:00:00Z"
 * }
 */
export async function handleRevalidate(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const validationResult = revalidateSchema.safeParse(req.body);

    if (!validationResult.success) {
      logger.warn('Revalidation request failed schema validation', {
        errors: validationResult.error.errors,
      });
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: validationResult.error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        },
      });
      return;
    }

    const { activationId, platform, appVersion } = validationResult.data;
    const clientIp = getClientIp(req);

    logger.info('Processing revalidation request', {
      activationId,
      platform,
    });

    const result = await revalidateLicense({
      activationId,
      platform,
      appVersion,
      clientIp,
    });

    if (result.success) {
      logger.info('Revalidation successful', { activationId });
      res.status(200).json(result);
    } else {
      let statusCode = 400;
      if (result.error?.code === 'INTERNAL_ERROR') {
        statusCode = 500;
      } else if (result.error?.code === 'ACTIVATION_NOT_FOUND') {
        statusCode = 404;
      }

      logger.warn('Revalidation failed', {
        activationId,
        code: result.error?.code,
        message: result.error?.message,
      });
      res.status(statusCode).json(result);
    }
  } catch (error) {
    logger.error('Error handling revalidation request', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
      },
    });
  }
}

/**
 * Deactivate a license activation
 *
 * @route POST /api/license/deactivate
 * @access Public (rate-limited)
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @example
 * Request body:
 * {
 *   "activationId": "uuid"
 * }
 *
 * Response (success):
 * {
 *   "success": true
 * }
 */
export async function handleDeactivate(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const validationResult = deactivateSchema.safeParse(req.body);

    if (!validationResult.success) {
      logger.warn('Deactivation request failed schema validation', {
        errors: validationResult.error.errors,
      });
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: validationResult.error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        },
      });
      return;
    }

    const { activationId } = validationResult.data;

    logger.info('Processing deactivation request', { activationId });

    const result = await deactivateLicense(activationId);

    if (result.success) {
      logger.info('Deactivation successful', { activationId });
      res.status(200).json(result);
    } else {
      let statusCode = 400;
      if (result.error?.code === 'INTERNAL_ERROR') {
        statusCode = 500;
      } else if (result.error?.code === 'ACTIVATION_NOT_FOUND') {
        statusCode = 404;
      }

      logger.warn('Deactivation failed', {
        activationId,
        code: result.error?.code,
        message: result.error?.message,
      });
      res.status(statusCode).json(result);
    }
  } catch (error) {
    logger.error('Error handling deactivation request', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
      },
    });
  }
}
