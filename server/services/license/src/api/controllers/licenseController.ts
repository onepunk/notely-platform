/**
 * License Controller
 *
 * Handles license generation, revocation, and information retrieval.
 * These endpoints are admin-only and require authentication.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getPrivateKey, getPublicKey } from '../../services/keyManager';
import { logger } from '../../utils/logger';
import { formatLicenseKey, generateOpaqueKey } from '../../utils/licenseFormatter';
import { licenseRepository, tierRepository, featureRepository, type License as LicenseModel } from '../../data';
import { getPool } from '../../lib/database';

/**
 * Zod schema for license generation request
 */
const generateLicenseSchema = z
  .object({
    productType: z.enum(['portal', 'desktop', 'notely-ai']).default('portal'),
    type: z.enum(['perpetual', 'subscription', 'trial'], {
      errorMap: () => ({ message: 'Type must be one of: perpetual, subscription, trial' }),
    }),
    organizationId: z.union([z.string(), z.null()]).optional(),
    userId: z.string().uuid({ message: 'User ID must be a valid UUID' }).optional(),
    email: z.string().email({ message: 'Email must be a valid email address' }).optional(),
    hardwareId: z.string().optional(),
    features: z.record(z.boolean()).optional().default({}),
    limits: z.record(z.number().int().positive()).optional().default({}),
    expiresAt: z
      .string()
      .datetime({ message: 'ExpiresAt must be a valid ISO 8601 datetime' })
      .optional(),
    notes: z.string().max(1000).optional(),
    // Notely AI specific fields
    activationLimit: z.number().int().min(1).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    const trimmedOrgId = typeof data.organizationId === 'string'
      ? data.organizationId.trim()
      : undefined;

    if (data.productType === 'portal' && !trimmedOrgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Organization ID is required for portal licenses',
      });
    }

    if (data.productType === 'desktop' && data.organizationId && !trimmedOrgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Organization ID must be meaningful text when provided',
      });
    }

    // userId is required for portal and desktop licenses
    if (data.productType !== 'notely-ai' && !data.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userId'],
        message: 'User ID is required for portal and desktop licenses',
      });
    }

    // notely-ai requires either userId or email
    if (data.productType === 'notely-ai' && !data.userId && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Either userId or email is required for Notely AI licenses',
      });
    }
  });

/**
 * License payload structure for JWT
 */
interface LicensePayload {
  sub: string; // license ID
  iss: string; // issuer
  iat: number; // issued at
  exp?: number; // expiration (optional for perpetual)
  type: 'perpetual' | 'subscription' | 'trial';
  productType: 'portal' | 'desktop' | 'notely-ai';
  organizationId?: string;
  userId?: string;
  email?: string; // for notely-ai licenses without a user account
  hardwareId?: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  activationLimit?: number; // notely-ai only
}

/**
 * Generate a new license key
 *
 * @route POST /api/license/admin/generate
 * @access Admin only
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with license key and metadata
 *
 * @example
 * Request body:
 * {
 *   "type": "subscription",
 *   "organizationId": "123e4567-e89b-12d3-a456-426614174000",
 *   "userId": "123e4567-e89b-12d3-a456-426614174001",
 *   "hardwareId": "ABC123",
 *   "features": { "meetings": true, "recording": false },
 *   "limits": { "maxUsers": 100, "maxStorage": 1000 },
 *   "expiresAt": "2025-12-31T23:59:59Z"
 * }
 *
 * Response:
 * {
 *   "licenseKey": "eyJhbGc...",
 *   "licenseId": "123e4567-e89b-12d3-a456-426614174002",
 *   "type": "subscription",
 *   "organizationId": "123e4567-e89b-12d3-a456-426614174000",
 *   "userId": "123e4567-e89b-12d3-a456-426614174001",
 *   "features": { "meetings": true, "recording": false },
 *   "limits": { "maxUsers": 100, "maxStorage": 1000 },
 *   "issuedAt": "2025-11-13T14:30:00Z",
 *   "expiresAt": "2025-12-31T23:59:59Z"
 * }
 */
