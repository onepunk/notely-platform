/**
 * License Validator Service
 *
 * Validates license keys, verifies JWT signatures, checks expiration,
 * enforces hardware binding for portal licenses, and checks revocation status.
 */

import jwt from 'jsonwebtoken';
import * as keyManager from './keyManager';
import { getPool } from '../lib/database';
import { parseLicenseKey, type ParsedLicenseKey } from '../utils/licenseFormatter';
import { licenseRepository } from '../data';

/**
 * Validation result returned by the validator
 */
export interface ValidationResult {
  isValid: boolean;
  features?: string[];
  limits?: { concurrent_clients?: number };
  expiresAt?: Date;
  subject?: string;
  type?: 'portal' | 'desktop' | 'notely-ai';
  offline?: boolean;
  error?: { code: string; message: string };
}

/**
 * JWT payload structure for license tokens
 */
interface LicensePayload {
  sub: string;
  type: 'portal' | 'desktop' | 'notely-ai';
  features: string[];
  limits?: { concurrent_clients?: number };
  hwid?: string;
  offline?: boolean;
  exp: number;
  iat: number;
}

/**
 * Error codes for validation failures
 */
export enum ValidationErrorCode {
  INVALID_FORMAT = 'INVALID_FORMAT',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  LICENSE_EXPIRED = 'LICENSE_EXPIRED',
  MISSING_HWID = 'MISSING_HWID',
  HWID_MISMATCH = 'HWID_MISMATCH',
  LICENSE_REVOKED = 'LICENSE_REVOKED',
}

/**
 * Verify the JWT signature using the public key
 *
 * @param jwtToken - The JWT token to verify
 * @param publicKey - The public key for verification
 * @returns Decoded JWT payload
 * @throws Error if signature verification fails
 */
function verifySignature(jwtToken: string, publicKey: string): LicensePayload {
  try {
    const decoded = jwt.verify(jwtToken, publicKey, {
      algorithms: ['RS256'],
    });

    if (typeof decoded === 'string') {
      throw new Error('Unexpected JWT payload format');
    }

    return decoded as LicensePayload;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error(`JWT signature verification failed: ${error.message}`);
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('JWT token has expired');
    }
    throw error;
  }
}

/**
 * Check if the license has expired
 *
 * @param payload - The decoded JWT payload
 * @returns true if expired, false otherwise
 */
function checkExpiration(payload: LicensePayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now;
}

/**
 * Validate hardware ID binding for portal licenses
 *
 * @param payload - The decoded JWT payload
 * @param currentHardwareId - The current hardware ID to validate against (optional)
 * @returns Error object if validation fails, null otherwise
 */
function checkHardwareBinding(
  payload: LicensePayload,
  currentHardwareId?: string
): { code: string; message: string } | null {
  // Portal licenses MUST have hardware ID
  if (payload.type === 'portal') {
    if (!payload.hwid) {
      return {
        code: ValidationErrorCode.MISSING_HWID,
        message: 'Portal license missing required hardware ID',
      };
    }

    // If currentHardwareId is provided, it must match
    if (currentHardwareId && payload.hwid !== currentHardwareId) {
      return {
        code: ValidationErrorCode.HWID_MISMATCH,
        message: 'Hardware ID does not match license binding',
      };
    }
  }

  // Desktop licenses don't require hardware binding
  return null;
}

/**
 * Check if the license has been revoked in the database
 *
 * @param subject - The license subject (identifier)
 * @returns true if revoked, false otherwise
 */
