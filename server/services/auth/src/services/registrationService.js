const bcrypt = require('bcryptjs');
const shared = require('@notely/shared');

const logger = shared.logger.child({ module: 'auth-registration-service' });
const authModel = require('../models/authModel');
const signupPolicy = require('./signupPolicy');
const eventPublisher = require('./eventPublisher');
const verificationService = require('./verificationService');

const PASSWORD_MIN_LENGTH = parseInt(process.env.AUTH_REGISTRATION_MIN_PASSWORD_LENGTH || '8', 10);

// Service URLs - REQUIRED, no fallbacks
const SUPPORT_SERVICE_URL = process.env.SUPPORT_SERVICE_URL;
const LICENSE_SERVICE_URL = process.env.LICENSE_SERVICE_URL;

if (!SUPPORT_SERVICE_URL) {
  throw new Error('SUPPORT_SERVICE_URL environment variable is required');
}
if (!LICENSE_SERVICE_URL) {
  throw new Error('LICENSE_SERVICE_URL environment variable is required');
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidEmail(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const email = value.trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
}

/**
 * Validate a beta token with the support service
 * Returns the signup info if valid, throws if invalid
 */
async function validateBetaToken(token) {
  try {
    const response = await fetch(`${SUPPORT_SERVICE_URL}/api/support/beta/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      logger.info('Beta token validation failed', { error: data.error, message: data.message });
      return null;
    }

    return data.data;
  } catch (error) {
    logger.error('Failed to validate beta token', { error: error.message });
    return null;
  }
}

/**
 * Check if email has a valid beta invitation (was invited to beta)
 * Used to bypass signup restrictions for invited users
 * @param {string} email - Email to check
 * @returns {Promise<boolean>} True if email has valid invitation
 */
async function checkEmailHasInvitation(email) {
  try {
    const response = await fetch(`${SUPPORT_SERVICE_URL}/api/support/beta/check-invitation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      logger.warn('Beta invitation check failed', { email, error: data.error });
      return false;  // Fail closed - deny signup if check fails
    }

    return data.data?.hasInvitation === true;
  } catch (error) {
    logger.error('Failed to check beta invitation', { email, error: error.message });
    return false;  // Fail closed
  }
}

/**
 * Convert beta signup and grant license when user signs up via invitation bypass
 * Called after successful registration for users who had an invitation
 * @param {string} email - Email address
 * @param {string} userId - User ID of the newly created user
 * @returns {Promise<boolean>} True if conversion and license grant succeeded
 */
async function convertBetaSignupByEmail(email, userId) {
  try {
    const response = await fetch(`${SUPPORT_SERVICE_URL}/api/support/beta/convert-by-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service': 'auth'
      },
      body: JSON.stringify({ email, userId })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      logger.warn('Beta conversion by email failed', { email, userId, error: data.error });
      return false;
    }

    logger.info('Beta signup converted and license granted', {
      email,
      userId,
      signupId: data.data?.signupId,
      licenseGranted: data.data?.licenseGranted
    });

    return data.data?.licenseGranted === true;
  } catch (error) {
    logger.error('Failed to convert beta signup by email', { email, userId, error: error.message });
    return false;
  }
}

/**
 * Redeem a beta token after user registration
 * This marks the token as used and grants beta license
 */
async function redeemBetaTokenInternal(token, userId, email) {
  try {
    // First, mark the token as used via support service
    // We need to call the internal redeem endpoint, but we don't have a real session
    // Instead, we'll call with internal service headers
    const redeemResponse = await fetch(`${SUPPORT_SERVICE_URL}/api/support/beta/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-subject': userId,
        'x-auth-email': email,
        'x-internal-service': 'auth'
      },
      body: JSON.stringify({ token })
    });

    const redeemData = await redeemResponse.json();

    if (!redeemResponse.ok || !redeemData.success) {
      logger.warn('Beta token redemption failed during registration', {
        error: redeemData.error,
        message: redeemData.message,
        userId,
        email
      });
      return false;
    }

    logger.info('Beta token redeemed successfully during registration', { userId, email });
    return true;
  } catch (error) {
    logger.error('Error redeeming beta token during registration', {
      error: error.message,
      userId,
      email
    });
    return false;
  }
}

