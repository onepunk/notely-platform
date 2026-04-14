/**
 * Validation Controller
 *
 * Handles license validation and public key distribution.
 * These endpoints are public and rate-limited.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { getPublicKey as getPublicKeyFromManager } from '../../services/keyManager';
import { logger } from '../../utils/logger';
import { licenseRepository, tierRepository } from '../../data';
import type { License as LicenseModel } from '../../models/types';
import { createSuccessResponse } from '../schemas/licenseSchemas';
import { parseLicenseKey } from '../../utils/licenseFormatter';

/**
 * Zod schema for license validation request
 */
const validateLicenseSchema = z.object({
  licenseKey: z.string().min(1, { message: 'License key is required' }),
  hardwareId: z.string().optional(),
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
  productType?: 'portal' | 'desktop' | 'notely-ai';
  organizationId?: string;
  userId: string;
  hardwareId?: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

/**
 * Validation result structure
 */
interface ValidationResult {
  valid: boolean;
  reason?: string;
  licenseId?: string;
  type?: string;
  tierKey?: string;
  tierName?: string;
  productType?: string;
  organizationId?: string;
  userId?: string;
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
  issuedAt?: string;
  expiresAt?: string;
  hardwareId?: string;
  grantType?: string; // How the license was acquired ('purchase', 'beta', 'trial', 'promotional', 'admin_grant')
  isBeta?: boolean; // Convenience flag for beta licenses
}

/**
 * Validate a license key
 *
 * @route POST /api/license/validate
 * @access Public (rate-limited)
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with validation result
 *
 * @example
 * Request body:
 * {
 *   "licenseKey": "eyJhbGc...",
 *   "hardwareId": "ABC123"
 * }
 *
 * Response (valid):
 * {
 *   "valid": true,
 *   "licenseId": "123e4567-e89b-12d3-a456-426614174002",
 *   "type": "subscription",
 *   "organizationId": "123e4567-e89b-12d3-a456-426614174000",
 *   "userId": "123e4567-e89b-12d3-a456-426614174001",
 *   "features": { "meetings": true, "recording": false },
 *   "limits": { "maxUsers": 100, "maxStorage": 1000 },
 *   "issuedAt": "2025-11-13T14:30:00Z",
 *   "expiresAt": "2025-12-31T23:59:59Z"
 * }
 *
 * Response (invalid):
 * {
 *   "valid": false,
 *   "reason": "License key is invalid or has been tampered with"
 * }
 */
export async function validateLicense(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const validationResult = validateLicenseSchema.safeParse(req.body);

    if (!validationResult.success) {
      logger.warn('License validation request failed schema validation', {
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

    const { licenseKey, hardwareId } = validationResult.data;

    logger.info('Validating license', {
      licenseKeyPrefix: licenseKey.substring(0, 20) + '...',
      hasHardwareId: !!hardwareId,
    });

    // Get the public key
    const publicKey = getPublicKeyFromManager();

    // Parse the license key to extract the JWT (removes nd- or np- prefix)
    let parsedKey;
    try {
      parsedKey = parseLicenseKey(licenseKey);
    } catch (parseError) {
      logger.warn('License validation failed: Invalid format', {
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      const result: ValidationResult = {
        valid: false,
        reason: 'License key format is invalid',
      };
      res.status(200).json(result);
      return;
    }

    // Opaque na- keys cannot be validated via JWT — do a DB lookup instead
    if (parsedKey.opaqueKey) {
      const license = await licenseRepository.findByKey(licenseKey);
      if (!license) {
        res.status(200).json({ valid: false, reason: 'License key not found' } as ValidationResult);
        return;
      }
      if (license.revoked_at) {
        res.status(200).json({ valid: false, reason: 'License has been revoked' } as ValidationResult);
        return;
      }
      if (license.expires_at && new Date(license.expires_at) < new Date()) {
        res.status(200).json({ valid: false, reason: 'License has expired' } as ValidationResult);
        return;
      }

      let tierKey = 'free';
      let tierName = 'Free';
      const tierId = (license as { tier_id?: string }).tier_id;
      if (tierId) {
        const tier = await tierRepository.getById(tierId);
        if (tier) {
          tierKey = tier.tier_key;
          tierName = tier.display_name || tier.tier_key.charAt(0).toUpperCase() + tier.tier_key.slice(1);
        }
      }

      const grantType = (license as { grant_type?: string }).grant_type;
      const result: ValidationResult = {
        valid: true,
        licenseId: license.id,
        type: 'subscription',
        tierKey,
        tierName,
        productType: 'notely-ai',
        userId: license.user_id ?? undefined,
        features: {},
        limits: {},
        issuedAt: new Date(license.issued_at).toISOString(),
        expiresAt: license.expires_at ? new Date(license.expires_at).toISOString() : undefined,
        grantType,
        isBeta: grantType === 'beta',
      };
      res.status(200).json(result);
      return;
    }

    // Attempt to verify and decode the JWT
    try {
      const decoded = jwt.verify(parsedKey.jwt!, publicKey, {
        algorithms: ['RS256'],
      }) as LicensePayload;

      // Check hardware ID match if provided
      if (hardwareId && decoded.hardwareId && decoded.hardwareId !== hardwareId) {
        logger.warn('License validation failed: Hardware ID mismatch', {
          licenseId: decoded.sub,
          providedHardwareId: hardwareId,
        });
        const result: ValidationResult = {
          valid: false,
          reason: 'Hardware ID mismatch',
        };
        res.status(200).json(result);
        return;
      }

      // TODO: Check revocation status in database
      // For now, we assume the license is not revoked if it verifies

      // Look up the license to get tier information and grant type
      let tierKey = 'free';
      let tierName = 'Free';
      let grantType: string | undefined;
      let isBeta = false;

      const license = await licenseRepository.findByKey(licenseKey);
      if (license) {
        grantType = (license as { grant_type?: string }).grant_type;
        isBeta = grantType === 'beta';

        const tierId = (license as { tier_id?: string }).tier_id;
        if (tierId) {
          const tier = await tierRepository.getById(tierId);
          if (tier) {
            tierKey = tier.tier_key;
            tierName = tier.display_name || tier.tier_key.charAt(0).toUpperCase() + tier.tier_key.slice(1);
          }
        }
      }

      logger.info('License validated successfully', {
        licenseId: decoded.sub,
        type: decoded.type,
        organizationId: decoded.organizationId ?? null,
        productType: decoded.productType ?? 'portal',
        tierKey,
      });

      // Build success response
      const result: ValidationResult = {
        valid: true,
        licenseId: decoded.sub,
        type: decoded.type,
        tierKey,
        tierName,
        productType: decoded.productType ?? 'desktop',
        organizationId: decoded.organizationId,
        userId: decoded.userId,
        features: decoded.features,
        limits: decoded.limits,
        issuedAt: new Date(decoded.iat * 1000).toISOString(),
        ...(decoded.exp && { expiresAt: new Date(decoded.exp * 1000).toISOString() }),
        ...(decoded.hardwareId && { hardwareId: decoded.hardwareId }),
        grantType,
        isBeta,
      };

      res.status(200).json(result);
    } catch (error) {
      // Handle JWT verification errors
      let reason = 'License key is invalid or has been tampered with';

      if (error instanceof jwt.TokenExpiredError) {
        reason = 'License has expired';
        logger.warn('License validation failed: License expired', {
          expiredAt: error.expiredAt?.toISOString(),
        });
      } else if (error instanceof jwt.JsonWebTokenError) {
        reason = 'License key is invalid or has been tampered with';
        logger.warn('License validation failed: Invalid JWT', {
          error: error.message,
        });
      }

      const result: ValidationResult = {
        valid: false,
        reason,
      };

      res.status(200).json(result);
    }
  } catch (error) {
    logger.error('Error validating license', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to validate license',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
    });
  }
}

/**
 * Get the public key for offline validation
 *
 * @route GET /api/license/public-key
 * @access Public (rate-limited)
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {string} The public key in PEM format
 *
 * @example
 * Response (text/plain):
 * -----BEGIN PUBLIC KEY-----
 * MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
 * -----END PUBLIC KEY-----
 */
export async function getPublicKey(req: Request, res: Response): Promise<void> {
  try {
    logger.debug('Public key requested');

    // Get the public key from key manager
    const publicKey = getPublicKeyFromManager();

    logger.info('Public key retrieved successfully');

    // Return as plain text PEM format
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(publicKey);
  } catch (error) {
    logger.error('Error getting public key', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to retrieve public key',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
    });
  }
}

/**
 * Get current user's license status
 *
 * Supports two response formats:
 * - Default (portal): Returns {success: true, data: {hasLicense, license}}
 * - Desktop (?format=desktop): Returns validation-style {valid: true, licenseId, ...}
 *
 * @route GET /api/license/current
 * @access Authenticated users
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with license status
 *
 * @example
 * Portal Response (default):
 * {
 *   "success": true,
 *   "data": {
 *     "hasLicense": true,
 *     "license": { ... }
 *   }
 * }
 *
 * Desktop Response (?format=desktop):
 * {
 *   "valid": true,
 *   "licenseId": "123e4567-e89b-12d3-a456-426614174002",
 *   "type": "public",
 *   "features": { "sync": true, "meetings": true },
 *   ...
 * }
 */
export async function getCurrentLicense(req: Request, res: Response): Promise<void> {
  try {
    // Extract user/org ID from JWT auth context
    const userId = req.authContext?.userId;
    const authOrgId = req.authContext?.organizationId;
    const queryOrgId =
      typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;
    const format = req.query.format as string | undefined;
    const isDesktopFormat = format === 'desktop';

    if (!userId) {
      if (isDesktopFormat) {
        res.status(401).json({
          valid: false,
          reason: 'Authentication required',
        });
      } else {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }
      return;
    }

    const organizationId = queryOrgId || authOrgId;

    logger.info('Getting current license', { userId, organizationId, format });

    let license: LicenseModel | null = null;

    if (organizationId) {
      license =
        (await licenseRepository.findActivePortalLicense(organizationId)) ||
        (await licenseRepository.findLatestPortalLicense(organizationId));
    } else {
      license =
        (await licenseRepository.findActiveDesktopLicense(userId)) ||
        (await licenseRepository.findLatestDesktopLicense(userId));
    }

    if (!license) {
      if (isDesktopFormat) {
        res.status(404).json({
          valid: false,
          reason: 'No license found for this user',
        });
      } else {
        // Portal format - return success with no license
        res.status(200).json(
          createSuccessResponse({
            hasLicense: false,
            license: null,
          })
        );
      }
      return;
    }

    const status = determineLicenseStatus(license);

    // For desktop format, handle invalid licenses differently
    if (isDesktopFormat && status !== 'active') {
      res.status(200).json({
        valid: false,
        reason: status === 'expired' ? 'License has expired' : 'License has been revoked',
        licenseId: license.id,
      });
      return;
    }

    if (isDesktopFormat) {
      // Desktop format: validation-style response
      // Look up tier info and features dynamically using tier_id FK
      // This ensures features reflect current tier assignments, not a stored snapshot
      let tierKey = 'free';
      let tierName = 'Free';
      let featuresArray: string[] = [];

      const tierId = (license as { tier_id?: string }).tier_id;
      if (tierId) {
        const tier = await tierRepository.getById(tierId);
        if (tier) {
          tierKey = tier.tier_key;
          tierName = tier.display_name || tier.tier_key.charAt(0).toUpperCase() + tier.tier_key.slice(1);
        }
        // Get features from tier (dynamically, not from stored snapshot)
        featuresArray = await tierRepository.getFeaturesForTierById(tierId);
      } else {
        // Fallback to stored features if no tier_id (legacy licenses)
        featuresArray = Array.isArray(license.features) ? license.features : [];
      }

      const featuresRecord: Record<string, boolean> = {};
      for (const feature of featuresArray) {
        if (typeof feature === 'string') {
          featuresRecord[feature] = true;
        }
      }

      // Keep legacy type mapping for backward compatibility, but also include actual tier info
      const clientType = license.license_type === 'desktop' ? 'public' : 'custom';

      // Get grant type from license
      const grantType = (license as { grant_type?: string }).grant_type;
      const isBeta = grantType === 'beta';

      const response: ValidationResult = {
        valid: true,
        licenseId: license.id,
        type: clientType, // Legacy: 'public' or 'custom' for backward compatibility
        tierKey, // New: actual tier key ('free', 'starter', 'professional', 'enterprise')
        tierName, // New: display name ('Free', 'Starter', 'Professional', 'Enterprise')
        productType: license.license_type,
        organizationId: license.organization_id ?? undefined,
        userId: license.user_id ?? undefined,
        features: featuresRecord,
        limits: (typeof license.limits === 'object' && license.limits !== null
          ? license.limits
          : {}) as Record<string, number>,
        issuedAt: new Date(license.issued_at).toISOString(),
        expiresAt: license.expires_at ? new Date(license.expires_at).toISOString() : undefined,
        grantType, // How the license was acquired ('purchase', 'beta', 'trial', etc.)
        isBeta, // Convenience flag for beta licenses
      };

      logger.info('Current license retrieved successfully (desktop format)', {
        licenseId: license.id,
        type: license.license_type,
        userId,
      });

      res.status(200).json(response);
    } else {
      // Portal format: structured response with full license object
      const expiresAt = license.expires_at ? new Date(license.expires_at) : null;
      const daysUntilExpiry = calculateDaysUntilExpiry(expiresAt);
      const warnings = buildLicenseWarnings(status, daysUntilExpiry, license);

      logger.info('Current license retrieved successfully (portal format)', {
        licenseId: license.id,
        type: license.license_type,
        userId,
      });

      res.status(200).json(
        createSuccessResponse({
          hasLicense: true,
          license: {
            ...serializeLicense(license),
            status,
            days_until_expiry: daysUntilExpiry,
            warnings,
          },
        })
      );
    }
  } catch (error) {
    logger.error('Error getting current license', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const format = req.query.format as string | undefined;

    if (format === 'desktop') {
      res.status(500).json({
        valid: false,
        reason: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: 'GET_CURRENT_LICENSE_ERROR',
          message: 'Failed to get current license',
          details: process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined,
        },
      });
    }
  }
}

/**
 * Get all current licenses for the authenticated user (cloud + notely-ai)
 *
 * @route GET /api/license/current/all
 * @access Authenticated users
 */
export async function getAllCurrentLicenses(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.authContext?.userId;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    logger.info('Getting all current licenses', { userId });

    // Fetch cloud (desktop) license
    let cloudLicense: LicenseModel | null =
      (await licenseRepository.findActiveDesktopLicense(userId)) ||
      (await licenseRepository.findLatestDesktopLicense(userId));

    // Fetch notely-ai license
    let aiLicense: LicenseModel | null =
      (await licenseRepository.findActiveNotelyAiLicense(userId)) ||
      (await licenseRepository.findLatestNotelyAiLicense(userId));

    const serializeWithStatus = (license: LicenseModel | null) => {
      if (!license) return null;
      const status = determineLicenseStatus(license);
      return {
        ...serializeLicense(license),
        status,
      };
    };

    res.status(200).json(
      createSuccessResponse({
        cloud: serializeWithStatus(cloudLicense),
        notelyAi: serializeWithStatus(aiLicense),
      })
    );
  } catch (error) {
    logger.error('Error getting all current licenses', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_ALL_LICENSES_ERROR',
        message: 'Failed to get current licenses',
        details: process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined,
      },
    });
  }
}

/**
 * License snapshot structure for heartbeat response
 */
interface LicenseSnapshot {
  hasLicense: boolean;
  licenseId: string | null;
  status: 'active' | 'expired' | 'revoked' | 'none';
  features: string[];
  expiresAt: string | null;
}

/**
 * Handle client heartbeat for concurrent usage tracking
 *
 * @route POST /api/license/heartbeat
 * @access Authenticated users
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 *
 * @returns {Object} JSON response with session status and license snapshot
 *
 * @example
 * Request body:
 * {
 *   "clientId": "desktop-abc123",
 *   "sessionToken": "session-xyz789",
 *   "clientVersion": "1.0.0",
 *   "platform": "win32"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "status": "active",
 *     "activeSessions": 5,
 *     "sessionLimit": 10,
 *     "warnings": [],
 *     "license": {
 *       "hasLicense": true,
 *       "licenseId": "uuid",
 *       "status": "active",
 *       "features": ["sync", "meetings"],
 *       "expiresAt": "2025-12-31T23:59:59Z"
 *     }
 *   }
 * }
 */
export async function handleHeartbeat(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const { clientId, sessionToken, clientVersion, platform } = req.body;

    if (!clientId || !sessionToken) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'clientId and sessionToken are required',
        },
      });
      return;
    }

    // Extract user/org from auth context
    const userId = req.authContext?.userId;
    const orgId = req.body?.organizationId;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    logger.info('Handling heartbeat', { userId, clientId, sessionToken });

    // TODO: Check concurrent limit for organization
    // TODO: Upsert session in database
    // TODO: Return session status

    // Fetch user's license snapshot for the desktop client
    let licenseSnapshot: LicenseSnapshot = {
      hasLicense: false,
      licenseId: null,
      status: 'none',
      features: [],
      expiresAt: null,
    };

    try {
      const license = await licenseRepository.findActiveDesktopLicense(userId);
      if (license) {
        const status = determineLicenseStatus(license);
        licenseSnapshot = {
          hasLicense: true,
          licenseId: license.id,
          status: status === 'active' ? 'active' : status === 'expired' ? 'expired' : 'revoked',
          features: Array.isArray(license.features) ? license.features : [],
          expiresAt: license.expires_at ? new Date(license.expires_at).toISOString() : null,
        };
      }
    } catch (licenseError) {
      logger.warn('Failed to fetch license for heartbeat', {
        userId,
        error: licenseError instanceof Error ? licenseError.message : String(licenseError),
      });
      // Continue with empty license snapshot - don't fail heartbeat
    }

    const response = {
      success: true,
      data: {
        status: 'active',
        activeSessions: 0,
        sessionLimit: 10,
        warnings: [],
        license: licenseSnapshot,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error('Error handling heartbeat', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: {
        code: 'HEARTBEAT_ERROR',
        message: 'Failed to process heartbeat',
        details: process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined,
      },
    });
  }
}

