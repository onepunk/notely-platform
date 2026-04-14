/**
 * Activation Service
 *
 * Business logic for license activation, revalidation, and deactivation.
 * Handles email binding, activation limits, and offline token generation.
 */

import jwt from 'jsonwebtoken';
import { activationRepository, licenseRepository, tierRepository } from '../data';
import { ActivationRepository, type LicenseActivation } from '../data/ActivationRepository';
import { parseLicenseKey } from '../utils/licenseFormatter';
import { getPrivateKey } from './keyManager';
import { logger } from '../utils/logger';
import { config } from '../config/env';

/**
 * Activation request parameters
 */
export interface ActivateParams {
  licenseKey: string;
  email: string;
  platform?: string;
  appVersion?: string;
  clientIp?: string;
}

/**
 * Successful activation result
 */
export interface ActivationResult {
  success: true;
  activationId: string;
  email: string;
  tierKey: string;
  tierName: string;
  features: Record<string, boolean>;
  offlineToken: string;
  offlineGraceDeadline: string;
  nextRequiredValidation: string | null;
}

/**
 * Activation error codes
 */
export type ActivationErrorCode =
  | 'INVALID_KEY'
  | 'INVALID_KEY_TYPE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_ACTIVATED'
  | 'ACTIVATION_LIMIT'
  | 'INTERNAL_ERROR';

/**
 * Activation error result
 */
export interface ActivationError {
  success: false;
  error: {
    code: ActivationErrorCode;
    message: string;
    existingEmail?: string;
  };
}

/**
 * Revalidation request parameters
 */
export interface RevalidateParams {
  activationId: string;
  platform?: string;
  appVersion?: string;
  clientIp?: string;
}

/**
 * Revalidation result
 */
export interface RevalidationResult {
  success: boolean;
  offlineToken?: string;
  offlineGraceDeadline?: string;
  nextRequiredValidation?: string | null;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Offline token JWT payload
 */
interface OfflineTokenPayload {
  sub: string;           // Activation ID
  iss: 'notely-licensing';
  type: 'offline-token';
  licenseId: string;
  email: string;
  emailHash: string;
  tierKey: string;
  features: Record<string, boolean>;
  activatedAt: number;
  offlineGraceDeadline: number;
  exp: number;
}

/**
 * Activate a license with email binding
 */
export async function activateLicense(
  params: ActivateParams
): Promise<ActivationResult | ActivationError> {
  const { licenseKey, email, platform, appVersion, clientIp } = params;

  try {
    // Parse and validate license key format
    let parsedKey;
    try {
      parsedKey = parseLicenseKey(licenseKey);
    } catch {
      return {
        success: false,
        error: {
          code: 'INVALID_KEY',
          message: 'Invalid license key format',
        },
      };
    }

    // Only na- (Notely AI) licenses support activation
    if (parsedKey.type !== 'NOTELY_AI') {
      return {
        success: false,
        error: {
          code: 'INVALID_KEY_TYPE',
          message: 'This license key does not support activation. Only Notely AI (na-) licenses require activation.',
        },
      };
    }

    // Find the license in the database
    const license = await licenseRepository.findByKey(licenseKey);
    if (!license) {
      return {
        success: false,
        error: {
          code: 'INVALID_KEY',
          message: 'License key not found',
        },
      };
    }

    // Check if license is revoked
    if (license.revoked_at) {
      return {
        success: false,
        error: {
          code: 'REVOKED',
          message: 'This license has been revoked',
        },
      };
    }

    // Check if license is expired
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return {
        success: false,
        error: {
          code: 'EXPIRED',
          message: 'This license has expired',
        },
      };
    }

    // Check if this email is already activated for this license
    const existingActivation = await activationRepository.findByLicenseAndEmail(
      license.id,
      email
    );

    if (existingActivation && !existingActivation.deactivated_at) {
      // Already activated with same email - return success (re-activation)
      logger.info('Re-activating existing activation', {
        activationId: existingActivation.id,
        licenseId: license.id,
      });

      return await buildActivationResult(existingActivation, license);
    }

    // Check activation limit
    const activeCount = await activationRepository.countActiveByLicense(license.id);
    const activationLimit = license.activation_limit || 1;

    if (activeCount >= activationLimit) {
      // At limit - check if it's a different email
      const firstActivation = await activationRepository.findFirstActiveByLicense(license.id);
      const maskedEmail = firstActivation
        ? ActivationRepository.maskEmail(firstActivation.user_email)
        : undefined;

      return {
        success: false,
        error: {
          code: 'ACTIVATION_LIMIT',
          message: `This license has reached its activation limit (${activationLimit}). Deactivate an existing device to activate a new one.`,
          existingEmail: maskedEmail,
        },
      };
    }

    // Offline grace deadline = license expiry. For perpetual licenses, use 10 years from now.
    const offlineGraceDeadline = license.expires_at
      ? new Date(license.expires_at)
      : new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

    // Create new activation
    const activation = await activationRepository.create({
      license_id: license.id,
      user_email: email,
      platform,
      app_version: appVersion,
      activation_ip: clientIp,
      offline_grace_deadline: offlineGraceDeadline,
    });

    // Update activation count on license
    await updateActivationCount(license.id);

    logger.info('License activated successfully', {
      activationId: activation.id,
      licenseId: license.id,
      email: ActivationRepository.maskEmail(email),
      platform,
    });

    // Notify support service if this is a beta invitation license
    if (license.notes && license.notes.includes('Beta invitation') && config.supportServiceUrl) {
      notifyBetaConversion(email, license.id).catch(() => {});
    }

    return await buildActivationResult(activation, license);
  } catch (error) {
    logger.error('Error activating license', { error, licenseKey: licenseKey.substring(0, 20) });
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred during activation',
      },
    };
  }
}

