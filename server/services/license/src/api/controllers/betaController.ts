/**
 * Beta Controller
 *
 * Handles beta program enrollment - granting users Professional tier access
 * for a limited time without requiring payment.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getPrivateKey } from '../../services/keyManager';
import { resetActivations } from '../../services/activationService';
import { logger } from '../../utils/logger';
import { formatLicenseKey } from '../../utils/licenseFormatter';
import { licenseRepository, tierRepository } from '../../data';
import { getPool } from '../../lib/database';
import { config } from '../../config/env';

// Professional tier UUID (from database)
const PROFESSIONAL_TIER_ID = '040e0a09-84f9-466d-a124-6c2677b0d138';

// Fixed beta expiration date - all beta licenses expire on this date
// regardless of when they were issued
const BETA_EXPIRATION_DATE = new Date('2026-04-30T23:59:59Z');

/**
 * Schema for enabling beta access
 */
const enableBetaSchema = z.object({
  userId: z.string().uuid({ message: 'User ID must be a valid UUID' }),
  notes: z.string().max(500).optional(),
});

/**
 * Schema for disabling beta access
 */
const disableBetaSchema = z.object({
  userId: z.string().uuid({ message: 'User ID must be a valid UUID' }),
  reason: z.string().max(500).optional(),
});

/**
 * License payload structure for JWT
 */
