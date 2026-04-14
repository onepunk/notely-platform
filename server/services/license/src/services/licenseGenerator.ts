/**
 * License Generator Service
 *
 * Generates cryptographically signed license keys for Notely deployments.
 * Supports both portal and desktop license types with comprehensive validation.
 * Saves license records to the database.
 */

import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import * as keyManager from './keyManager';
import { licenseRepository, tierRepository } from '../data';
import { formatLicenseKey as formatKey, generateOpaqueKey } from '../utils/licenseFormatter';
import { logger } from '../utils/logger';

/**
 * Parameters for generating a license
 */
export interface GenerateLicenseParams {
  /** License type: portal, desktop, or notely-ai */
  type: 'portal' | 'desktop' | 'notely-ai';

  /** Organization ID - Required for portal licenses */
  organizationId?: string;

  /** User ID - Required for desktop and notely-ai licenses */
  userId?: string;

  /** User email - Required for notely-ai licenses (for activation binding) */
  userEmail?: string;

  /** Hardware ID - Required for portal licenses, forbidden for desktop/notely-ai licenses */
  hardwareId?: string;

  /** List of enabled features */
  features: string[];

  /** Tier ID (UUID) - Required. FK to licensing.tiers table */
  tierId: string;

  /** License limits (e.g., concurrent_clients) */
  limits: {
    concurrent_clients?: number;
    [key: string]: number | undefined;
  };

  /** Activation limit - For notely-ai licenses, how many email activations allowed (default: 1) */
  activationLimit?: number;

  /** Offline grace days - For notely-ai licenses, how many days offline allowed (default: 30) */
  offlineGraceDays?: number;

  /** Revalidation interval in hours - For notely-ai licenses (default: 168 = 7 days) */
  revalidationIntervalHours?: number;

  /** License expiration date (optional, if not provided, license doesn't expire) */
  expiresAt?: Date;

  /** User/admin who issued the license (for audit trail) */
  issuedBy?: string;

  /** Optional notes about the license */
  notes?: string;
}

/**
 * Result of license generation
 */
export interface GenerateLicenseResult {
  /** The formatted license key */
  licenseKey: string;

  /** The database ID of the license record */
  licenseId: string;

  /** The JWT ID (jti claim) */
  jti: string;
}

/**
 * JWT payload structure for license tokens
 */
interface LicenseJwtPayload {
  /** Issuer - always 'notely-licensing' */
  iss: string;

  /** Subject - org:{organizationId} for portal, user:{userId} for desktop/notely-ai */
  sub: string;

  /** JWT ID - unique identifier for this license */
  jti: string;

  /** License type */
  type: 'portal' | 'desktop' | 'notely-ai';

  /** License tier key (e.g., 'free', 'starter', 'professional', 'enterprise', 'notely-ai') */
  tierKey?: string;

  /** Hardware ID (only for portal licenses) */
  hwid?: string;

  /** Enabled features */
  features: string[];

  /** License limits */
  limits: {
    concurrent_clients?: number;
    [key: string]: number | undefined;
  };

  /** Activation limit for notely-ai licenses */
  activation_limit?: number;

  /** Offline grace days for notely-ai licenses */
  offline_grace_days?: number;

  /** Revalidation interval in hours for notely-ai licenses */
  revalidation_interval_hours?: number;

  /** Issued at timestamp in seconds */
  iat: number;

  /** Not before timestamp in seconds */
  nbf: number;

  /** Expiration timestamp in seconds (optional) */
  exp?: number;
}

/**
 * Validation error class for license parameter validation
 */
export class LicenseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseValidationError';
  }
}

/**
 * Validates license generation parameters
 *
 * @param params - License generation parameters to validate
 * @throws {LicenseValidationError} If validation fails
 */