/**
 * Notify the support service that a beta invitation license has been activated,
 * so the beta signup status can move from 'invite_sent' to 'converted'.
 * Failures are logged but never block the activation response.
 */
async function notifyBetaConversion(email: string, licenseId: string): Promise<void> {
  try {
    const url = `${config.supportServiceUrl}/api/support/admin/beta-signups/internal/mark-converted`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service': 'license',
      },
      body: JSON.stringify({ email }),
    });

    if (response.ok) {
      const data = await response.json() as { converted?: boolean };
      logger.info('Beta signup conversion notified', { licenseId, converted: data.converted });
    } else {
      logger.warn('Failed to notify beta signup conversion', {
        licenseId,
        status: response.status,
      });
    }
  } catch (error) {
    logger.warn('Error notifying beta signup conversion', {
      licenseId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Revalidate an existing activation (periodic online check)
 */
export async function revalidateLicense(
  params: RevalidateParams
): Promise<RevalidationResult> {
  const { activationId, platform, appVersion } = params;

  try {
    const activation = await activationRepository.findByIdWithLicense(activationId);

    if (!activation) {
      return {
        success: false,
        error: {
          code: 'ACTIVATION_NOT_FOUND',
          message: 'Activation not found',
        },
      };
    }

    if (activation.deactivated_at) {
      return {
        success: false,
        error: {
          code: 'DEACTIVATED',
          message: 'This activation has been deactivated',
        },
      };
    }

    if (activation.revoked_at) {
      return {
        success: false,
        error: {
          code: 'REVOKED',
          message: 'This license has been revoked',
        },
      };
    }

    if (activation.expires_at && new Date(activation.expires_at) < new Date()) {
      return {
        success: false,
        error: {
          code: 'EXPIRED',
          message: 'This license has expired',
        },
      };
    }

    // Offline grace deadline = license expiry. For perpetual licenses, use 10 years from now.
    const offlineGraceDeadline = activation.expires_at
      ? new Date(activation.expires_at)
      : new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

    // Update validation timestamp
    await activationRepository.updateValidation(activationId, offlineGraceDeadline);

    // Update client info if provided
    if (platform && appVersion) {
      await activationRepository.updateClientInfo(activationId, platform, appVersion);
    }

    // Get tier information for offline token
    let tierKey = 'free';
    if (activation.tier_id) {
      const tier = await tierRepository.getById(activation.tier_id);
      if (tier) {
        tierKey = tier.tier_key;
      }
    }

    // Generate new offline token
    const offlineToken = await generateOfflineToken({
      id: activation.id,
      license_id: activation.license_id,
      user_email: activation.user_email,
      user_email_hash: activation.user_email_hash,
      activated_at: activation.activated_at,
      offline_grace_deadline: offlineGraceDeadline,
      tier_key: tierKey,
      features: activation.features || [],
    });

    logger.info('License revalidated successfully', {
      activationId,
      licenseId: activation.license_id,
    });

    return {
      success: true,
      offlineToken,
      offlineGraceDeadline: offlineGraceDeadline.toISOString(),
      nextRequiredValidation: null,
    };
  } catch (error) {
    logger.error('Error revalidating license', { error, activationId });
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred during revalidation',
      },
    };
  }
}

/**
 * Deactivate a license activation
 */
export async function deactivateLicense(
  activationId: string
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  try {
    const activation = await activationRepository.findById(activationId);

    if (!activation) {
      return {
        success: false,
        error: {
          code: 'ACTIVATION_NOT_FOUND',
          message: 'Activation not found',
        },
      };
    }

    if (activation.deactivated_at) {
      return {
        success: false,
        error: {
          code: 'ALREADY_DEACTIVATED',
          message: 'This activation is already deactivated',
        },
      };
    }

    await activationRepository.deactivate(activationId);
    await updateActivationCount(activation.license_id);

    logger.info('License deactivated successfully', {
      activationId,
      licenseId: activation.license_id,
    });

    return { success: true };
  } catch (error) {
    logger.error('Error deactivating license', { error, activationId });
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred during deactivation',
      },
    };
  }
}