interface LicensePayload {
  sub: string;
  iss: string;
  iat: number;
  exp: number;
  type: 'subscription';
  productType: 'desktop';
  userId: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

/**
 * Enable beta access for a user
 * Creates a Professional tier desktop license with 'beta' payment status
 *
 * @route POST /api/license/admin/beta/enable
 * @access Admin only
 */
export async function enableBeta(req: Request, res: Response): Promise<void> {
  try {
    const validationResult = enableBetaSchema.safeParse(req.body);

    if (!validationResult.success) {
      logger.warn('Beta enable validation failed', {
        errors: validationResult.error.errors,
      });
      res.status(400).json({
        success: false,
        error: 'validation_error',
        details: validationResult.error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
      return;
    }

    const { userId, notes } = validationResult.data;
    const issuedBy = req.authContext?.userId;

    if (!issuedBy) {
      res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Missing issuer context',
      });
      return;
    }

    logger.info('Enabling beta access', { userId, expiresAt: BETA_EXPIRATION_DATE.toISOString(), issuedBy });

    // Check if user already has an active beta license
    const existingLicenses = await licenseRepository.findByUser(userId);
    const activeBetaLicense = existingLicenses.find(
      (l) =>
        l.grant_type === 'beta' &&
        !l.revoked_at &&
        (!l.expires_at || new Date(l.expires_at) > new Date())
    );

    if (activeBetaLicense) {
      logger.warn('User already has active beta license', { userId, licenseId: activeBetaLicense.id });
      res.status(409).json({
        success: false,
        error: 'already_enrolled',
        message: 'User already has an active beta license',
        license: {
          id: activeBetaLicense.id,
          expiresAt: activeBetaLicense.expires_at,
        },
      });
      return;
    }

    // Get Professional tier with features
    const professionalTier = await tierRepository.getByKeyWithFeatures('professional');
    if (!professionalTier) {
      logger.error('Professional tier not found');
      res.status(500).json({
        success: false,
        error: 'configuration_error',
        message: 'Professional tier not found',
      });
      return;
    }

    // Generate license
    const licenseId = uuidv4();
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = BETA_EXPIRATION_DATE;
    const expiresAtTimestamp = Math.floor(expiresAt.getTime() / 1000);

    // Build feature map for JWT
    const featureMap: Record<string, boolean> = {};
    for (const feature of professionalTier.features) {
      featureMap[feature] = true;
    }

    // Build JWT payload
    const payload: LicensePayload = {
      sub: licenseId,
      iss: 'notely-license-service',
      iat: issuedAt,
      exp: expiresAtTimestamp,
      type: 'subscription',
      productType: 'desktop',
      userId,
      features: featureMap,
      limits: { concurrent_clients: 3 },
    };

    // Sign the license
    const privateKey = getPrivateKey();
    const signedToken = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    const licenseKey = formatLicenseKey('desktop', signedToken);

    // Create license record
    const betaNotes = notes
      ? `Beta Program: ${notes}`
      : `Beta Program enrollment - expires ${expiresAt.toISOString().split('T')[0]}`;

    const license = await licenseRepository.create(
      {
        license_key: licenseKey,
        license_type: 'desktop',
        organization_id: null,
        user_id: userId,
        features: professionalTier.features,
        limits: { concurrent_clients: 3 },
        issued_at: new Date(issuedAt * 1000),
        expires_at: expiresAt,
        revoked_at: null,
        revocation_reason: null,
        hardware_id: null,
        issued_by: issuedBy,
        notes: betaNotes,
        tier_id: PROFESSIONAL_TIER_ID,
        grant_type: 'beta',  // Mark as beta grant
      },
      { id: licenseId }
    );

    logger.info('Beta license created successfully', {
      licenseId,
      userId,
      expiresAt: expiresAt.toISOString(),
    });

    res.status(201).json({
      success: true,
      message: 'Beta access enabled',
      license: {
        id: license.id,
        userId,
        tierKey: 'professional',
        tierName: professionalTier.display_name,
        features: professionalTier.features,
        issuedAt: new Date(issuedAt * 1000).toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error enabling beta access', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Failed to enable beta access',
    });
  }
}

/**
 * Disable beta access for a user
 * Revokes their beta license
 *
 * @route POST /api/license/admin/beta/disable
 * @access Admin only
 */
export async function disableBeta(req: Request, res: Response): Promise<void> {
  try {
    const validationResult = disableBetaSchema.safeParse(req.body);

    if (!validationResult.success) {
      logger.warn('Beta disable validation failed', {
        errors: validationResult.error.errors,
      });
      res.status(400).json({
        success: false,
        error: 'validation_error',
        details: validationResult.error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
      return;
    }

    const { userId, reason } = validationResult.data;

    logger.info('Disabling beta access', { userId });

    // Find active beta license
    const existingLicenses = await licenseRepository.findByUser(userId);
    const activeBetaLicense = existingLicenses.find(
      (l) =>
        l.grant_type === 'beta' &&
        !l.revoked_at &&
        (!l.expires_at || new Date(l.expires_at) > new Date())
    );

    if (!activeBetaLicense) {
      logger.warn('No active beta license found', { userId });
      res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'User does not have an active beta license',
      });
      return;
    }

    // Revoke the license
    const revocationReason = reason || 'Beta access disabled by admin';
    await licenseRepository.revoke(activeBetaLicense.id, revocationReason);

    logger.info('Beta license revoked', {
      licenseId: activeBetaLicense.id,
      userId,
      reason: revocationReason,
    });

    res.status(200).json({
      success: true,
      message: 'Beta access disabled',
      license: {
        id: activeBetaLicense.id,
        revokedAt: new Date().toISOString(),
        reason: revocationReason,
      },
    });
  } catch (error) {
    logger.error('Error disabling beta access', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Failed to disable beta access',
    });
  }
}

/**
 * Get license status for a user
 * Returns the user's current active license (any type)
 *
 * @route GET /api/license/admin/user/:userId/status
 * @access Admin only
 */
export async function getUserLicenseStatus(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params;

    if (!userId || !z.string().uuid().safeParse(userId).success) {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Valid user ID is required',
      });
      return;
    }

    logger.debug('Getting license status', { userId });

    // Find all licenses for user
    const existingLicenses = await licenseRepository.findByUser(userId);

    // Find active license (not revoked, not expired)
    const activeLicense = existingLicenses.find(
      (l) => !l.revoked_at && (!l.expires_at || new Date(l.expires_at) > new Date())
    );

    if (activeLicense) {
      const tier = await tierRepository.getByIdWithFeatures(activeLicense.tier_id);
      const isBeta = activeLicense.grant_type === 'beta';

      res.status(200).json({
        success: true,
        hasLicense: true,
        license: {
          id: activeLicense.id,
          tierKey: tier?.tier_key || 'free',      // Real tier key (e.g., 'professional')
          tierName: tier?.display_name || 'Free', // Real tier name (e.g., 'Professional')
          grantType: activeLicense.grant_type,    // How the license was acquired
          isBeta,                                  // Convenience flag for beta licenses
          paymentStatus: activeLicense.payment_status,
          features: tier?.features || activeLicense.features,
          issuedAt: activeLicense.issued_at,
          expiresAt: activeLicense.expires_at,
          daysRemaining: activeLicense.expires_at
            ? Math.max(0, Math.ceil((new Date(activeLicense.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
            : null,
        },
      });
    } else {
      res.status(200).json({
        success: true,
        hasLicense: false,
        license: null,
      });
    }
  } catch (error) {
    logger.error('Error getting license status', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Failed to get license status',
    });
  }
}

/**
 * Get ALL licenses for a user (active, revoked, expired) with tier info
 *
 * @route GET /api/license/admin/user/:userId/licenses
 * @access Admin or Support (read-only)
 */
export async function getUserLicenses(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params;

    if (!userId || !z.string().uuid().safeParse(userId).success) {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Valid user ID is required',
      });
      return;
    }

    logger.debug('Getting all licenses for user', { userId });

    const licenses = await licenseRepository.findByUserWithTiers(userId);

    const now = new Date();
    const mapped = licenses.map((l) => {
      const isRevoked = !!l.revoked_at;
      const isExpired = !isRevoked && !!l.expires_at && new Date(l.expires_at) <= now;
      const isActive = !isRevoked && !isExpired;

      return {
        id: l.id,
        licenseType: l.license_type,
        tierKey: l.tier_key || 'free',
        tierName: l.tier_name || 'Free',
        grantType: l.grant_type || 'purchase',
        status: isRevoked ? 'revoked' : isExpired ? 'expired' : 'active',
        issuedAt: l.issued_at,
        expiresAt: l.expires_at,
        revokedAt: l.revoked_at,
        revocationReason: l.revocation_reason,
        features: l.features,
        notes: l.notes,
        daysRemaining: isActive && l.expires_at
          ? Math.max(0, Math.ceil((new Date(l.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
          : null,
      };
    });

    res.status(200).json({
      success: true,
      licenses: mapped,
    });
  } catch (error) {
    logger.error('Error getting user licenses', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Failed to get user licenses',
    });
  }
}

/**
 * Revoke all active licenses for a user
 *
 * @route POST /api/license/admin/user/:userId/revoke-all
 * @access Admin only
 */
export async function revokeAllUserLicenses(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { reason } = req.body || {};

    if (!userId || !z.string().uuid().safeParse(userId).success) {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Valid user ID is required',
      });
      return;
    }

    logger.info('Revoking all licenses for user', { userId });

    const revokedCount = await licenseRepository.revokeAllForUser(
      userId,
      reason || 'All licenses revoked by admin'
    );

    if (revokedCount === 0) {
      res.status(200).json({
        success: true,
        message: 'No active licenses to revoke',
        revokedCount: 0,
      });
      return;
    }

    logger.info('All licenses revoked for user', { userId, revokedCount });

    res.status(200).json({
      success: true,
      message: `Revoked ${revokedCount} license(s)`,
      revokedCount,
    });
  } catch (error) {
    logger.error('Error revoking all user licenses', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Failed to revoke licenses',
    });
  }
}