async function registerLocalUser({ email, password, firstName, lastName, betaToken, ipAddress }) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!isValidEmail(normalizedEmail)) {
    throw new shared.errors.ValidationError('A valid email address is required');
  }

  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new shared.errors.ValidationError(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`
    );
  }

  // If beta token provided, validate it first
  let validatedBetaSignup = null;
  if (betaToken) {
    validatedBetaSignup = await validateBetaToken(betaToken);
    if (validatedBetaSignup) {
      // Ensure the registration email matches the beta signup email
      if (validatedBetaSignup.email.toLowerCase() !== normalizedEmail) {
        throw new shared.errors.ValidationError(
          `Registration email must match your beta signup email (${validatedBetaSignup.email})`
        );
      }
      logger.info('Beta token validated for registration', {
        signupId: validatedBetaSignup.signupId,
        email: normalizedEmail
      });
    } else {
      // Invalid beta token - still allow registration if signups are enabled
      logger.warn('Invalid beta token provided during registration', { email: normalizedEmail });
    }
  }

  // Check if beta token is required for registration
  const betaRequired = await signupPolicy.isBetaTokenRequired();
  let signedUpViaInvitationBypass = false;

  if (betaRequired) {
    // Beta mode: MUST have valid beta token
    if (!validatedBetaSignup) {
      logger.info('Registration rejected: beta token required but not provided/valid', {
        email: normalizedEmail,
        betaTokenProvided: !!betaToken
      });
      throw new shared.errors.ForbiddenError(
        'Registration requires a valid beta invitation. Please sign up for beta access first.'
      );
    }
  } else {
    // Open mode: check if signups are enabled (with invitation bypass)
    if (!validatedBetaSignup) {
      const signupsEnabled = await signupPolicy.areSignupsEnabled();

      if (!signupsEnabled) {
        // Check if email has a beta invitation
        const hasInvitation = await checkEmailHasInvitation(normalizedEmail);

        if (!hasInvitation) {
          logger.info('Sign-ups disabled and no invitation', { email: normalizedEmail });
          throw new shared.errors.ForbiddenError('Sign-ups are currently disabled');
        }

        logger.info('Sign-ups disabled but email has invitation', { email: normalizedEmail });
        signedUpViaInvitationBypass = true;
      }
    }
  }

  // Use first/last name from beta signup if not provided
  const sanitizedFirstName = normalizeString(firstName) ||
    (validatedBetaSignup ? validatedBetaSignup.firstName : null);
  const sanitizedLastName = normalizeString(lastName) ||
    (validatedBetaSignup ? validatedBetaSignup.lastName : null);

  const existing = await authModel.getUserByEmail(normalizedEmail);
  if (existing) {
    throw new shared.errors.ConflictError('An account already exists for this email address');
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  // Beta users get email pre-verified since they were sent an invitation
  const emailVerified = validatedBetaSignup ? true : false;

  const createdUser = await authModel.createUserCredential({
    email: normalizedEmail,
    passwordHash,
    firstName: sanitizedFirstName,
    lastName: sanitizedLastName,
    emailVerified
  });

  logger.info('New user registered', {
    authUserId: createdUser.id,
    email: createdUser.email,
    viaBeta: !!validatedBetaSignup
  });

  await eventPublisher.publishUserRegistered({
    authUserId: createdUser.id,
    email: createdUser.email,
    firstName: createdUser.first_name,
    lastName: createdUser.last_name,
    role: createdUser.role,
    createdAt: createdUser.created_at,
    viaBeta: !!validatedBetaSignup,
    ipAddress: ipAddress || null
  });

  // Send verification email for non-beta users
  if (!emailVerified) {
    try {
      await verificationService.generateAndSendCode(createdUser.email, createdUser.first_name);
    } catch (err) {
      logger.error('Failed to send verification email', { error: err.message, email: createdUser.email });
      // Don't fail registration if email send fails
    }
  }

  // If this was a beta registration, redeem the token now
  let betaRedeemed = false;
  if (validatedBetaSignup && betaToken) {
    betaRedeemed = await redeemBetaTokenInternal(betaToken, createdUser.id, createdUser.email);
  }

  // Convert beta signup and grant license if signed up via invitation bypass
  if (signedUpViaInvitationBypass) {
    try {
      betaRedeemed = await convertBetaSignupByEmail(normalizedEmail, createdUser.id);
      if (betaRedeemed) {
        logger.info('Beta license granted via invitation bypass', {
          userId: createdUser.id,
          email: normalizedEmail
        });
      } else {
        logger.warn('Beta conversion via invitation bypass failed', {
          userId: createdUser.id,
          email: normalizedEmail
        });
      }
    } catch (error) {
      logger.error('Error converting beta signup via invitation bypass', {
        error: error.message,
        userId: createdUser.id,
        email: normalizedEmail
      });
    }
  }

  return {
    id: createdUser.id,
    email: createdUser.email,
    firstName: createdUser.first_name,
    lastName: createdUser.last_name,
    role: createdUser.role,
    emailVerified: createdUser.email_verified,
    betaRedeemed
  };
}

module.exports = {
  registerLocalUser,
  validateBetaToken,
  redeemBetaTokenInternal,
  checkEmailHasInvitation,
  convertBetaSignupByEmail
};