async function checkRevocation(subject: string): Promise<boolean> {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT revoked_at
       FROM license.licenses
       WHERE subject = $1 AND revoked_at IS NOT NULL`,
      [subject]
    );

    return result.rows.length > 0;
  } catch (error) {
    // If database is unavailable, log the error but don't fail validation
    // This allows offline validation to continue
    console.warn('Database check failed during revocation check:', error);
    return false;
  }
}

/**
 * Main license validation function
 *
 * Validates a license key by:
 * 1. Parsing the license key format
 * 2. Verifying the JWT signature
 * 3. Checking expiration
 * 4. Validating hardware binding (for portal licenses)
 * 5. Checking revocation status (async, optional for offline)
 *
 * @param licenseKey - The license key to validate (format: np|nd-{JWT})
 * @param currentHardwareId - Optional hardware ID for portal license validation
 * @returns ValidationResult with isValid flag and details/error
 */
export async function validateLicense(
  licenseKey: string,
  currentHardwareId?: string
): Promise<ValidationResult> {
  try {
    // Step 1: Parse license key
    let parsed: ParsedLicenseKey;
    try {
      parsed = parseLicenseKey(licenseKey);
    } catch (error) {
      return {
        isValid: false,
        error: {
          code: ValidationErrorCode.INVALID_FORMAT,
          message: error instanceof Error ? error.message : 'Invalid license key format',
        },
      };
    }

    // For opaque keys (na- without JWT), validate via DB lookup
    if (parsed.opaqueKey && !parsed.jwt) {
      const license = await licenseRepository.findByKey(licenseKey);
      if (!license) {
        return {
          isValid: false,
          error: {
            code: ValidationErrorCode.INVALID_FORMAT,
            message: 'License key not found',
          },
        };
      }

      // Check revocation
      if (license.revoked_at) {
        return {
          isValid: false,
          error: {
            code: ValidationErrorCode.LICENSE_REVOKED,
            message: 'License has been revoked',
          },
        };
      }

      // Check expiration
      if (license.expires_at && new Date(license.expires_at) < new Date()) {
        return {
          isValid: false,
          error: {
            code: ValidationErrorCode.LICENSE_EXPIRED,
            message: 'License has expired',
          },
        };
      }

      return {
        isValid: true,
        features: Array.isArray(license.features) ? license.features : [],
        limits: typeof license.limits === 'object' && license.limits ? license.limits as { concurrent_clients?: number } : {},
        expiresAt: license.expires_at ? new Date(license.expires_at) : undefined,
        subject: license.id,
        type: 'notely-ai',
      };
    }

    // Step 2: Verify JWT signature
    let payload: LicensePayload;
    try {
      const publicKey = keyManager.getPublicKey();
      payload = verifySignature(parsed.jwt!, publicKey);
    } catch (error) {
      return {
        isValid: false,
        error: {
          code: ValidationErrorCode.INVALID_SIGNATURE,
          message: error instanceof Error ? error.message : 'JWT signature verification failed',
        },
      };
    }

    // Step 3: Check expiration
    if (checkExpiration(payload)) {
      return {
        isValid: false,
        error: {
          code: ValidationErrorCode.LICENSE_EXPIRED,
          message: 'License has expired',
        },
      };
    }

    // Step 4: Validate hardware binding for portal licenses
    const hardwareError = checkHardwareBinding(payload, currentHardwareId);
    if (hardwareError) {
      return {
        isValid: false,
        error: hardwareError,
      };
    }

    // Step 5: Check revocation status (async)
    const isRevoked = await checkRevocation(payload.sub);
    if (isRevoked) {
      return {
        isValid: false,
        error: {
          code: ValidationErrorCode.LICENSE_REVOKED,
          message: 'License has been revoked',
        },
      };
    }

    // License is valid - return success result
    return {
      isValid: true,
      features: payload.features,
      limits: payload.limits,
      expiresAt: new Date(payload.exp * 1000),
      subject: payload.sub,
      type: payload.type,
      offline: payload.offline,
    };
  } catch (error) {
    // Catch-all for unexpected errors
    return {
      isValid: false,
      error: {
        code: ValidationErrorCode.INVALID_FORMAT,
        message: error instanceof Error ? error.message : 'Unexpected validation error',
      },
    };
  }
}

/**
 * Validate a license synchronously (without revocation check)
 * Useful for offline validation scenarios
 *
 * @param licenseKey - The license key to validate
 * @param currentHardwareId - Optional hardware ID for portal license validation
 * @returns ValidationResult with isValid flag and details/error
 */
export function validateLicenseSync(
  licenseKey: string,
  currentHardwareId?: string
): ValidationResult {
  try {
    // Step 1: Parse license key
    let parsed: ParsedLicenseKey;
    try {
      parsed = parseLicenseKey(licenseKey);
    } catch (error) {
      return {
        isValid: false,
        error: {
          code: ValidationErrorCode.INVALID_FORMAT,
          message: error instanceof Error ? error.message : 'Invalid license key format',
        },
      };
    }

    // Opaque keys require DB lookup and cannot be validated synchronously
    if (parsed.opaqueKey && !parsed.jwt) {
      return {
        isValid: false,
        error: {
          code: ValidationErrorCode.INVALID_FORMAT,
          message: 'Opaque license keys require online validation (database lookup)',
        },
      };
    }

    // Step 2: Verify JWT signature
    let payload: LicensePayload;
    try {
      const publicKey = keyManager.getPublicKey();
      payload = verifySignature(parsed.jwt!, publicKey);
    } catch (error) {
      return {
        isValid: false,
        error: {
          code: ValidationErrorCode.INVALID_SIGNATURE,
          message: error instanceof Error ? error.message : 'JWT signature verification failed',
        },
      };
    }

    // Step 3: Check expiration
    if (checkExpiration(payload)) {
      return {
        isValid: false,
        error: {
          code: ValidationErrorCode.LICENSE_EXPIRED,
          message: 'License has expired',
        },
      };
    }

    // Step 4: Validate hardware binding for portal licenses
    const hardwareError = checkHardwareBinding(payload, currentHardwareId);
    if (hardwareError) {
      return {
        isValid: false,
        error: hardwareError,
      };
    }

    // License is valid - return success result (note: revocation not checked)
    return {
      isValid: true,
      features: payload.features,
      limits: payload.limits,
      expiresAt: new Date(payload.exp * 1000),
      subject: payload.sub,
      type: payload.type,
      offline: payload.offline,
    };
  } catch (error) {
    // Catch-all for unexpected errors
    return {
      isValid: false,
      error: {
        code: ValidationErrorCode.INVALID_FORMAT,
        message: error instanceof Error ? error.message : 'Unexpected validation error',
      },
    };
  }
}