type LicenseStatus = 'active' | 'expired' | 'revoked';

function serializeLicense(license: LicenseModel) {
  const toIsoString = (value: Date | null): string | null => {
    if (!value) {
      return null;
    }
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  };

  return {
    ...license,
    issued_at: toIsoString(license.issued_at),
    expires_at: toIsoString(license.expires_at),
    revoked_at: toIsoString(license.revoked_at),
    created_at: toIsoString(license.created_at),
    updated_at: toIsoString(license.updated_at),
    features: Array.isArray(license.features) ? license.features : [],
    limits: typeof license.limits === 'object' && license.limits !== null ? license.limits : {},
  };
}

function determineLicenseStatus(license: LicenseModel): LicenseStatus {
  if (license.revoked_at) {
    return 'revoked';
  }

  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return 'expired';
  }

  return 'active';
}

function calculateDaysUntilExpiry(expiresAt: Date | null): number | null {
  if (!expiresAt) {
    return null;
  }

  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function buildLicenseWarnings(
  status: LicenseStatus,
  daysUntilExpiry: number | null,
  license: LicenseModel
): string[] {
  const warnings: string[] = [];

  if (status === 'revoked') {
    warnings.push('License has been revoked');
  } else if (status === 'expired') {
    warnings.push('License has expired');
  } else if (typeof daysUntilExpiry === 'number') {
    if (daysUntilExpiry <= 7) {
      warnings.push(`License expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`);
    } else if (daysUntilExpiry <= 30) {
      warnings.push(`License expires in ${daysUntilExpiry} days`);
    }
  }

  if (license.revocation_reason) {
    warnings.push(`Revocation reason: ${license.revocation_reason}`);
  }

  return warnings;
}
