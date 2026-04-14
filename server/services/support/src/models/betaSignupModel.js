/**
 * Beta Signup Model - Database operations for beta signups
 */

const shared = require('@notely/shared');
const db = shared.database;
const logger = shared.logger.child({ module: 'support-beta-signup-model' });
const {
  generateBetaAccessToken,
  hashBetaToken,
  getTokenExpiry
} = require('../utils/tokenUtils');

/**
 * Create a new beta signup
 */
async function createSignup({ firstName, lastName, email, ipAddress, userAgent, referrer, product }) {
  const validProducts = ['cloud', 'ai'];
  const sanitizedProduct = validProducts.includes(product) ? product : 'cloud';

  const query = `
    INSERT INTO support.beta_signups (first_name, last_name, email, ip_address, user_agent, referrer, product)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, first_name, last_name, email, terms_accepted_at, ip_address, created_at, status, product
  `;

  const result = await db.query(query, [
    firstName.trim(),
    lastName.trim(),
    email.trim().toLowerCase(),
    ipAddress || null,
    userAgent || null,
    referrer || null,
    sanitizedProduct
  ]);

  return result.rows[0];
}

/**
 * Check if email already exists for a specific product
 */
async function emailExists(email, product = 'cloud') {
  const query = `
    SELECT id FROM support.beta_signups
    WHERE LOWER(email) = LOWER($1) AND product = $2
  `;

  const result = await db.query(query, [email.trim(), product]);
  return result.rows.length > 0;
}

/**
 * Get signup by email (returns first match)
 */
async function getByEmail(email) {
  const query = `
    SELECT id, first_name, last_name, email, terms_accepted_at, created_at, status,
           confirmation_sent_at, admin_notified_at, invitation_sent_at, product
    FROM support.beta_signups
    WHERE LOWER(email) = LOWER($1)
  `;

  const result = await db.query(query, [email.trim()]);
  return result.rows[0] || null;
}

/**
 * Get all signups by email (returns all products)
 */
async function getAllByEmail(email) {
  const query = `
    SELECT id, first_name, last_name, email, terms_accepted_at, created_at, status,
           confirmation_sent_at, admin_notified_at, invitation_sent_at,
           access_token_used_at, product
    FROM support.beta_signups
    WHERE LOWER(email) = LOWER($1)
    ORDER BY created_at DESC
  `;

  const result = await db.query(query, [email.trim()]);
  return result.rows;
}

/**
 * Get signup by ID
 */