export async function generateLicense(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const validationResult = generateLicenseSchema.safeParse(req.body);

    if (!validationResult.success) {
      logger.warn('License generation validation failed', {
        errors: validationResult.error.errors,
      });
      res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
      return;
    }

    const params = {
      ...validationResult.data,
      organizationId:
        typeof validationResult.data.organizationId === 'string'
          ? validationResult.data.organizationId.trim() || undefined
          : undefined,
    };

    // Generate a unique license ID
    const licenseId = uuidv4();
    const issuedAt = Math.floor(Date.now() / 1000);

    logger.info('Generating license', {
      licenseId,
      type: params.type,
      organizationId: params.organizationId,
      userId: params.userId,
    });

    let licenseKey: string;

    if (params.productType === 'notely-ai') {
      // Generate short opaque key for Notely AI licenses (no JWT)
      licenseKey = generateOpaqueKey();

      // Still validate expiration for non-perpetual types
      if (!params.expiresAt && params.type !== 'perpetual') {
        logger.warn('Missing expiresAt for non-perpetual license', {
          type: params.type,
        });
        res.status(400).json({
          error: 'Validation failed',
          message: 'expiresAt is required for subscription and trial licenses',
        });
        return;
      }
    } else {
      // Build the license payload for JWT-based keys (portal/desktop)
      const payload: LicensePayload = {
        sub: licenseId,
        iss: 'notely-license-service',
        iat: issuedAt,
        type: params.type,
        productType: params.productType,
        ...(params.organizationId && { organizationId: params.organizationId }),
        ...(params.userId && { userId: params.userId }),
        ...(params.email && { email: params.email }),
        features: params.features,
        limits: params.limits,
      };

      // Add hardware ID if provided
      if (params.hardwareId) {
        payload.hardwareId = params.hardwareId;
      }

      // Add expiration if provided (required for subscription/trial)
      if (params.expiresAt) {
        const expiresAtDate = new Date(params.expiresAt);
        payload.exp = Math.floor(expiresAtDate.getTime() / 1000);
      } else if (params.type !== 'perpetual') {
        logger.warn('Missing expiresAt for non-perpetual license', {
          type: params.type,
        });
        res.status(400).json({
          error: 'Validation failed',
          message: 'expiresAt is required for subscription and trial licenses',
        });
        return;
      }

      // Get the private key from key manager
      const privateKey = getPrivateKey();

      // Sign the license with RS256
      const signedToken = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
      });

      licenseKey = formatLicenseKey(params.productType, signedToken);
    }
    const issuedBy = req.authContext?.userId;

    if (!issuedBy) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Missing issuer context',
      });
      return;
    }

    const expiresAtDate = params.expiresAt ? new Date(params.expiresAt) : null;
    const featureList = extractFeatureKeys(params.features ?? {});
    const notes = params.notes?.trim() || null;

    // Look up the appropriate tier based on product type
    let tier;
    if (params.productType === 'notely-ai') {
      tier = await tierRepository.getByKey('notely-ai');
      if (!tier) {
        logger.error('Notely AI tier not found in database');
        res.status(500).json({
          error: 'configuration_error',
          message: 'Notely AI tier configuration is missing',
        });
        return;
      }
    } else {
      // Default to free tier for portal and desktop licenses
      tier = await tierRepository.getFreeTier();
      if (!tier) {
        logger.error('Free tier not found in database');
        res.status(500).json({
          error: 'configuration_error',
          message: 'License tier configuration is missing',
        });
        return;
      }
    }

    // Determine user_id and organization_id based on product type:
    // - portal: organization_id required, user_id null
    // - desktop: user_id required, organization_id null
    // - notely-ai: user_id optional (null when generated for beta via email only), organization_id null
    const organizationId = params.productType === 'portal' ? params.organizationId ?? null : null;
    const userId = (params.productType === 'desktop' || params.productType === 'notely-ai') ? (params.userId ?? null) : null;

    const record = await licenseRepository.create(
      {
        license_key: licenseKey,
        license_type: params.productType,
        organization_id: organizationId,
        user_id: userId,
        features: featureList,
        limits: params.limits,
        issued_at: new Date(issuedAt * 1000),
        expires_at: expiresAtDate,
        revoked_at: null,
        revocation_reason: null,
        hardware_id: params.hardwareId ?? null,
        issued_by: issuedBy,
        notes,
        tier_id: tier.id,
        // Notely AI activation fields
        ...(params.productType === 'notely-ai' && {
          activation_limit: params.activationLimit ?? 1,
        }),
      },
      { id: licenseId }
    );

    logger.info('License generated successfully', {
      licenseId,
      productType: params.productType,
    });

    const licenseResponse = mapLicenseRecord(record);

    res.status(201).json({
      licenseKey,
      licenseId,
      type: params.type,
      productType: params.productType,
      organizationId: params.organizationId ?? null,
      userId: params.userId,
      features: params.features,
      limits: params.limits,
      issuedAt: licenseResponse.issued_at,
      ...(params.expiresAt && { expiresAt: params.expiresAt }),
      ...(params.hardwareId && { hardwareId: params.hardwareId }),
      ...(notes && { notes }),
      license: licenseResponse,
    });
  } catch (error) {
    logger.error('Error generating license', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to generate license',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
    });
  }
}

