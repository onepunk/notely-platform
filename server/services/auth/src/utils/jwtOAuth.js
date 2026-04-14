/**
 * JWT Utilities for OAuth2 Flow
 *
 * Functions for generating access and refresh tokens
 * with appropriate claims and expiry times.
 */

const jwt = require('jsonwebtoken');
const keyManager = require('./keyManager');

const ACCESS_TOKEN_EXPIRES_IN = process.env.OAUTH_ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.OAUTH_REFRESH_TOKEN_TTL || '7d';
const TOKEN_ISSUER = process.env.OAUTH_TOKEN_ISSUER || 'notely-auth';
// Support multiple audiences for cross-service token usage
const ACCESS_TOKEN_AUDIENCE = process.env.OAUTH_ACCESS_TOKEN_AUDIENCE
  ? process.env.OAUTH_ACCESS_TOKEN_AUDIENCE.split(',').map(a => a.trim())
  : ['notely-api', 'sync-service'];
const REFRESH_TOKEN_AUDIENCE = process.env.OAUTH_REFRESH_TOKEN_AUDIENCE || 'notely-auth';
const DEFAULT_VERIFY_AUDIENCES = Array.from(new Set([
  ...(Array.isArray(ACCESS_TOKEN_AUDIENCE) ? ACCESS_TOKEN_AUDIENCE : [ACCESS_TOKEN_AUDIENCE]),
  REFRESH_TOKEN_AUDIENCE
]));

/**
 * Generate an access token for a user
 * @param {object} user - User object with id, email, role
 * @param {object} options - Additional options (scopes, etc.)
 * @returns {object} { token, expiresAt, expiresIn }
 */
function generateAccessToken(user, options = {}) {
  const { privateKeyPem, kid, algorithm } = keyManager.getSigningKey();

  const payload = {
    tokenType: 'user',
    sub: user.id,
    userId: user.id,
    email: user.email,
    role: user.role,
    scopes: options.scopes || scopesForRole(user.role),
    iss: TOKEN_ISSUER,
    aud: ACCESS_TOKEN_AUDIENCE
  };

  // Add optional first/last name
  if (user.firstName) payload.firstName = user.firstName;
  if (user.lastName) payload.lastName = user.lastName;

  const token = jwt.sign(payload, privateKeyPem, {
    algorithm,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    keyid: kid
  });

  const expiresAt = computeExpiryIso(ACCESS_TOKEN_EXPIRES_IN);

  return {
    token,
    expiresAt,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN
  };
}

/**
 * Generate a refresh token for a user
 * @param {object} user - User object with id, email
 * @returns {object} { token, expiresAt, expiresIn }
 */
function generateRefreshToken(user) {
  const { privateKeyPem, kid, algorithm } = keyManager.getSigningKey();

  const payload = {
    tokenType: 'refresh',
    sub: user.id,
    userId: user.id,
    email: user.email,
    iss: TOKEN_ISSUER,
    aud: REFRESH_TOKEN_AUDIENCE // Refresh tokens only usable with auth service
  };

  const token = jwt.sign(payload, privateKeyPem, {
    algorithm,
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    keyid: kid
  });

  const expiresAt = computeExpiryIso(REFRESH_TOKEN_EXPIRES_IN);

  return {
    token,
    expiresAt,
    expiresIn: REFRESH_TOKEN_EXPIRES_IN
  };
}

/**
 * Verify and decode a JWT token
 * @param {string} token - JWT token
 * @param {object} options - Verification options
 * @returns {object} Decoded payload
 * @throws {Error} If token is invalid
 */
function verifyToken(token, options = {}) {
  const { publicKeyPem, algorithm } = keyManager.getVerificationKey();
  const verifyOptions = {
    algorithms: [algorithm],
    issuer: TOKEN_ISSUER,
    audience: DEFAULT_VERIFY_AUDIENCES,
    ...options
  };

  if (!verifyOptions.audience || (Array.isArray(verifyOptions.audience) && verifyOptions.audience.length === 0)) {
    verifyOptions.audience = DEFAULT_VERIFY_AUDIENCES;
  }

  if (!verifyOptions.issuer) {
    verifyOptions.issuer = TOKEN_ISSUER;
  }

  return jwt.verify(token, publicKeyPem, verifyOptions);
}

/**
 * Get scopes for a user role
 * @param {string} role - User role (admin, user, etc.)
 * @returns {array} Array of scopes
 */
function scopesForRole(role) {
  if (!role) {
    return ['basic', 'sync:read', 'sync:write'];
  }

  const normalizedRole = role.toLowerCase();

  if (normalizedRole === 'admin' || normalizedRole === 'super_admin') {
    return ['*', 'basic', 'sync:read', 'sync:write'];
  }

  return ['basic', 'sync:read', 'sync:write'];
}

/**
 * Compute ISO expiry timestamp from duration string
 * @param {string} duration - Duration string (e.g., '15m', '7d', '1h')
 * @returns {string} ISO 8601 timestamp
 */
function computeExpiryIso(duration) {
  const ms = parseDurationToMs(duration);
  return new Date(Date.now() + ms).toISOString();
}

/**
 * Parse duration string to milliseconds
 * @param {string} duration - Duration string (e.g., '15m', '7d', '1h')
 * @returns {number} Duration in milliseconds
 */
function parseDurationToMs(duration) {
  const match = duration.match(/^(\d+)([smhd])$/);

  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  scopesForRole,
  computeExpiryIso,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN
};