function validateLicenseParams(params: GenerateLicenseParams): void {
  // Validate type
  if (!params.type || (params.type !== 'portal' && params.type !== 'desktop' && params.type !== 'notely-ai')) {
    throw new LicenseValidationError(
      'License type must be "portal", "desktop", or "notely-ai"'
    );
  }

  // Validate portal license requirements
  if (params.type === 'portal') {
    if (!params.organizationId) {
      throw new LicenseValidationError(
        'Portal licenses MUST have organizationId'
      );
    }

    if (!params.hardwareId) {
      throw new LicenseValidationError(
        'Portal licenses MUST have hardwareId'
      );
    }

    if (params.userId) {
      throw new LicenseValidationError(
        'Portal licenses cannot have userId (use organizationId instead)'
      );
    }
  }

  // Validate desktop license requirements
  if (params.type === 'desktop') {
    if (!params.userId) {
      throw new LicenseValidationError(
        'Desktop licenses MUST have userId'
      );
    }

    if (params.hardwareId) {
      throw new LicenseValidationError(
        'Desktop licenses MUST NOT have hardwareId'
      );
    }

    if (params.organizationId) {
      throw new LicenseValidationError(
        'Desktop licenses cannot have organizationId (use userId instead)'
      );
    }
  }

  // Validate notely-ai license requirements
  if (params.type === 'notely-ai') {
    if (!params.userId) {
      throw new LicenseValidationError(
        'Notely AI licenses MUST have userId'
      );
    }

    if (params.hardwareId) {
      throw new LicenseValidationError(
        'Notely AI licenses MUST NOT have hardwareId'
      );
    }

    if (params.organizationId) {
      throw new LicenseValidationError(
        'Notely AI licenses cannot have organizationId (use userId instead)'
      );
    }

    // Validate activation limit if provided
    if (params.activationLimit !== undefined && (params.activationLimit < 1 || params.activationLimit > 100)) {
      throw new LicenseValidationError(
        'activationLimit must be between 1 and 100'
      );
    }
  }

  // Validate features array
  if (!Array.isArray(params.features)) {
    throw new LicenseValidationError(
      'Features must be an array of strings'
    );
  }

  if (params.features.length === 0) {
    throw new LicenseValidationError(
      'At least one feature must be specified'
    );
  }

  // Validate limits object
  if (!params.limits || typeof params.limits !== 'object') {
    throw new LicenseValidationError(
      'Limits must be an object'
    );
  }

  // Validate expiration date if provided
  if (params.expiresAt && !(params.expiresAt instanceof Date)) {
    throw new LicenseValidationError(
      'expiresAt must be a Date object'
    );
  }

  if (params.expiresAt && params.expiresAt.getTime() <= Date.now()) {
    throw new LicenseValidationError(
      'expiresAt must be a future date'
    );
  }
}

/**
 * Creates a JWT payload from license parameters
 *
 * @param params - Validated license generation parameters
 * @param jti - JWT ID to use (allows external specification for database consistency)
 * @param tierKey - Tier key resolved from the database (for offline validation)
 * @returns JWT payload ready for signing
 */
function createJwtPayload(params: GenerateLicenseParams, jti: string, tierKey?: string): LicenseJwtPayload {
  const now = Math.floor(Date.now() / 1000);

  // Build the subject string based on license type
  const subject = params.type === 'portal'
    ? `org:${params.organizationId}`
    : `user:${params.userId}`;

  // Build base payload
  const payload: LicenseJwtPayload = {
    iss: 'notely-licensing',
    sub: subject,
    jti,
    type: params.type,
    features: params.features,
    limits: params.limits,
    iat: now,
    nbf: now, // Not before - valid immediately
  };

  // Add tierKey for offline validation
  // This allows clients to determine feature access without database lookup
  if (tierKey) {
    payload.tierKey = tierKey;
  }

  // Add hardware ID for portal licenses
  if (params.type === 'portal' && params.hardwareId) {
    payload.hwid = params.hardwareId;
  }

  // Add notely-ai specific fields
  if (params.type === 'notely-ai') {
    // Activation limit (default: 1)
    payload.activation_limit = params.activationLimit ?? 1;
    // Offline grace days (default: 30)
    payload.offline_grace_days = params.offlineGraceDays ?? 30;
    // Revalidation interval in hours (default: 168 = 7 days)
    payload.revalidation_interval_hours = params.revalidationIntervalHours ?? 168;
  }

  // Add expiration if provided
  if (params.expiresAt) {
    payload.exp = Math.floor(params.expiresAt.getTime() / 1000);
  }

  return payload;
}