/**
 * Revoke a license key
 *
 * @route POST /api/license/admin/revoke/:licenseKey
 * @access Admin only
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with success status
 *
 * @example
 * Response:
 * {
 *   "success": true,
 *   "message": "License revoked successfully",
 *   "licenseKey": "eyJhbGc..."
 * }
 */
export async function revokeLicense(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!id) {
      logger.warn('License revocation attempted without license ID');
      res.status(400).json({
        error: 'Validation failed',
        message: 'License ID is required',
      });
      return;
    }

    logger.info('Attempting to revoke license', { licenseId: id });

    // Check if license exists
    const license = await licenseRepository.findById(id);
    if (!license) {
      logger.warn('License not found for revocation', { licenseId: id });
      res.status(404).json({
        error: 'Not found',
        message: 'License not found',
      });
      return;
    }

    // Check if already revoked
    if (license.revoked_at) {
      logger.warn('License already revoked', { licenseId: id });
      res.status(400).json({
        error: 'Already revoked',
        message: 'This license has already been revoked',
      });
      return;
    }

    // Revoke the license
    await licenseRepository.revoke(id, reason || 'Revoked by admin');

    // Fetch updated license
    const updatedLicense = await licenseRepository.findById(id);

    logger.info('License revoked successfully', { licenseId: id });

    res.status(200).json({
      success: true,
      message: 'License revoked successfully',
      license: updatedLicense,
    });
  } catch (error) {
    logger.error('Error revoking license', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to revoke license',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
    });
  }
}

/**
 * Get license information
 *
 * @route GET /api/license/admin/info/:licenseKey
 * @access Admin only
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with license details
 *
 * @example
 * Response:
 * {
 *   "licenseId": "123e4567-e89b-12d3-a456-426614174002",
 *   "type": "subscription",
 *   "organizationId": "123e4567-e89b-12d3-a456-426614174000",
 *   "userId": "123e4567-e89b-12d3-a456-426614174001",
 *   "features": { "meetings": true, "recording": false },
 *   "limits": { "maxUsers": 100, "maxStorage": 1000 },
 *   "issuedAt": "2025-11-13T14:30:00Z",
 *   "expiresAt": "2025-12-31T23:59:59Z",
 *   "hardwareId": "ABC123"
 * }
 */
export async function getLicenseInfo(req: Request, res: Response): Promise<void> {
  try {
    const { licenseKey } = req.params;

    if (!licenseKey) {
      logger.warn('License info requested without license key');
      res.status(400).json({
        error: 'Validation failed',
        message: 'License key is required',
      });
      return;
    }

    logger.debug('Retrieving license info', {
      licenseKeyPrefix: licenseKey.substring(0, 20) + '...',
    });

    // Decode and verify the license
    const publicKey = getPublicKey();

    try {
      const decoded = jwt.verify(licenseKey, publicKey, {
        algorithms: ['RS256']
      }) as LicensePayload;

      logger.info('License info retrieved successfully', {
        licenseId: decoded.sub,
        type: decoded.type,
      });

      // Build response with license details
      const response = {
        licenseId: decoded.sub,
        type: decoded.type,
        organizationId: decoded.organizationId ?? null,
        productType: decoded.productType ?? 'portal',
        userId: decoded.userId,
        features: decoded.features,
        limits: decoded.limits,
        issuedAt: new Date(decoded.iat * 1000).toISOString(),
        ...(decoded.exp && { expiresAt: new Date(decoded.exp * 1000).toISOString() }),
        ...(decoded.hardwareId && { hardwareId: decoded.hardwareId }),
        issuer: decoded.iss,
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logger.warn('Expired license key provided for info', {
          expiredAt: error.expiredAt?.toISOString(),
        });
        res.status(400).json({
          error: 'License expired',
          message: 'The license key has expired',
          expiredAt: error.expiredAt?.toISOString(),
        });
        return;
      }

      if (error instanceof jwt.JsonWebTokenError) {
        logger.warn('Invalid license key provided for info', {
          error: error.message,
        });
        res.status(400).json({
          error: 'Invalid license key',
          message: 'The provided license key is not valid or has been tampered with',
        });
        return;
      }

      throw error;
    }
  } catch (error) {
    logger.error('Error getting license info', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to get license information',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
    });
  }
}

