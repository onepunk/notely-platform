/**
 * License Formatter Utilities
 *
 * Handles formatting and parsing of Notely license keys.
 * License keys follow the format: np-{BASE64URL_JWT} for portal,
 * nd-{BASE64URL_JWT} for desktop licenses, and
 * NA-XXXXX-XXXXX-XXXXX-XXXXX (Crockford Base32 opaque) for Notely AI licenses.
 */

import crypto from 'crypto';

/**
 * Parsed license key structure
 */
export interface ParsedLicenseKey {
  prefix: 'np' | 'nd' | 'na';
  type: 'PORTAL' | 'DESKTOP' | 'NOTELY_AI';
  jwt?: string;
  opaqueKey?: string;
}

/**
 * License key format validation regex for JWT-based keys
 * Format: (np|nd|na)-{JWT}
 * - Prefix np => portal licenses
 * - Prefix nd => desktop licenses
 * - JWT is base64url encoded (alphanumeric, hyphens, underscores)
 */
const LICENSE_KEY_REGEX = /^(np|nd|na)-([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

/**
 * Opaque key format for Notely AI licenses
 * Format: NA-XXXXX-XXXXX-XXXXX-XXXXX (Crockford Base32, 20 chars + dashes)
 * Crockford Base32 charset excludes ambiguous I/L/O/U
 */
export const NA_OPAQUE_KEY_REGEX = /^NA-([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})$/i;

/**
 * Crockford Base32 character set (excludes I, L, O, U to avoid ambiguity)
 */
const CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Encode a Buffer to Crockford Base32 string
 */
function crockfordBase32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_CHARS[(value >>> bits) & 0x1f];
    }
  }

  // Encode remaining bits (if any)
  if (bits > 0) {
    result += CROCKFORD_CHARS[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

/**
 * Generate a short opaque license key for Notely AI
 * Format: NA-XXXXX-XXXXX-XXXXX-XXXXX
 * Uses crypto.randomBytes(13) => 104 bits => 20+ Crockford Base32 chars (trimmed to 20)
 *
 * @returns Formatted opaque license key
 */
export function generateOpaqueKey(): string {
  const bytes = crypto.randomBytes(13); // 104 bits => at least 20 Crockford chars
  const encoded = crockfordBase32Encode(bytes).substring(0, 20); // Take exactly 20 chars
  // Format as NA-XXXXX-XXXXX-XXXXX-XXXXX
  return `NA-${encoded.slice(0, 5)}-${encoded.slice(5, 10)}-${encoded.slice(10, 15)}-${encoded.slice(15, 20)}`;
}

const LICENSE_PREFIX_MAP: Record<'portal' | 'desktop' | 'notely-ai', 'np' | 'nd' | 'na'> = {
  portal: 'np',
  desktop: 'nd',
  'notely-ai': 'na',
};

/**
 * Format a JWT token as a Notely license key
 *
 * @param type - License type ('portal', 'desktop', or 'notely-ai')
 * @param jwt - Signed JWT token
 * @returns Formatted license key (np|nd|na - JWT)
 *
 * @example
 * const key = formatLicenseKey('portal', 'eyJhbGciOiJSUzI1NiI...');
 * // Returns: "np-eyJhbGciOiJSUzI1NiI..."
 *
 * @example
 * const key = formatLicenseKey('notely-ai', 'eyJhbGciOiJSUzI1NiI...');
 * // Returns: "na-eyJhbGciOiJSUzI1NiI..."
 */
export function formatLicenseKey(type: 'portal' | 'desktop' | 'notely-ai', jwt: string): string {
  if (!type || (type !== 'portal' && type !== 'desktop' && type !== 'notely-ai')) {
    throw new Error('License type must be "portal", "desktop", or "notely-ai"');
  }

  if (!jwt || typeof jwt !== 'string' || jwt.trim().length === 0) {
    throw new Error('JWT token must be a non-empty string');
  }

  const prefix = LICENSE_PREFIX_MAP[type];
  return `${prefix}-${jwt}`;
}

/**
 * Parse a Notely license key and extract its components
 *
 * @param licenseKey - The license key to parse
 * @returns Parsed license key components
 * @throws Error if the format is invalid
 *
 * @example
 * const parsed = parseLicenseKey('np-eyJhbGciOiJSUzI1NiI...');
 * // Returns: { prefix: 'np', type: 'PORTAL', jwt: 'eyJhbGciOiJSUzI1NiI...' }
 */
export function parseLicenseKey(licenseKey: string): ParsedLicenseKey {
  if (!licenseKey || typeof licenseKey !== 'string') {
    throw new Error('License key must be a non-empty string');
  }

  const trimmed = licenseKey.trim();

  // Try JWT format first (for np-, nd-, and legacy na- JWT keys)
  const jwtMatch = LICENSE_KEY_REGEX.exec(trimmed);
  if (jwtMatch) {
    const [, prefix, jwt] = jwtMatch;
    const normalizedPrefix = prefix.toLowerCase() as 'np' | 'nd' | 'na';

    const typeMap: Record<'np' | 'nd' | 'na', 'PORTAL' | 'DESKTOP' | 'NOTELY_AI'> = {
      np: 'PORTAL',
      nd: 'DESKTOP',
      na: 'NOTELY_AI',
    };

    return {
      prefix: normalizedPrefix,
      type: typeMap[normalizedPrefix],
      jwt,
    };
  }

  // Try opaque key format (NA-XXXXX-XXXXX-XXXXX-XXXXX)
  const opaqueMatch = NA_OPAQUE_KEY_REGEX.exec(trimmed);
  if (opaqueMatch) {
    // Extract the 20-char key without dashes, uppercased
    const opaqueKey = `${opaqueMatch[1]}${opaqueMatch[2]}${opaqueMatch[3]}${opaqueMatch[4]}`.toUpperCase();
    return {
      prefix: 'na',
      type: 'NOTELY_AI',
      opaqueKey,
    };
  }

  throw new Error(
    'Invalid license key format. Expected: np-{JWT}, nd-{JWT}, na-{JWT}, or NA-XXXXX-XXXXX-XXXXX-XXXXX'
  );
}

/**
 * Validate the format of a license key without parsing
 *
 * @param licenseKey - The license key to validate
 * @returns true if the format is valid, false otherwise
 *
 * @example
 * validateFormat('np-eyJhbGciOiJSUzI1NiI...'); // true
 * validateFormat('INVALID-KEY'); // false
 */
export function validateFormat(licenseKey: string): boolean {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return false;
  }

  const trimmed = licenseKey.trim();
  return LICENSE_KEY_REGEX.test(trimmed) || NA_OPAQUE_KEY_REGEX.test(trimmed);
}

/**
 * Format a license key for display with line breaks
 *
 * Inserts line breaks every N characters to make the license key
 * easier to read and copy. Useful for displaying in UI or documentation.
 *
 * @param licenseKey - The license key to format
 * @param lineLength - Number of characters per line (default: 80)
 * @returns License key with line breaks
 *
 * @example
 * const formatted = formatForDisplay('np-eyJhbGci...', 60);
 * // Returns:
 * // np-eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3Mi
 * // OiJub3RlbHktbGljZW5zaW5nIiwic3ViIjoib3JnOjEyMy00NTYtNzg5Ii
 * // ...
 */
export function formatForDisplay(licenseKey: string, lineLength: number = 80): string {
  if (!licenseKey || typeof licenseKey !== 'string') {
    throw new Error('License key must be a non-empty string');
  }

  if (lineLength < 10) {
    throw new Error('Line length must be at least 10 characters');
  }

  const trimmed = licenseKey.trim();

  // Opaque keys are already human-readable, return as-is
  if (NA_OPAQUE_KEY_REGEX.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const lines: string[] = [];

  for (let i = 0; i < trimmed.length; i += lineLength) {
    lines.push(trimmed.slice(i, i + lineLength));
  }

  return lines.join('\n');
}

/**
 * Extract the license type from a license key without full parsing
 *
 * @param licenseKey - The license key to analyze
 * @returns License type ('PORTAL', 'DESKTOP', or 'NOTELY_AI') or null if invalid
 *
 * @example
 * extractType('np-eyJhbGci...'); // 'PORTAL'
 * extractType('nd-eyJhbGci...'); // 'DESKTOP'
 * extractType('na-eyJhbGci...'); // 'NOTELY_AI'
 * extractType('INVALID-KEY'); // null
 */
export function extractType(licenseKey: string): 'PORTAL' | 'DESKTOP' | 'NOTELY_AI' | null {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return null;
  }

  const trimmed = licenseKey.trim();

  // Check opaque key format first (NA-XXXXX-XXXXX-XXXXX-XXXXX)
  if (NA_OPAQUE_KEY_REGEX.test(trimmed)) {
    return 'NOTELY_AI';
  }

  const match = LICENSE_KEY_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  const prefix = match[1].toLowerCase();
  const typeMap: Record<string, 'PORTAL' | 'DESKTOP' | 'NOTELY_AI'> = {
    np: 'PORTAL',
    nd: 'DESKTOP',
    na: 'NOTELY_AI',
  };

  return typeMap[prefix] || null;
}

/**
 * Normalize a license key by trimming whitespace and removing line breaks
 *
 * Useful when accepting license keys from user input where they might
 * have copied a formatted version with line breaks.
 *
 * @param licenseKey - The license key to normalize
 * @returns Normalized license key (single line, trimmed)
 *
 * @example
 * const normalized = normalizeLicenseKey(`
 *   np-
 *   eyJhbGci...
 * `);
 * // Returns: "np-eyJhbGci..."
 */
export function normalizeLicenseKey(licenseKey: string): string {
  if (!licenseKey || typeof licenseKey !== 'string') {
    throw new Error('License key must be a non-empty string');
  }

  // Remove all whitespace characters (spaces, tabs, newlines)
  const stripped = licenseKey.replace(/\s+/g, '');

  // Uppercase for case-insensitive opaque key matching
  return stripped.toUpperCase();
}
