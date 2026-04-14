/**
 * Token Utilities for Beta Access Invitations
 *
 * Provides cryptographically secure token generation and hashing
 * for beta invitation links.
 */

const crypto = require('crypto');

// Token configuration
const TOKEN_BYTES = 32;  // 256 bits of entropy
const TOKEN_HASH_ALGORITHM = 'sha256';
const TOKEN_EXPIRY_HOURS = 168;  // 7 days

/**
 * Generate a cryptographically secure beta access token
 * @returns {string} Base64URL-encoded random token
 */
function generateBetaAccessToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a token for secure storage
 * Only the hash is stored in the database, never the raw token
 * @param {string} token - The raw token to hash
 * @returns {string} SHA-256 hex digest of the token
 */
function hashBetaToken(token) {
  return crypto.createHash(TOKEN_HASH_ALGORITHM)
    .update(token)
    .digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings match
 */
function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Calculate token expiry timestamp (7 days from now)
 * @returns {Date} Expiry timestamp
 */
function getTokenExpiry() {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + TOKEN_EXPIRY_HOURS);
  return expiry;
}

/**
 * Check if a token has expired
 * @param {Date|string} expiresAt - Token expiry timestamp
 * @returns {boolean} True if token has expired
 */
function isTokenExpired(expiresAt) {
  if (!expiresAt) {
    return true;
  }
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return expiry < new Date();
}

module.exports = {
  generateBetaAccessToken,
  hashBetaToken,
  secureCompare,
  getTokenExpiry,
  isTokenExpired,
  TOKEN_EXPIRY_HOURS
};