/**
 * Generates a cryptographically signed license key and saves it to the database
 *
 * @param params - License generation parameters
 * @returns Promise resolving to license key, database ID, and JWT ID
 * @throws {LicenseValidationError} If parameters are invalid
 * @throws {Error} If key manager is not initialized, signing fails, or database save fails
 *
 * @example
 * // Generate a portal license
 * const result = await generateLicense({
 *   type: 'portal',
 *   organizationId: 'org-123',
 *   hardwareId: 'hw-abc-def',
 *   features: ['meetings', 'recording'],
 *   tier: 'enterprise',
 *   limits: { concurrent_clients: 100 },
 *   expiresAt: new Date('2025-12-31'),
 *   issuedBy: 'admin@example.com',
 *   notes: 'Annual enterprise license'
 * });
 * // Returns: { licenseKey: 'np-...', licenseId: 'uuid', jti: 'uuid' }
 *
 * @example
 * // Generate a desktop license
 * const result = await generateLicense({
 *   type: 'desktop',
 *   userId: 'user-456',
 *   features: ['offline-mode', 'sync'],
 *   tier: 'professional',
 *   limits: { concurrent_clients: 1 },
 *   expiresAt: new Date('2025-12-31'),
 *   issuedBy: 'admin@example.com'
 * });
 */
export async function generateLicense(params: GenerateLicenseParams): Promise<GenerateLicenseResult> {
  // Validate parameters
  validateLicenseParams(params);

  // Generate a unique ID for the license record
  const jti = uuidv4();

  let licenseKey: string;

  if (params.type === 'notely-ai') {
    // Generate short opaque key for Notely AI licenses (no JWT)
    licenseKey = generateOpaqueKey();
  } else {
    // Look up tier to get tierKey for offline validation
    let tierKey: string | undefined;
    if (params.tierId) {
      const tier = await tierRepository.getById(params.tierId);
      if (tier) {
        tierKey = tier.tier_key;
      }
    }

    // Create JWT payload with tierKey for offline validation
    const payload = createJwtPayload(params, jti, tierKey);

    // Get private key from key manager
    const privateKey = keyManager.getPrivateKey();

    let token: string;
    try {
      // Sign the JWT with RS256 algorithm
      token = jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
      });
    } catch (error) {
      logger.error('Failed to sign license JWT', { error, params: { type: params.type } });
      if (error instanceof Error) {
        throw new Error(`Failed to sign license token: ${error.message}`);
      }
      throw new Error('Failed to sign license token: Unknown error');
    }

    // Format the license key
    licenseKey = formatKey(params.type, token);
  }

  // Save to database
  try {
    const license = await licenseRepository.create({
      license_key: licenseKey,
      license_type: params.type,
      organization_id: params.organizationId || null,
      user_id: params.userId || null,
      features: params.features,
      limits: params.limits,
      issued_at: new Date(),
      expires_at: params.expiresAt || null,
      revoked_at: null,
      revocation_reason: null,
      hardware_id: params.hardwareId || null,
      issued_by: params.issuedBy || 'system',
      notes: params.notes || null,
      tier_id: params.tierId,  // Required FK to licensing.tiers
    });

    logger.info('License generated successfully', {
      licenseId: license.id,
      type: params.type,
      jti,
      expiresAt: params.expiresAt,
    });

    return {
      licenseKey,
      licenseId: license.id,
      jti,
    };
  } catch (error) {
    logger.error('Failed to save license to database', { error, jti, licenseKey });
    if (error instanceof Error) {
      throw new Error(`Failed to save license to database: ${error.message}`);
    }
    throw new Error('Failed to save license to database: Unknown error');
  }
}

/**
 * Exports for testing purposes
 */
export const _internal = {
  validateLicenseParams,
  createJwtPayload,
};