/**
 * List licenses with pagination and filtering
 *
 * @route GET /api/license/admin/licenses
 * @access Admin only
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with paginated license list
 *
 * @example
 * Query params: ?page=1&limit=50&type=subscription&status=active&search=org123
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "licenses": [...],
 *     "pagination": {
 *       "page": 1,
 *       "limit": 50,
 *       "total": 150,
 *       "pages": 3
 *     }
 *   }
 * }
 */
export async function listLicenses(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;
    const typeFilter = (req.query.type as string | undefined)?.toLowerCase();
    const statusFilter = (req.query.status as string | undefined)?.toLowerCase();
    const search = (req.query.search as string | undefined)?.trim();

    logger.info('Listing licenses', { page, limit, typeFilter, statusFilter });

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (typeFilter && typeFilter !== 'all' && ['portal', 'desktop'].includes(typeFilter)) {
      conditions.push(`license_type = $${paramIndex++}`);
      values.push(typeFilter);
    }

    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'active') {
        conditions.push('(revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()))');
      } else if (statusFilter === 'expired') {
        conditions.push('(revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= NOW())');
      } else if (statusFilter === 'revoked') {
        conditions.push('revoked_at IS NOT NULL');
      }
    }

    if (search) {
      conditions.push(
        `(license_key ILIKE $${paramIndex} OR ` +
          `COALESCE(organization_id::text, '') ILIKE $${paramIndex} OR ` +
          `COALESCE(user_id::text, '') ILIKE $${paramIndex} OR ` +
          `COALESCE(uc.email::text, '') ILIKE $${paramIndex})`
      );
      values.push(`%${search}%`);
      paramIndex += 1;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const pool = getPool();
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM licensing.licenses l
       LEFT JOIN global_auth.user_credentials uc ON uc.id = l.user_id
       ${whereClause.replace(/(\b(?:license_type|license_key|organization_id|user_id|revoked_at|expires_at|created_at)\b)/g, 'l.$1')}`,
      values
    );

    const rawTotal = countResult.rows[0]?.count ?? '0';
    const parsedTotal = Number.parseInt(rawTotal, 10);
    const total = Number.isNaN(parsedTotal) ? 0 : parsedTotal;

    const dataValues = [...values, limit, offset];
    const limitParam = paramIndex++;
    const offsetParam = paramIndex++;

    // Join with tiers table for tier info and user_credentials for email
    const dataQuery = await pool.query<LicenseModel & { tier_key?: string; tier_name?: string; user_email?: string }>(
      `SELECT l.*, t.tier_key, t.display_name as tier_name, uc.email as user_email
       FROM licensing.licenses l
       LEFT JOIN licensing.tiers t ON l.tier_id = t.id
       LEFT JOIN global_auth.user_credentials uc ON uc.id = l.user_id
       ${whereClause.replace(/(\b(?:license_type|license_key|organization_id|user_id|revoked_at|expires_at|created_at)\b)/g, 'l.$1')}
       ORDER BY l.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      dataValues
    );

    const licenses = dataQuery.rows.map((row) => ({
      ...mapLicenseRecord(row),
      tier_key: row.tier_key ?? null,
      tier_name: row.tier_name ?? null,
      user_email: row.user_email ?? null,
    }));
    const pages = limit > 0 ? Math.ceil(total / limit) : 1;

    res.status(200).json({
      success: true,
      data: {
        licenses,
        pagination: {
        page,
        limit,
        total,
        pages,
        },
      },
    });
  } catch (error) {
    logger.error('Error listing licenses', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'LIST_LICENSES_ERROR',
        message: 'Failed to list licenses',
        details: process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined,
      },
    });
  }
}

