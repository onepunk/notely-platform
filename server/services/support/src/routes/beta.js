/**
 * Beta Signup Routes - Public API for beta program signups
 */

const express = require('express');
const shared = require('@notely/shared');
const betaSignupModel = require('../models/betaSignupModel');
const emailClient = require('../services/emailClient');
const { generateBetaAccessToken, hashBetaToken, isTokenExpired } = require('../utils/tokenUtils');

const logger = shared.logger.child({ module: 'support-beta-routes' });
const router = express.Router();

// Rate limiter for beta signup - 5 attempts per IP per hour
const betaSignupRateLimiter = shared.middleware.rateLimiter.createEndpointLimiter('beta-signup', {
  points: 5,              // 5 signup attempts
  duration: 60 * 60,      // per hour
  blockDuration: 60 * 60  // block for 1 hour if exceeded
});

// Rate limiter for verify-email - 5 attempts per 15 minutes per IP
const verifyEmailRateLimiter = shared.middleware.rateLimiter.createEndpointLimiter('beta-verify-email', {
  points: 5,
  duration: 15 * 60,
  blockDuration: 15 * 60
});

// Rate limiter for resend-verification - 3 attempts per 15 minutes per IP
const resendVerificationRateLimiter = shared.middleware.rateLimiter.createEndpointLimiter('beta-resend-verification', {
  points: 3,
  duration: 15 * 60,
  blockDuration: 15 * 60
});

// Rate limiter for authenticated enroll - 3 attempts per hour per IP
const betaEnrollRateLimiter = shared.middleware.rateLimiter.createEndpointLimiter('beta-enroll', {
  points: 3,
  duration: 60 * 60,
  blockDuration: 60 * 60
});

// Portal URL for access links - set by configure-domains.sh via PORTAL_URL env var
const PORTAL_URL = process.env.PORTAL_URL;
if (!PORTAL_URL) {
  throw new Error('PORTAL_URL environment variable is required');
}

// License service URL for granting beta access - REQUIRED, no fallback
const LICENSE_SERVICE_URL = process.env.LICENSE_SERVICE_URL;
if (!LICENSE_SERVICE_URL) {
  throw new Error('LICENSE_SERVICE_URL environment variable is required');
}

// Get URL for magic link verification (optional - code-only fallback if unset)
const GET_URL = process.env.GET_URL || '';

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Verification code charset (same as auth service — no ambiguous characters)
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function generateVerificationCode() {
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
  }
  return code;
}

/**
 * Generate verification code + magic link token and store both in the database
 * @param {string} signupId - The signup ID
 * @returns {{ code: string, verifyUrl: string|null }} The verification code and optional magic link URL
 */
async function generateAndStoreVerification(signupId) {
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  let token = null;
  let tokenHash = null;
  if (GET_URL) {
    token = generateBetaAccessToken();
    tokenHash = hashBetaToken(token);
  }

  await betaSignupModel.setVerificationCode(signupId, code, expiresAt, tokenHash);

  const verifyUrl = token
    ? `${GET_URL}/verify/?token=${encodeURIComponent(token)}`
    : null;

  return { code, verifyUrl };
}

/**
 * Handle post-verification logic for both code and link verification
 * AI: generate license key → email key → mark converted
 * Cloud: generate access token → email invitation → mark invite_sent
 * @param {Object} signup - The verified signup record
 * @param {Object} res - Express response object
 */