/**
 * Schema for reissuing beta access
 */
const reissueBetaSchema = z.object({
  product: z.enum(['desktop', 'notely-ai']).default('desktop'),
  notes: z.string().max(500).optional(),
  email: z.string().email().optional(),
});

/**
 * Reissue a beta license for a user
 * Revokes ALL existing active licenses (desktop + notely-ai) then creates a fresh beta license
 *
 * @route POST /api/license/admin/user/:userId/reissue-beta
 * @access Admin only
 */
export async function reissueBetaLicense(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params;

    if (!userId || !z.string().uuid().safeParse(userId).success) {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Valid user ID is required',
      });
      return;
    }

    const validationResult = reissueBetaSchema.safeParse(req.body || {});
    if (!validationResult.success) {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        details: validationResult.error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
      return;
    }

    const { product, notes, email: bodyEmail } = validationResult.data;
    const issuedBy = req.authContext?.userId;

    if (!issuedBy) {
      res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Missing issuer context',
      });
      return;
    }

    // Check if userId is a registered user (user_credentials) or a beta signup ID
    const pool = getPool();
    const userCheck = await pool.query<{ id: string; first_name: string | null; email: string }>(
      'SELECT id, first_name, email FROM global_auth.user_credentials WHERE id = $1',
      [userId]
    );
    const registeredUser = userCheck.rows[0] || null;

    // Desktop licenses require a registered user (FK constraint)
    if (product === 'desktop' && !registeredUser) {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Desktop licenses can only be issued to registered users',
      });
      return;
    }

    // For non-registered users (beta signups), email is required
    if (!registeredUser && !bodyEmail) {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Email is required when issuing licenses for non-registered users',
      });
      return;
    }

    const effectiveUserId = registeredUser ? userId : null;
    const effectiveEmail = registeredUser ? registeredUser.email : bodyEmail!;
    const effectiveFirstName = registeredUser ? registeredUser.first_name : null;

    logger.info('Reissuing beta license', { userId, effectiveUserId, product, issuedBy });

    // Step 1: Revoke ALL active licenses for this user (no-op if no licenses exist)
    const revokedCount = registeredUser
      ? await licenseRepository.revokeAllForUser(userId, 'Revoked for beta reissue by admin')
      : 0;

    logger.info('Revoked existing licenses for reissue', { userId, revokedCount });

    // Step 2: Get Professional tier with features
    const professionalTier = await tierRepository.getByKeyWithFeatures('professional');
    if (!professionalTier) {
      logger.error('Professional tier not found');
      res.status(500).json({
        success: false,
        error: 'configuration_error',
        message: 'Professional tier not found',
      });
      return;
    }

    // Step 3: Create new beta license
    const licenseId = uuidv4();
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = BETA_EXPIRATION_DATE;

    // Build feature map
    const featureMap: Record<string, boolean> = {};
    for (const feature of professionalTier.features) {
      featureMap[feature] = true;
    }

    if (product === 'desktop') {
      // JWT-based desktop license
      const expiresAtTimestamp = Math.floor(expiresAt.getTime() / 1000);
      const payload: LicensePayload = {
        sub: licenseId,
        iss: 'notely-license-service',
        iat: issuedAt,
        exp: expiresAtTimestamp,
        type: 'subscription',
        productType: 'desktop',
        userId,
        features: featureMap,
        limits: { concurrent_clients: 3 },
      };

      const privateKey = getPrivateKey();
      const signedToken = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
      const licenseKey = formatLicenseKey('desktop', signedToken);

      const betaNotes = notes
        ? `Beta Reissue: ${notes}`
        : `Beta Reissue - expires ${expiresAt.toISOString().split('T')[0]} (replaced ${revokedCount} prior license(s))`;

      const license = await licenseRepository.create(
        {
          license_key: licenseKey,
          license_type: 'desktop',
          organization_id: null,
          user_id: userId,
          features: professionalTier.features,
          limits: { concurrent_clients: 3 },
          issued_at: new Date(issuedAt * 1000),
          expires_at: expiresAt,
          revoked_at: null,
          revocation_reason: null,
          hardware_id: null,
          issued_by: issuedBy,
          notes: betaNotes,
          tier_id: PROFESSIONAL_TIER_ID,
          grant_type: 'beta',
        },
        { id: licenseId }
      );

      logger.info('Beta desktop license reissued', { licenseId, userId });

      res.status(201).json({
        success: true,
        message: `Beta license reissued (revoked ${revokedCount} prior license(s))`,
        revokedCount,
        license: {
          id: license.id,
          licenseType: 'desktop',
          tierKey: 'professional',
          tierName: professionalTier.display_name,
          features: professionalTier.features,
          issuedAt: new Date(issuedAt * 1000).toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });
    } else {
      // Opaque key for notely-ai license
      const { generateOpaqueKey } = await import('../../utils/licenseFormatter');
      const licenseKey = generateOpaqueKey();

      // Look up notely-ai tier
      const aiTier = await tierRepository.getByKey('notely-ai');
      const tierId = aiTier?.id || PROFESSIONAL_TIER_ID;

      const betaNotes = notes
        ? `Beta AI Reissue: ${notes}`
        : `Beta AI Reissue - expires ${expiresAt.toISOString().split('T')[0]} (replaced ${revokedCount} prior license(s))`;

      const license = await licenseRepository.create(
        {
          license_key: licenseKey,
          license_type: 'notely-ai',
          organization_id: null,
          user_id: effectiveUserId,
          features: professionalTier.features,
          limits: {},
          issued_at: new Date(issuedAt * 1000),
          expires_at: expiresAt,
          revoked_at: null,
          revocation_reason: null,
          hardware_id: null,
          issued_by: issuedBy,
          notes: betaNotes,
          tier_id: tierId,
          grant_type: 'beta',
          activation_limit: 1,
        },
        { id: licenseId }
      );

      logger.info('Beta AI license reissued', { licenseId, userId: effectiveUserId, email: effectiveEmail });

      // Send the license key via email through the support service
      let emailSent = false;
      if (config.supportServiceUrl) {
        try {
          const emailResponse = await fetch(
            `${config.supportServiceUrl}/api/support/admin/beta-signups/internal/send-license-email`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-internal-service': 'license',
              },
              body: JSON.stringify({
                firstName: effectiveFirstName || 'User',
                email: effectiveEmail,
                licenseKey,
                expiresAt: 'April 30, 2026',
                product: 'notely-ai',
                adminBcc: true,
              }),
            }
          );

          if (emailResponse.ok) {
            emailSent = true;
            logger.info('License email queued via support service', { userId: effectiveUserId, email: effectiveEmail });
          } else {
            logger.warn('Support service returned non-OK for email send', {
              status: emailResponse.status,
            });
          }
        } catch (emailError) {
          logger.warn('Failed to send license email via support service', {
            error: emailError instanceof Error ? emailError.message : String(emailError),
          });
        }
      }

      res.status(201).json({
        success: true,
        message: `Beta AI license reissued (revoked ${revokedCount} prior license(s))`,
        revokedCount,
        emailSent,
        license: {
          id: license.id,
          licenseType: 'notely-ai',
          licenseKey,
          tierKey: aiTier?.tier_key || 'notely-ai',
          tierName: aiTier?.display_name || 'Notely AI',
          features: professionalTier.features,
          issuedAt: new Date(issuedAt * 1000).toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });
    }
  } catch (error) {
    logger.error('Error reissuing beta license', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Failed to reissue beta license',
    });
  }
}

/**
 * Reset all activations for a license
 * Deactivates all active activations so the user can re-activate with their existing key.
 *
 * @route POST /api/license/admin/licenses/:id/reset-activations
 * @access Admin only
 */
export async function resetLicenseActivations(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id || !z.string().uuid().safeParse(id).success) {
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Valid license ID is required',
      });
      return;
    }

    // Verify the license exists
    const license = await licenseRepository.findById(id);
    if (!license) {
      res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'License not found',
      });
      return;
    }

    logger.info('Resetting activations for license', { licenseId: id });

    const result = await resetActivations(id);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error?.code || 'internal_error',
        message: result.error?.message || 'Failed to reset activations',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Reset ${result.deactivatedCount} activation(s)`,
      deactivatedCount: result.deactivatedCount,
    });
  } catch (error) {
    logger.error('Error resetting license activations', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: process.env.NODE_ENV === 'development' ? errorMessage : 'Failed to reset activations',
    });
  }
}