/**
 * Get detailed license information by ID
 *
 * @route GET /api/license/admin/licenses/:id
 * @access Admin only
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with license details including validation stats
 */
export async function getLicenseDetails(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'License ID is required',
        },
      });
      return;
    }

    logger.info('Getting license details', { licenseId: id });

    // TODO: Fetch license from repository
    // TODO: Include validation count and last validation timestamp

    res.status(404).json({
      success: false,
      error: {
        code: 'LICENSE_NOT_FOUND',
        message: 'License not found',
      },
    });
  } catch (error) {
    logger.error('Error getting license details', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_LICENSE_ERROR',
        message: 'Failed to get license details',
        details: process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined,
      },
    });
  }
}

/**
 * List all active feature definitions
 *
 * @route GET /api/license/admin/features
 * @access Admin only
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with feature list
 */
export async function listFeatures(req: Request, res: Response): Promise<void> {
  try {
    logger.info('Listing features');

    const features = await featureRepository.getAllActive();

    res.status(200).json({
      success: true,
      data: {
        features,
      },
    });
  } catch (error) {
    logger.error('Error listing features', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'LIST_FEATURES_ERROR',
        message: 'Failed to list features',
        details: process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined,
      },
    });
  }
}

/**
 * Get validation log with filtering and pagination
 *
 * @route GET /api/license/admin/validations
 * @access Admin only
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with validation log
 *
 * @example
 * Query params: ?page=1&limit=50&licenseId=xxx&isValid=true&startDate=2025-01-01
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "validations": [...],
 *     "pagination": {
 *       "page": 1,
 *       "limit": 50,
 *       "total": 200
 *     }
 *   }
 * }
 */
export async function getValidationLog(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    logger.info('Getting validation log', { page, limit });

    // TODO: Fetch validation records from repository with filters
    // TODO: Support filtering by licenseId, isValid, date range

    const response = {
      success: true,
      data: {
        validations: [],
        pagination: {
          page,
          limit,
          total: 0,
        },
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error('Error getting validation log', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_VALIDATION_LOG_ERROR',
        message: 'Failed to get validation log',
        details: process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined,
      },
    });
  }
}

function mapLicenseRecord(license: LicenseModel) {
  return {
    id: license.id,
    license_key: license.license_key,
    license_type: license.license_type,
    organization_id: license.organization_id,
    user_id: license.user_id,
    features: normalizeFeatureList(license.features),
    limits: normalizeLimits(license.limits),
    issued_at: license.issued_at instanceof Date ? license.issued_at.toISOString() : license.issued_at,
    expires_at: license.expires_at instanceof Date ? license.expires_at.toISOString() : license.expires_at,
    revoked_at: license.revoked_at instanceof Date ? license.revoked_at.toISOString() : license.revoked_at,
    revocation_reason: license.revocation_reason,
    hardware_id: license.hardware_id,
    issued_by: license.issued_by,
    notes: license.notes,
    created_at: license.created_at instanceof Date ? license.created_at.toISOString() : license.created_at,
    updated_at: license.updated_at instanceof Date ? license.updated_at.toISOString() : license.updated_at,
    // Tier information
    tier_id: license.tier_id ?? null,
    grant_type: license.grant_type ?? null,
  };
}

function normalizeFeatureList(features: unknown): string[] {
  if (Array.isArray(features)) {
    return features as string[];
  }

  if (!features) {
    return [];
  }

  if (typeof features === 'string') {
    try {
      const parsed = JSON.parse(features);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        return Object.keys(record).filter((key) => Boolean(record[key]));
      }
    } catch (error) {
      logger.warn('Failed to parse features JSON', { error });
    }
    return [];
  }

  if (typeof features === 'object') {
    const record = features as Record<string, unknown>;
    return Object.keys(record).filter((key) => Boolean(record[key]));
  }

  return [];
}

function normalizeLimits(limits: unknown): Record<string, unknown> {
  if (!limits) {
    return {};
  }

  if (typeof limits === 'string') {
    try {
      const parsed = JSON.parse(limits);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (error) {
      logger.warn('Failed to parse limits JSON', { error });
      return {};
    }
  }

  if (typeof limits === 'object') {
    return limits as Record<string, unknown>;
  }

  return {};
}

function extractFeatureKeys(features: Record<string, boolean>): string[] {
  return Object.entries(features)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);
}