/**
 * Reset all activations for a license (admin debugging tool)
 * Deactivates all active activations and syncs the activation count to 0.
 */
export async function resetActivations(
  licenseId: string
): Promise<{ success: boolean; deactivatedCount: number; error?: { code: string; message: string } }> {
  try {
    const deactivatedCount = await activationRepository.deactivateAllByLicense(licenseId);
    await updateActivationCount(licenseId);

    logger.info('All activations reset for license', { licenseId, deactivatedCount });

    return { success: true, deactivatedCount };
  } catch (error) {
    logger.error('Error resetting activations', { error, licenseId });
    return {
      success: false,
      deactivatedCount: 0,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred while resetting activations',
      },
    };
  }
}

/**
 * Build activation result with offline token
 */
async function buildActivationResult(
  activation: LicenseActivation,
  license: { id: string; tier_id?: string; expires_at?: Date | string | null }
): Promise<ActivationResult> {
  // Get tier information
  let tierKey = 'free';
  let tierName = 'Free';
  let featuresArray: string[] = [];

  const tierId = license.tier_id;
  if (tierId) {
    const tier = await tierRepository.getById(tierId);
    if (tier) {
      tierKey = tier.tier_key;
      tierName = tier.display_name || tier.tier_key.charAt(0).toUpperCase() + tier.tier_key.slice(1);
    }
    featuresArray = await tierRepository.getFeaturesForTierById(tierId);
  }

  const featuresRecord: Record<string, boolean> = {};
  for (const feature of featuresArray) {
    featuresRecord[feature] = true;
  }

  // Offline grace deadline = license expiry. For perpetual licenses, use 10 years from now.
  const offlineGraceDeadline = license.expires_at
    ? new Date(license.expires_at)
    : new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

  // Generate offline token
  const offlineToken = await generateOfflineToken({
    id: activation.id,
    license_id: license.id,
    user_email: activation.user_email,
    user_email_hash: activation.user_email_hash,
    activated_at: activation.activated_at,
    offline_grace_deadline: offlineGraceDeadline,
    tier_key: tierKey,
    features: featuresArray,
  });

  return {
    success: true,
    activationId: activation.id,
    email: activation.user_email,
    tierKey,
    tierName,
    features: featuresRecord,
    offlineToken,
    offlineGraceDeadline: offlineGraceDeadline.toISOString(),
    nextRequiredValidation: null,
  };
}

/**
 * Generate a signed offline token JWT
 */
async function generateOfflineToken(params: {
  id: string;
  license_id: string;
  user_email: string;
  user_email_hash: string;
  activated_at: Date;
  offline_grace_deadline: Date;
  tier_key: string;
  features: string[];
}): Promise<string> {
  const privateKey = getPrivateKey();

  const featuresRecord: Record<string, boolean> = {};
  for (const feature of params.features) {
    featuresRecord[feature] = true;
  }

  const payload: OfflineTokenPayload = {
    sub: params.id,
    iss: 'notely-licensing',
    type: 'offline-token',
    licenseId: params.license_id,
    email: params.user_email,
    emailHash: params.user_email_hash,
    tierKey: params.tier_key,
    features: featuresRecord,
    activatedAt: Math.floor(new Date(params.activated_at).getTime() / 1000),
    offlineGraceDeadline: Math.floor(params.offline_grace_deadline.getTime() / 1000),
    exp: Math.floor(params.offline_grace_deadline.getTime() / 1000),
  };

  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

/**
 * Update the activation_count on a license
 */
async function updateActivationCount(licenseId: string): Promise<void> {
  const pool = (await import('../lib/database')).getPool();
  await pool.query(
    `UPDATE licensing.licenses
     SET activation_count = (
       SELECT COUNT(*) FROM licensing.license_activations
       WHERE license_id = $1 AND deactivated_at IS NULL
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [licenseId]
  );
}
