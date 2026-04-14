/**
 * Email Verification Service
 * Handles generation, sending, and verification of email verification codes.
 */

const crypto = require('crypto');
const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'auth-verification-service' });
const db = shared.database;
const cache = shared.cache;
const emailClient = require('./emailClient');

const CODE_LENGTH = 8;
const CODE_EXPIRY_HOURS = 1;

/**
 * Generate a random 8-character uppercase alphanumeric code
 * @returns {string}
 */
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
  let code = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Generate a verification code, store it in the DB, and send it via email
 * @param {string} email - User's email address
 * @param {string} firstName - User's first name (for email personalization)
 * @returns {Promise<void>}
 */
async function generateAndSendCode(email, firstName) {
  const normalizedEmail = email.trim().toLowerCase();
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_HOURS * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO global_auth.email_verification_codes (email, code, expires_at)
     VALUES ($1, $2, $3)`,
    [normalizedEmail, code, expiresAt]
  );

  logger.info('Verification code generated', { email: normalizedEmail });

  await emailClient.queueVerificationEmail({
    email: normalizedEmail,
    firstName: firstName || 'there',
    code
  });
}

/**
 * Verify a code submitted by the user
 * @param {string} email - User's email address
 * @param {string} code - Submitted verification code
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function verifyCode(email, code) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = code.trim().toUpperCase();

  // Look up the latest unused, non-expired code for this email
  const result = await db.query(
    `SELECT id, code, expires_at
     FROM global_auth.email_verification_codes
     WHERE email = $1
       AND used_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    logger.warn('No valid verification code found', { email: normalizedEmail });
    return { success: false, message: 'Invalid or expired verification code. Please request a new one.' };
  }

  const record = result.rows[0];

  if (record.code !== normalizedCode) {
    logger.warn('Verification code mismatch', { email: normalizedEmail });
    return { success: false, message: 'Invalid verification code. Please check and try again.' };
  }

  // Mark code as used
  await db.query(
    `UPDATE global_auth.email_verification_codes SET used_at = NOW() WHERE id = $1`,
    [record.id]
  );

  // Set email_verified = true on user_credentials
  await db.query(
    `UPDATE global_auth.user_credentials SET email_verified = true WHERE email = $1`,
    [normalizedEmail]
  );

  // Invalidate cached user so login sees the updated email_verified flag
  await cache.deleteCache(`user:email:${normalizedEmail}`);

  logger.info('Email verified successfully', { email: normalizedEmail });
  return { success: true, message: 'Email verified successfully.' };
}

/**
 * Resend a verification code to an unverified user
 * @param {string} email - User's email address
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function resendCode(email) {
  const normalizedEmail = email.trim().toLowerCase();

  // Check user exists and is unverified
  const userResult = await db.query(
    `SELECT id, first_name, email_verified
     FROM global_auth.user_credentials
     WHERE email = $1`,
    [normalizedEmail]
  );

  if (userResult.rows.length === 0) {
    // Don't reveal whether the email exists
    logger.info('Resend requested for unknown email', { email: normalizedEmail });
    return { success: true, message: 'If an account exists with this email, a new verification code has been sent.' };
  }

  const user = userResult.rows[0];

  if (user.email_verified) {
    return { success: true, message: 'This email is already verified. You can sign in.' };
  }

  await generateAndSendCode(normalizedEmail, user.first_name);

  return { success: true, message: 'If an account exists with this email, a new verification code has been sent.' };
}

module.exports = {
  generateAndSendCode,
  verifyCode,
  resendCode
};