async function getById(id) {
  const query = `
    SELECT id, first_name, last_name, email, terms_accepted_at, ip_address, user_agent,
           referrer, created_at, confirmation_sent_at, admin_notified_at, notes, status,
           access_token_hash, access_token_created_at, access_token_expires_at,
           access_token_used_at, access_token_used_by, invitation_sent_at, invitation_sent_by,
           product
    FROM support.beta_signups
    WHERE id = $1
  `;

  const result = await db.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * Update confirmation sent timestamp
 */
async function markConfirmationSent(id) {
  const query = `
    UPDATE support.beta_signups
    SET confirmation_sent_at = NOW()
    WHERE id = $1
    RETURNING id, confirmation_sent_at
  `;

  const result = await db.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * Update admin notified timestamp
 */
async function markAdminNotified(id) {
  const query = `
    UPDATE support.beta_signups
    SET admin_notified_at = NOW()
    WHERE id = $1
    RETURNING id, admin_notified_at
  `;

  const result = await db.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * Update signup status
 */
async function updateStatus(id, status) {
  const validStatuses = ['pending', 'confirmed', 'invite_sent', 'converted', 'unsubscribed'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const query = `
    UPDATE support.beta_signups
    SET status = $2
    WHERE id = $1
    RETURNING id, status
  `;

  const result = await db.query(query, [id, status]);
  return result.rows[0] || null;
}

/**
 * List all signups (for admin)
 */
async function listSignups({ limit = 50, offset = 0, status = null, product = null } = {}) {
  let query = `
    SELECT id, first_name, last_name, email, terms_accepted_at, created_at, status,
           confirmation_sent_at, admin_notified_at, invitation_sent_at,
           access_token_expires_at, access_token_used_at, product
    FROM support.beta_signups
  `;

  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (product) {
    params.push(product);
    conditions.push(`product = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ` ORDER BY created_at DESC`;

  params.push(limit);
  query += ` LIMIT $${params.length}`;

  params.push(offset);
  query += ` OFFSET $${params.length}`;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Count total signups
 */
async function countSignups(status = null) {
  let query = `SELECT COUNT(*) as count FROM support.beta_signups`;
  const params = [];

  if (status) {
    params.push(status);
    query += ` WHERE status = $1`;
  }

  const result = await db.query(query, params);
  return parseInt(result.rows[0].count, 10);
}

/**
 * Generate and store a beta access token for a signup
 * @param {string} signupId - The signup ID
 * @param {string} adminId - The admin user ID who initiated the invitation
 * @returns {Object} { signup, token, expiresAt } - Raw token is returned for email
 */
async function createAccessToken(signupId, adminId) {
  const token = generateBetaAccessToken();
  const tokenHash = hashBetaToken(token);
  const expiresAt = getTokenExpiry();

  const query = `
    UPDATE support.beta_signups
    SET access_token_hash = $2,
        access_token_created_at = NOW(),
        access_token_expires_at = $3,
        access_token_used_at = NULL,
        access_token_used_by = NULL,
        invitation_sent_at = NOW(),
        invitation_sent_by = $4
    WHERE id = $1
    RETURNING id, email, first_name, last_name, status
  `;

  const result = await db.query(query, [signupId, tokenHash, expiresAt, adminId]);

  if (result.rows.length === 0) {
    return null;
  }

  logger.info('Beta access token created', {
    signupId,
    adminId,
    expiresAt: expiresAt.toISOString()
  });

  return {
    signup: result.rows[0],
    token,  // Raw token for email - never stored
    expiresAt
  };
}

/**
 * Find a signup by token hash
 * Used during token validation/redemption
 * @param {string} tokenHash - SHA-256 hash of the token
 * @returns {Object|null} Signup record or null
 */
async function findByTokenHash(tokenHash) {
  const query = `
    SELECT id, email, first_name, last_name, status,
           access_token_expires_at, access_token_used_at, product
    FROM support.beta_signups
    WHERE access_token_hash = $1
  `;

  const result = await db.query(query, [tokenHash]);
  return result.rows[0] || null;
}

/**
 * Mark a token as used (atomic operation to prevent race conditions)
 * Also updates the signup status to 'converted'
 * @param {string} signupId - The signup ID
 * @param {string} userId - The user ID who redeemed the token
 * @returns {boolean} True if successfully marked as used
 */
async function markTokenUsed(signupId, userId) {
  const query = `
    UPDATE support.beta_signups
    SET access_token_used_at = NOW(),
        access_token_used_by = $2,
        status = 'converted'
    WHERE id = $1
      AND access_token_used_at IS NULL
    RETURNING id
  `;

  const result = await db.query(query, [signupId, userId]);

  if (result.rows.length > 0) {
    logger.info('Beta access token redeemed', { signupId, userId });
    return true;
  }

  return false;
}

/**
 * Clear an expired token to allow re-sending
 * @param {string} signupId - The signup ID
 * @returns {Object|null} Updated signup or null
 */
async function clearExpiredToken(signupId) {
  const query = `
    UPDATE support.beta_signups
    SET access_token_hash = NULL,
        access_token_created_at = NULL,
        access_token_expires_at = NULL,
        access_token_used_at = NULL,
        access_token_used_by = NULL
    WHERE id = $1
      AND (access_token_expires_at < NOW() OR access_token_hash IS NULL)
      AND access_token_used_at IS NULL
    RETURNING id, email, first_name, last_name, status
  `;

  const result = await db.query(query, [signupId]);
  return result.rows[0] || null;
}

/**
 * Check if a signup has an active (not expired, not used) token
 * @param {string} signupId - The signup ID
 * @returns {boolean} True if an active token exists
 */
async function hasActiveToken(signupId) {
  const query = `
    SELECT id FROM support.beta_signups
    WHERE id = $1
      AND access_token_hash IS NOT NULL
      AND access_token_expires_at > NOW()
      AND access_token_used_at IS NULL
  `;

  const result = await db.query(query, [signupId]);
  return result.rows.length > 0;
}

/**
 * Mark a signup as converted by email (for invitation bypass flow)
 * Used when user signs up via email invitation check (not token URL)
 * @param {string} email - The email address
 * @param {string} userId - The user ID who signed up
 * @returns {Object|null} The signup record if converted, null otherwise
 */
async function markConvertedByEmail(email, userId) {
  const query = `
    UPDATE support.beta_signups
    SET access_token_used_at = NOW(),
        access_token_used_by = $2,
        status = 'converted'
    WHERE LOWER(email) = LOWER($1)
      AND invitation_sent_at IS NOT NULL
      AND status NOT IN ('converted', 'unsubscribed')
    RETURNING id, first_name, last_name, email, status
  `;

  const result = await db.query(query, [email.trim(), userId]);

  if (result.rows.length > 0) {
    logger.info('Beta signup converted via email check', {
      signupId: result.rows[0].id,
      email,
      userId
    });
    return result.rows[0];
  }

  return null;
}

/**
 * Get signup by email and product
 * @param {string} email - The email address
 * @param {string} product - The product ('cloud' or 'ai')
 * @returns {Object|null} Signup record or null
 */
async function getByEmailAndProduct(email, product) {
  const query = `
    SELECT id, first_name, last_name, email, terms_accepted_at, created_at, status,
           confirmation_sent_at, admin_notified_at, invitation_sent_at,
           verification_code, verification_code_expires_at, email_verified_at, product
    FROM support.beta_signups
    WHERE LOWER(email) = LOWER($1) AND product = $2
  `;

  const result = await db.query(query, [email.trim(), product]);
  return result.rows[0] || null;
}

/**
 * Store a verification code and expiry on a beta signup
 * @param {string} signupId - The signup ID
 * @param {string} code - The 8-char verification code
 * @param {Date} expiresAt - When the code expires
 * @param {string|null} tokenHash - Optional SHA-256 hash of magic link token
 * @returns {Object|null} Updated signup or null
 */
async function setVerificationCode(signupId, code, expiresAt, tokenHash = null) {
  const query = `
    UPDATE support.beta_signups
    SET verification_code = $2,
        verification_code_expires_at = $3,
        verification_token_hash = $4
    WHERE id = $1
    RETURNING id, email, first_name, last_name, status
  `;

  const result = await db.query(query, [signupId, code, expiresAt, tokenHash]);
  return result.rows[0] || null;
}

/**
 * Verify an email verification code for a beta signup
 * Validates code is correct (case-insensitive), not expired, and not already verified.
 * On success, sets email_verified_at and clears the code.
 * @param {string} email - The email address
 * @param {string} product - The product ('cloud' or 'ai')
 * @param {string} code - The verification code to check
 * @returns {Object} { success, signup, message }
 */
async function verifyEmailCode(email, product, code) {
  const signup = await getByEmailAndProduct(email, product);

  if (!signup) {
    return { success: false, signup: null, message: 'Signup not found' };
  }

  if (signup.email_verified_at) {
    return { success: false, signup, message: 'Email already verified' };
  }

  if (!signup.verification_code) {
    return { success: false, signup: null, message: 'No verification code set' };
  }

  if (new Date() > new Date(signup.verification_code_expires_at)) {
    return { success: false, signup: null, message: 'Verification code has expired' };
  }

  if (signup.verification_code.toUpperCase() !== code.toUpperCase()) {
    return { success: false, signup: null, message: 'Invalid verification code' };
  }

  // Code is valid — mark as verified and clear the code + token hash
  const updateQuery = `
    UPDATE support.beta_signups
    SET email_verified_at = NOW(),
        verification_code = NULL,
        verification_code_expires_at = NULL,
        verification_token_hash = NULL
    WHERE id = $1
    RETURNING id, first_name, last_name, email, status, product
  `;

  const result = await db.query(updateQuery, [signup.id]);
  const verified = result.rows[0] || null;

  if (verified) {
    logger.info('Beta signup email verified', { signupId: verified.id, email: verified.email, product });
  }

  return { success: true, signup: verified, message: 'Email verified successfully' };
}

/**
 * Verify a beta signup via magic link token
 * Looks up signup by hashed token, validates expiry, then marks verified.
 * @param {string} token - The raw magic link token
 * @returns {Object} { success, signup, message }
 */
async function verifyEmailToken(token) {
  const tokenHash = hashBetaToken(token);

  const findQuery = `
    SELECT id, first_name, last_name, email, status, product,
           verification_code_expires_at, email_verified_at, verification_token_hash
    FROM support.beta_signups
    WHERE verification_token_hash = $1
  `;

  const findResult = await db.query(findQuery, [tokenHash]);
  const signup = findResult.rows[0] || null;

  if (!signup) {
    return { success: false, signup: null, message: 'Invalid verification link' };
  }

  if (signup.email_verified_at) {
    return { success: false, signup, message: 'Email already verified' };
  }

  if (new Date() > new Date(signup.verification_code_expires_at)) {
    return { success: false, signup: null, message: 'Verification link has expired' };
  }

  // Token is valid — mark as verified and clear code + token hash
  const updateQuery = `
    UPDATE support.beta_signups
    SET email_verified_at = NOW(),
        verification_code = NULL,
        verification_code_expires_at = NULL,
        verification_token_hash = NULL
    WHERE id = $1
    RETURNING id, first_name, last_name, email, status, product
  `;

  const result = await db.query(updateQuery, [signup.id]);
  const verified = result.rows[0] || null;

  if (verified) {
    logger.info('Beta signup email verified via magic link', { signupId: verified.id, email: verified.email, product: verified.product });
  }

  return { success: true, signup: verified, message: 'Email verified successfully' };
}

/**
 * Delete a beta signup by ID
 * @param {string} signupId - The signup ID
 * @returns {boolean} True if deleted
 */
async function deleteById(signupId) {
  const query = `
    DELETE FROM support.beta_signups
    WHERE id = $1
    RETURNING id
  `;

  const result = await db.query(query, [signupId]);

  if (result.rows.length > 0) {
    logger.info('Beta signup deleted', { signupId });
    return true;
  }

  return false;
}

/**
 * Delete all beta signups for a given email address
 * Used when a user is deleted to allow re-signup
 * @param {string} email - The email address
 * @returns {number} Number of rows deleted
 */
async function deleteByEmail(email) {
  const result = await db.query(
    'DELETE FROM support.beta_signups WHERE LOWER(email) = LOWER($1) RETURNING id',
    [email.trim()]
  );

  if (result.rows.length > 0) {
    logger.info('Beta signups deleted by email', { email, count: result.rows.length });
  }

  return result.rows.length;
}

module.exports = {
  createSignup,
  emailExists,
  getByEmail,
  getAllByEmail,
  getById,
  markConfirmationSent,
  markAdminNotified,
  updateStatus,
  listSignups,
  countSignups,
  createAccessToken,
  findByTokenHash,
  markTokenUsed,
  markConvertedByEmail,
  clearExpiredToken,
  hasActiveToken,
  deleteById,
  deleteByEmail,
  getByEmailAndProduct,
  setVerificationCode,
  verifyEmailCode,
  verifyEmailToken
};