async function handlePostVerification(signup, res) {
  const product = signup.product;

  // --- AI path: generate license key → email key → mark converted ---
  if (product === 'ai') {
    let licenseKey = null;
    try {
      const licenseResponse = await fetch(
        `${LICENSE_SERVICE_URL}/api/license/admin/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-service': 'support',
            'x-auth-subject': '00000000-0000-0000-0000-000000000000',
            'x-auth-role': 'admin'
          },
          body: JSON.stringify({
            productType: 'notely-ai',
            type: 'subscription',
            email: signup.email,
            expiresAt: '2026-04-30T23:59:59Z',
            activationLimit: 1,
            notes: `AI beta auto-grant via email verification - signup ID: ${signup.id}`
          })
        }
      );

      if (!licenseResponse.ok) {
        const errorData = await licenseResponse.json().catch(() => ({}));
        logger.error('AI beta license generation failed', {
          signupId: signup.id,
          status: licenseResponse.status,
          error: errorData.message || errorData.error
        });
        return res.status(502).json({
          success: false,
          error: 'license_generation_failed',
          message: 'Failed to generate license key. Please contact support.'
        });
      }

      const licenseData = await licenseResponse.json();
      licenseKey = licenseData.licenseKey;
    } catch (fetchError) {
      logger.error('Failed to contact license service for AI beta', {
        signupId: signup.id,
        error: fetchError.message
      });
      return res.status(502).json({
        success: false,
        error: 'license_service_unavailable',
        message: 'Could not reach the license service. Please try again later.'
      });
    }

    // Generate portal access token (reuses existing beta token infrastructure)
    let accessUrl = `${PORTAL_URL}/login`;
    try {
      const tokenResult = await betaSignupModel.createAccessToken(
        signup.id,
        '00000000-0000-0000-0000-000000000000'
      );
      if (tokenResult && tokenResult.token) {
        accessUrl = `${PORTAL_URL}/login?beta_token=${encodeURIComponent(tokenResult.token)}`;
        logger.info('AI beta access token generated', { signupId: signup.id });
      }
    } catch (tokenErr) {
      logger.warn('Failed to generate AI beta access token, using fallback URL', {
        signupId: signup.id,
        error: tokenErr.message
      });
    }

    // Queue the AI license email
    emailClient.queueNotelyAiLicenseEmail({
      firstName: signup.first_name,
      email: signup.email,
      licenseKey,
      expiresAt: 'April 30, 2026',
      accessUrl,
      adminBcc: true
    }).then((correlationId) => {
      if (correlationId) {
        logger.info('AI beta license email queued', { signupId: signup.id, correlationId });
      }
    }).catch((err) => {
      logger.error('Error queueing AI beta license email', { signupId: signup.id, error: err.message });
    });

    await betaSignupModel.updateStatus(signup.id, 'converted');

    logger.info('AI beta auto-granted via email verification', {
      signupId: signup.id,
      email: signup.email
    });

    return res.json({
      success: true,
      message: 'Your license key has been sent to your email!'
    });
  }

  // --- Cloud path: generate access token → email invitation → mark invite_sent ---
  let accessUrl = `${PORTAL_URL}/login`;
  try {
    const tokenResult = await betaSignupModel.createAccessToken(
      signup.id,
      '00000000-0000-0000-0000-000000000000'
    );
    if (tokenResult && tokenResult.token) {
      accessUrl = `${PORTAL_URL}/login?beta_token=${encodeURIComponent(tokenResult.token)}`;
      logger.info('Cloud beta access token generated', { signupId: signup.id });
    }
  } catch (tokenErr) {
    logger.error('Failed to generate Cloud beta access token', {
      signupId: signup.id,
      error: tokenErr.message
    });
    return res.status(502).json({
      success: false,
      error: 'token_generation_failed',
      message: 'Failed to generate invitation. Please try again later.'
    });
  }

  // Queue the Cloud invitation email
  emailClient.queueBetaInvitationEmail({
    firstName: signup.first_name,
    email: signup.email,
    accessUrl,
    expiresIn: '24 hours',
    adminBcc: true
  }).then((correlationId) => {
    if (correlationId) {
      logger.info('Cloud beta invitation email queued', { signupId: signup.id, correlationId });
    }
  }).catch((err) => {
    logger.error('Error queueing Cloud beta invitation email', { signupId: signup.id, error: err.message });
  });

  await betaSignupModel.updateStatus(signup.id, 'invite_sent');

  logger.info('Cloud beta invitation auto-sent via email verification', {
    signupId: signup.id,
    email: signup.email
  });

  return res.json({
    success: true,
    message: 'Check your email for your invitation link!'
  });
}

/**
 * POST /api/support/beta/signup
 * Public endpoint for beta program signup
 * Rate limited: 5 attempts per IP per hour
 */
router.post('/signup', betaSignupRateLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, termsAccepted, product } = req.body;

    // Validate and sanitize product
    const validProducts = ['cloud', 'ai'];
    const sanitizedProduct = validProducts.includes(product) ? product : 'cloud';

    // Validation
    const errors = [];

    if (!firstName || typeof firstName !== 'string' || firstName.trim().length < 1) {
      errors.push({ field: 'firstName', message: 'First name is required' });
    } else if (firstName.trim().length > 100) {
      errors.push({ field: 'firstName', message: 'First name must be 100 characters or less' });
    }

    if (!lastName || typeof lastName !== 'string' || lastName.trim().length < 1) {
      errors.push({ field: 'lastName', message: 'Last name is required' });
    } else if (lastName.trim().length > 100) {
      errors.push({ field: 'lastName', message: 'Last name must be 100 characters or less' });
    }

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      errors.push({ field: 'email', message: 'Valid email address is required' });
    } else if (email.trim().length > 255) {
      errors.push({ field: 'email', message: 'Email must be 255 characters or less' });
    }

    if (!termsAccepted) {
      errors.push({ field: 'termsAccepted', message: 'You must accept the terms and conditions' });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Please correct the errors below',
        errors
      });
    }

    // Get client info
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                      req.headers['x-real-ip'] ||
                      req.socket?.remoteAddress ||
                      null;
    const userAgent = req.headers['user-agent'] || null;
    const referrer = req.headers['referer'] || req.headers['referrer'] || null;

    // --- AI product: email verification flow ---
    if (sanitizedProduct === 'ai') {
      // Check for existing signup
      const existingSignup = await betaSignupModel.getByEmailAndProduct(email.trim(), 'ai');

      if (existingSignup) {
        // Already verified or converted → generic success
        if (existingSignup.email_verified_at || existingSignup.status === 'converted') {
          return res.json({
            success: true,
            message: "Thank you for signing up! If you haven't received a confirmation email, please check your spam folder."
          });
        }

        // Unverified → generate new code and resend verification email
        const { code, verifyUrl } = await generateAndStoreVerification(existingSignup.id);

        emailClient.queueBetaVerificationEmail({
          firstName: existingSignup.first_name,
          email: existingSignup.email,
          code,
          verifyUrl
        }).then((correlationId) => {
          if (correlationId) {
            logger.info('AI beta verification email re-sent', { signupId: existingSignup.id, correlationId });
          }
        }).catch((err) => {
          logger.error('Error queueing AI beta verification email', { signupId: existingSignup.id, error: err.message });
        });

        return res.json({
          success: true,
          message: "We've sent a verification code to your email. Please check your inbox.",
          requiresVerification: true
        });
      }

      // New AI signup
      const signup = await betaSignupModel.createSignup({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        ipAddress,
        userAgent,
        referrer,
        product: 'ai'
      });

      logger.info('AI beta signup created', { signupId: signup.id, email: signup.email, ipAddress });

      // Generate verification code + magic link token
      const { code, verifyUrl } = await generateAndStoreVerification(signup.id);

      // Queue verification email (instead of confirmation)
      emailClient.queueBetaVerificationEmail({
        firstName: signup.first_name,
        email: signup.email,
        code,
        verifyUrl
      }).then(async (correlationId) => {
        if (correlationId) {
          await betaSignupModel.markConfirmationSent(signup.id);
          logger.info('AI beta verification email queued', { signupId: signup.id, correlationId });
        } else {
          logger.warn('Failed to queue AI beta verification email', { signupId: signup.id });
        }
      }).catch((err) => {
        logger.error('Error queueing AI beta verification email', { signupId: signup.id, error: err.message });
      });

      // Still send admin notification
      emailClient.queueBetaAdminNotification({
        firstName: signup.first_name,
        lastName: signup.last_name,
        email: signup.email,
        ipAddress,
        userAgent,
        createdAt: signup.created_at
      }).then(async (correlationId) => {
        if (correlationId) {
          await betaSignupModel.markAdminNotified(signup.id);
          logger.info('Beta admin notification queued', { signupId: signup.id, correlationId });
        }
      }).catch((err) => {
        logger.error('Error queueing beta admin notification', { signupId: signup.id, error: err.message });
      });

      return res.json({
        success: true,
        message: "We've sent a verification code to your email. Please check your inbox.",
        requiresVerification: true
      });
    }

    // --- Cloud product: email verification flow (mirrors AI flow) ---

    // Check for existing signup
    const existingCloudSignup = await betaSignupModel.getByEmailAndProduct(email.trim(), 'cloud');

    if (existingCloudSignup) {
      // Already verified or converted → generic success
      if (existingCloudSignup.email_verified_at || existingCloudSignup.status === 'converted' || existingCloudSignup.status === 'invite_sent') {
        return res.json({
          success: true,
          message: "Thank you for signing up! If you haven't received a confirmation email, please check your spam folder."
        });
      }

      // Unverified → generate new code and resend verification email
      const { code, verifyUrl } = await generateAndStoreVerification(existingCloudSignup.id);

      emailClient.queueCloudBetaVerificationEmail({
        firstName: existingCloudSignup.first_name,
        email: existingCloudSignup.email,
        code,
        verifyUrl
      }).then((correlationId) => {
        if (correlationId) {
          logger.info('Cloud beta verification email re-sent', { signupId: existingCloudSignup.id, correlationId });
        }
      }).catch((err) => {
        logger.error('Error queueing Cloud beta verification email', { signupId: existingCloudSignup.id, error: err.message });
      });

      return res.json({
        success: true,
        message: "We've sent a verification code to your email. Please check your inbox.",
        requiresVerification: true
      });
    }

    // New Cloud signup
    const signup = await betaSignupModel.createSignup({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      ipAddress,
      userAgent,
      referrer,
      product: 'cloud'
    });

    logger.info('Cloud beta signup created', {
      signupId: signup.id,
      email: signup.email,
      ipAddress
    });

    // Generate verification code + magic link token
    const { code: cloudCode, verifyUrl: cloudVerifyUrl } = await generateAndStoreVerification(signup.id);

    // Queue verification email
    emailClient.queueCloudBetaVerificationEmail({
      firstName: signup.first_name,
      email: signup.email,
      code: cloudCode,
      verifyUrl: cloudVerifyUrl
    }).then(async (correlationId) => {
      if (correlationId) {
        await betaSignupModel.markConfirmationSent(signup.id);
        logger.info('Cloud beta verification email queued', { signupId: signup.id, correlationId });
      } else {
        logger.warn('Failed to queue Cloud beta verification email', { signupId: signup.id });
      }
    }).catch((err) => {
      logger.error('Error queueing Cloud beta verification email', { signupId: signup.id, error: err.message });
    });

    // Still send admin notification
    emailClient.queueBetaAdminNotification({
      firstName: signup.first_name,
      lastName: signup.last_name,
      email: signup.email,
      ipAddress,
      userAgent,
      createdAt: signup.created_at
    }).then(async (correlationId) => {
      if (correlationId) {
        await betaSignupModel.markAdminNotified(signup.id);
        logger.info('Beta admin notification queued', { signupId: signup.id, correlationId });
      }
    }).catch((err) => {
      logger.error('Error queueing beta admin notification', { signupId: signup.id, error: err.message });
    });

    return res.json({
      success: true,
      message: "We've sent a verification code to your email. Please check your inbox.",
      requiresVerification: true
    });

  } catch (error) {
    // Handle unique constraint violation (race condition)
    if (error.code === '23505') {
      logger.info('Duplicate beta signup (race condition)', { error: error.message });
      return res.json({
        success: true,
        message: "Thank you for signing up! If you haven't received a confirmation email, please check your spam folder."
      });
    }

    logger.error('Beta signup error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * GET /api/support/beta/my-status
 * Get beta signup status for the authenticated user (both products)
 * Requires authentication (user must be logged in via gateway)
 */
router.get('/my-status', async (req, res) => {
  try {
    const userEmail = req.headers['x-auth-email'];
    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'authentication_required',
        message: 'You must be logged in to check beta status'
      });
    }

    const signups = await betaSignupModel.getAllByEmail(userEmail);

    const cloud = signups.find(s => s.product === 'cloud') || null;
    const ai = signups.find(s => s.product === 'ai') || null;

    const mapSignup = (s) => s ? {
      status: s.status,
      product: s.product,
      signedUpAt: s.created_at,
      invitationSentAt: s.invitation_sent_at,
      convertedAt: s.access_token_used_at,
    } : null;

    res.json({
      success: true,
      data: { cloud: mapSignup(cloud), ai: mapSignup(ai) }
    });
  } catch (error) {
    logger.error('Beta my-status error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred checking beta status'
    });
  }
});

/**
 * GET /api/support/beta/status
 * Check if beta signups are enabled (for frontend)
 */
router.get('/status', (req, res) => {
  const signupsEnabled = process.env.BETA_SIGNUPS_ENABLED !== 'false';

  res.json({
    success: true,
    data: {
      signupsEnabled,
      emailConfigured: emailClient.isReady()
    }
  });
});

/**
 * POST /api/support/beta/validate
 * Validate a beta token and return signup info (without redeeming)
 * Used by auth service during registration to allow beta users to register
 * This is an internal endpoint - no user auth required
 */
router.post('/validate', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'invalid_token',
        message: 'Token is required'
      });
    }

    // Hash the incoming token for database lookup
    const tokenHash = hashBetaToken(token);
    const signup = await betaSignupModel.findByTokenHash(tokenHash);

    if (!signup) {
      return res.status(404).json({
        success: false,
        error: 'token_not_found',
        message: 'Invalid beta token'
      });
    }

    // Check if token is already used
    if (signup.access_token_used_at) {
      return res.status(410).json({
        success: false,
        error: 'token_already_used',
        message: 'This beta token has already been used'
      });
    }

    // Check if token is expired
    if (isTokenExpired(signup.access_token_expires_at)) {
      return res.status(410).json({
        success: false,
        error: 'token_expired',
        message: 'This beta token has expired'
      });
    }

    // Token is valid - return signup info for registration pre-fill
    logger.info('Beta token validated', {
      signupId: signup.id,
      email: signup.email
    });

    res.json({
      success: true,
      data: {
        signupId: signup.id,
        email: signup.email,
        firstName: signup.first_name,
        lastName: signup.last_name,
        expiresAt: signup.access_token_expires_at
      }
    });
  } catch (error) {
    logger.error('Beta token validation error', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred validating the token'
    });
  }
});

/**
 * POST /api/support/beta/check-invitation
 * Check if email has a valid beta invitation (for signup policy bypass)
 * Returns whether the email was invited, not token validity
 * This is an internal endpoint - no user auth required
 */
router.post('/check-invitation', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'invalid_email',
        message: 'Valid email address is required'
      });
    }

    const signup = await betaSignupModel.getByEmail(email.trim());

    // Check: email exists AND invitation was sent AND not already converted
    const hasInvitation = signup &&
                          signup.invitation_sent_at !== null &&
                          signup.status !== 'converted' &&
                          signup.status !== 'unsubscribed';

    logger.info('Beta invitation check', {
      email: email.trim(),
      hasInvitation,
      signupExists: !!signup,
      status: signup?.status
    });

    res.json({
      success: true,
      data: {
        hasInvitation,
        ...(hasInvitation && {
          email: signup.email,
          firstName: signup.first_name,
          lastName: signup.last_name
        })
      }
    });
  } catch (error) {
    logger.error('Beta invitation check error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred'
    });
  }
});

/**
 * POST /api/support/beta/convert-by-email
 * Convert a beta signup and grant license when user signs up via invitation bypass
 * This is an internal endpoint called by the auth service
 */
router.post('/convert-by-email', async (req, res) => {
  try {
    const { email, userId } = req.body;

    // Validate inputs
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'invalid_email',
        message: 'Valid email address is required'
      });
    }

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'invalid_user_id',
        message: 'User ID is required'
      });
    }

    // Mark the signup as converted
    const signup = await betaSignupModel.markConvertedByEmail(email.trim(), userId);

    if (!signup) {
      logger.warn('Beta convert by email failed: no eligible signup', { email, userId });
      return res.status(404).json({
        success: false,
        error: 'signup_not_found',
        message: 'No eligible beta signup found for this email'
      });
    }

    logger.info('Beta signup marked as converted', {
      signupId: signup.id,
      email: signup.email,
      userId
    });

    // Call License service to grant beta access (90 days Professional)
    let licenseGranted = false;
    let licenseError = null;
    try {
      const licenseResponse = await fetch(
        `${LICENSE_SERVICE_URL}/api/license/admin/beta/enable`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-service': 'support',
            'x-auth-subject': userId,
            'x-auth-email': email,
            'x-auth-role': 'admin'  // Internal service can grant licenses
          },
          body: JSON.stringify({
            userId,
            notes: `Beta access via invitation bypass - signup ID: ${signup.id}`
          })
        }
      );

      if (licenseResponse.ok) {
        licenseGranted = true;
        logger.info('Beta license granted via invitation bypass', {
          signupId: signup.id,
          userId,
          email
        });

        // Send welcome email to the user
        emailClient.queueBetaWelcomeEmail({
          firstName: signup.first_name,
          email
        }).then((correlationId) => {
          if (correlationId) {
            logger.info('Beta welcome email queued', { signupId: signup.id, correlationId });
          }
        }).catch((err) => {
          logger.error('Error queueing beta welcome email', { signupId: signup.id, error: err.message });
        });
      } else {
        const errorData = await licenseResponse.json().catch(() => ({}));
        licenseError = errorData.message || 'License service error';
        logger.error('Failed to grant beta license via invitation bypass', {
          signupId: signup.id,
          userId,
          status: licenseResponse.status,
          error: licenseError
        });
      }
    } catch (fetchError) {
      licenseError = fetchError.message;
      logger.error('Failed to contact license service', {
        signupId: signup.id,
        userId,
        error: fetchError.message
      });
    }

    res.json({
      success: true,
      message: licenseGranted
        ? 'Beta access granted successfully'
        : 'Beta signup converted but license grant failed',
      data: {
        signupId: signup.id,
        licenseGranted,
        firstName: signup.first_name,
        lastName: signup.last_name
      }
    });
  } catch (error) {
    logger.error('Beta convert by email error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred'
    });
  }
});

/**
 * POST /api/support/beta/redeem
 * Redeem a beta access token after user login
 * Requires authentication (user must be logged in via gateway)
 */
router.post('/redeem', async (req, res) => {
  try {
    // Get authenticated user from gateway headers
    const userId = req.headers['x-auth-subject'];
    const userEmail = req.headers['x-auth-email'];

    if (!userId || !userEmail) {
      return res.status(401).json({
        success: false,
        error: 'authentication_required',
        message: 'You must be logged in to redeem beta access'
      });
    }

    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'invalid_token',
        message: 'Token is required'
      });
    }

    // Hash the incoming token for database lookup
    const tokenHash = hashBetaToken(token);
    const signup = await betaSignupModel.findByTokenHash(tokenHash);

    // Generic error for security - don't reveal why token is invalid
    const invalidTokenResponse = {
      success: false,
      error: 'invalid_or_expired_token',
      message: 'This link is no longer valid'
    };

    if (!signup) {
      logger.warn('Beta token redemption failed: token not found', {
        tokenPrefix: token.substring(0, 10),
        userEmail
      });
      return res.status(410).json(invalidTokenResponse);
    }

    // Check if token is already used
    if (signup.access_token_used_at) {
      logger.warn('Beta token redemption failed: token already used', {
        signupId: signup.id,
        userEmail
      });
      return res.status(410).json(invalidTokenResponse);
    }

    // Check if token is expired
    if (isTokenExpired(signup.access_token_expires_at)) {
      logger.warn('Beta token redemption failed: token expired', {
        signupId: signup.id,
        expiresAt: signup.access_token_expires_at,
        userEmail
      });
      return res.status(410).json(invalidTokenResponse);
    }

    // Check if email matches (case-insensitive)
    if (signup.email.toLowerCase() !== userEmail.toLowerCase()) {
      logger.warn('Beta token redemption failed: email mismatch', {
        signupId: signup.id,
        expectedEmail: signup.email,
        actualEmail: userEmail
      });
      return res.status(403).json({
        success: false,
        error: 'email_mismatch',
        message: `Please log in with the email address you used to sign up for beta (${signup.email})`
      });
    }

    // Mark token as used atomically (prevents race conditions)
    const marked = await betaSignupModel.markTokenUsed(signup.id, userId);
    if (!marked) {
      // Token was used by another request in a race condition
      return res.status(410).json(invalidTokenResponse);
    }

    // Call License service to grant beta access (90 days Professional)
    let licenseGranted = false;
    let licenseError = null;
    try {
      const licenseResponse = await fetch(
        `${LICENSE_SERVICE_URL}/api/license/admin/beta/enable`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-service': 'support',
            'x-auth-subject': userId,
            'x-auth-email': userEmail,
            'x-auth-role': 'admin'  // Internal service can grant licenses
          },
          body: JSON.stringify({
            userId,
            notes: `Beta access via signup ID: ${signup.id}`
          })
        }
      );

      if (licenseResponse.ok) {
        licenseGranted = true;
        logger.info('Beta license granted via redemption', {
          signupId: signup.id,
          userId,
          email: userEmail
        });

        // Send welcome email to the user
        emailClient.queueBetaWelcomeEmail({
          firstName: signup.first_name,
          email: userEmail
        }).then((correlationId) => {
          if (correlationId) {
            logger.info('Beta welcome email queued', { signupId: signup.id, correlationId });
          }
        }).catch((err) => {
          logger.error('Error queueing beta welcome email', { signupId: signup.id, error: err.message });
        });
      } else {
        const errorData = await licenseResponse.json().catch(() => ({}));
        licenseError = errorData.message || 'License service error';
        logger.error('Failed to grant beta license', {
          signupId: signup.id,
          userId,
          status: licenseResponse.status,
          error: licenseError
        });
      }
    } catch (fetchError) {
      licenseError = fetchError.message;
      logger.error('Failed to contact license service', {
        signupId: signup.id,
        userId,
        error: fetchError.message
      });
    }

    // Return success even if license grant failed - token is marked as used
    // User can contact support if license wasn't granted
    res.json({
      success: true,
      message: licenseGranted
        ? 'Welcome to Notely Beta! Your account has been upgraded.'
        : 'Beta access recorded. Please contact support if you need assistance.',
      data: {
        licenseGranted,
        redirectTo: '/dashboard'
      }
    });

  } catch (error) {
    logger.error('Beta token redemption error', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /api/support/beta/verify-email
 * Verify email for AI or Cloud beta signup
 * AI: generates license key → emails key → marks converted
 * Cloud: generates access token → emails invitation link → marks invite_sent
 * Rate limited: 5 attempts per 15 minutes per IP
 */
router.post('/verify-email', verifyEmailRateLimiter, async (req, res) => {
  try {
    const { email, code, product } = req.body;

    // Validate inputs
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'invalid_input',
        message: 'Valid email address is required'
      });
    }

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_input',
        message: 'Verification code is required'
      });
    }

    const validVerifyProducts = ['ai', 'cloud'];
    if (!validVerifyProducts.includes(product)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_product',
        message: 'Email verification is only supported for AI and Cloud beta signups'
      });
    }

    // Verify the code
    const result = await betaSignupModel.verifyEmailCode(email.trim(), product, code.trim());

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'verification_failed',
        message: result.message
      });
    }

    const signup = result.signup;
    return handlePostVerification(signup, res);

  } catch (error) {
    logger.error('Beta verify-email error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /api/support/beta/verify-email-link
 * Verify email via magic link token (from verification email)
 * Same post-verification logic as verify-email but uses token instead of code
 * Rate limited: 5 attempts per 15 minutes per IP
 */
router.post('/verify-email-link', verifyEmailRateLimiter, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_input',
        message: 'Verification token is required'
      });
    }

    const result = await betaSignupModel.verifyEmailToken(token.trim());

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'verification_failed',
        message: result.message
      });
    }

    const signup = result.signup;
    return handlePostVerification(signup, res);

  } catch (error) {
    logger.error('Beta verify-email-link error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /api/support/beta/resend-verification
 * Resend verification code for AI or Cloud beta signup
 * Rate limited: 3 attempts per 15 minutes per IP
 */
router.post('/resend-verification', resendVerificationRateLimiter, async (req, res) => {
  try {
    const { email, product } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      // Return generic success to prevent email enumeration
      return res.json({
        success: true,
        message: 'If an account exists, a new verification code has been sent.'
      });
    }

    const validResendProducts = ['ai', 'cloud'];
    if (!validResendProducts.includes(product)) {
      return res.json({
        success: true,
        message: 'If an account exists, a new verification code has been sent.'
      });
    }

    const signup = await betaSignupModel.getByEmailAndProduct(email.trim(), product);

    // Not found or already verified → generic success (privacy)
    if (!signup || signup.email_verified_at || signup.status === 'converted' || signup.status === 'invite_sent') {
      return res.json({
        success: true,
        message: 'If an account exists, a new verification code has been sent.'
      });
    }

    // Generate new code + magic link token and store
    const { code, verifyUrl } = await generateAndStoreVerification(signup.id);

    // Send product-appropriate verification email
    const queueFn = product === 'cloud'
      ? emailClient.queueCloudBetaVerificationEmail
      : emailClient.queueBetaVerificationEmail;

    queueFn({
      firstName: signup.first_name,
      email: signup.email,
      code,
      verifyUrl
    }).then((correlationId) => {
      if (correlationId) {
        logger.info(`${product} beta verification email resent`, { signupId: signup.id, correlationId });
      }
    }).catch((err) => {
      logger.error(`Error resending ${product} beta verification email`, { signupId: signup.id, error: err.message });
    });

    return res.json({
      success: true,
      message: 'If an account exists, a new verification code has been sent.'
    });

  } catch (error) {
    logger.error('Beta resend-verification error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /api/support/beta/enroll
 * Authenticated endpoint — immediately grants beta access for logged-in users.
 * Skips email verification since the user already has a verified account.
 * Rate limited: 3 attempts per hour per IP
 */
router.post('/enroll', betaEnrollRateLimiter, async (req, res) => {
  try {
    const userId = req.headers['x-auth-subject'];
    const userEmail = req.headers['x-auth-email'];

    if (!userId || !userEmail) {
      return res.status(401).json({
        success: false,
        error: 'authentication_required',
        message: 'You must be logged in to enroll in beta'
      });
    }

    const { product, firstName, lastName } = req.body;
    const validProducts = ['cloud', 'ai'];
    if (!validProducts.includes(product)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_product',
        message: 'Product must be "cloud" or "ai"'
      });
    }

    // Check for existing signup
    const existingSignup = await betaSignupModel.getByEmailAndProduct(userEmail, product);

    if (existingSignup) {
      // Already converted or invite sent — idempotent success
      if (existingSignup.status === 'converted' || existingSignup.status === 'invite_sent') {
        return res.json({
          success: true,
          message: 'You already have beta access.'
        });
      }

      // Existing signup in another state — run post-verification directly
      return handlePostVerification(existingSignup, res);
    }

    // No signup exists — create one for admin tracking, then grant immediately
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                      req.headers['x-real-ip'] ||
                      req.socket?.remoteAddress ||
                      null;
    const userAgent = req.headers['user-agent'] || null;

    const signup = await betaSignupModel.createSignup({
      firstName: firstName || userEmail.split('@')[0],
      lastName: lastName || '',
      email: userEmail,
      ipAddress,
      userAgent,
      referrer: null,
      product
    });

    logger.info('Beta enrollment signup created', {
      signupId: signup.id,
      email: signup.email,
      product,
      userId
    });

    return handlePostVerification(signup, res);

  } catch (error) {
    // Handle unique constraint violation (race condition)
    if (error.code === '23505') {
      logger.info('Duplicate beta enroll (race condition)', { error: error.message });
      return res.json({
        success: true,
        message: 'Beta access is being processed.'
      });
    }

    logger.error('Beta enroll error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred. Please try again later.'
    });
  }
});

module.exports = router;
