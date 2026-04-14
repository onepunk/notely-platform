/**
 * Admin Beta Signups Management Routes
 * Handles listing beta signups and sending invitation emails
 */

const express = require('express');
const router = express.Router();
const betaSignupModel = require('../models/betaSignupModel');
const emailClient = require('../services/emailClient');
const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'support-beta-admin-routes' });

// Portal URL for invitation links - set by configure-domains.sh via PORTAL_URL env var
const PORTAL_URL = process.env.PORTAL_URL;
if (!PORTAL_URL) {
  throw new Error('PORTAL_URL environment variable is required');
}

// License service URL for generating AI beta licenses
const LICENSE_SERVICE_URL = process.env.LICENSE_SERVICE_URL;
if (!LICENSE_SERVICE_URL) {
  throw new Error('LICENSE_SERVICE_URL environment variable is required');
}

// Auth service URL for admin user creation during conversion
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL;
if (!AUTH_SERVICE_URL) {
  throw new Error('AUTH_SERVICE_URL environment variable is required');
}

/**
 * Extract user info from gateway-injected headers
 */
function getUserFromHeaders(req) {
  return {
    userId: req.headers['x-auth-subject'],
    email: req.headers['x-auth-email'],
    role: req.headers['x-auth-role']
  };
}

/**
 * Check if user has admin role
 */
function requireAdmin(req, res, next) {
  const { userId, role } = getUserFromHeaders(req);
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Authentication required'
    });
  }
  if (!['admin', 'super_admin'].includes(role)) {
    return res.status(403).json({
      success: false,
      error: 'forbidden',
      message: 'Admin access required'
    });
  }
  next();
}

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and sanitize pagination parameters
 */
function sanitizePagination(limit, offset, maxLimit = 100) {
  let sanitizedLimit = parseInt(limit, 10);
  let sanitizedOffset = parseInt(offset, 10);

  if (isNaN(sanitizedLimit) || sanitizedLimit < 1) {
    sanitizedLimit = 50;
  }
  if (isNaN(sanitizedOffset) || sanitizedOffset < 0) {
    sanitizedOffset = 0;
  }

  sanitizedLimit = Math.min(sanitizedLimit, maxLimit);

  return { limit: sanitizedLimit, offset: sanitizedOffset };
}

/**
 * GET /api/support/admin/beta-signups
 * List all beta signups with pagination
 */
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { status, limit: rawLimit = 50, offset: rawOffset = 0 } = req.query;
    const { limit, offset } = sanitizePagination(rawLimit, rawOffset, 100);

    const signups = await betaSignupModel.listSignups({ limit, offset, status });
    const total = await betaSignupModel.countSignups(status);

    // Transform snake_case to camelCase for frontend
    const transformedSignups = signups.map(signup => ({
      id: signup.id,
      firstName: signup.first_name,
      lastName: signup.last_name,
      email: signup.email,
      status: signup.status,
      product: signup.product || 'cloud',
      createdAt: signup.created_at,
      confirmationSentAt: signup.confirmation_sent_at,
      adminNotifiedAt: signup.admin_notified_at,
      invitationSentAt: signup.invitation_sent_at,
      tokenExpiresAt: signup.access_token_expires_at,
      tokenUsedAt: signup.access_token_used_at,
      // Computed fields for UI
      hasActiveToken: signup.access_token_expires_at &&
                      new Date(signup.access_token_expires_at) > new Date() &&
                      !signup.access_token_used_at,
      tokenExpired: signup.access_token_expires_at &&
                    new Date(signup.access_token_expires_at) <= new Date() &&
                    !signup.access_token_used_at
    }));

    res.json({
      success: true,
      data: {
        signups: transformedSignups,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + signups.length < total
        }
      }
    });
  } catch (error) {
    logger.error('Failed to list beta signups', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/support/admin/beta-signups
 * Create a new beta signup (admin-initiated)
 * Follows same flow as public signup but without rate limiting and with admin context
 */
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { firstName, lastName, email, product } = req.body;
    const { userId: adminId, email: adminEmail } = getUserFromHeaders(req);

    // Validate product
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

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Please correct the errors below',
        errors
      });
    }

    // Check for duplicate email
    const exists = await betaSignupModel.emailExists(email.trim());
    if (exists) {
      return res.status(409).json({
        success: false,
        error: 'duplicate_email',
        message: 'A signup with this email already exists'
      });
    }

    // Create signup record (admin-initiated, so no IP/user-agent tracking needed)
    const signup = await betaSignupModel.createSignup({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      ipAddress: null,
      userAgent: null,
      referrer: `admin:${adminEmail}`,
      product: sanitizedProduct
    });

    logger.info('Admin-initiated beta signup created', {
      signupId: signup.id,
      email: signup.email,
      createdBy: adminId
    });

    // Queue confirmation email to user (same as public signup flow)
    emailClient.queueBetaConfirmationEmail({
      firstName: signup.first_name,
      lastName: signup.last_name,
      email: signup.email
    }).then(async (correlationId) => {
      if (correlationId) {
        await betaSignupModel.markConfirmationSent(signup.id);
        logger.info('Beta confirmation email queued (admin-initiated)', { signupId: signup.id, correlationId });
      } else {
        logger.warn('Failed to queue beta confirmation email (admin-initiated)', { signupId: signup.id });
      }
    }).catch((err) => {
      logger.error('Error queueing beta confirmation email (admin-initiated)', { signupId: signup.id, error: err.message });
    });

    // Note: Admin notification is skipped for admin-initiated signups since the admin already knows

    res.status(201).json({
      success: true,
      message: 'Beta signup created successfully',
      data: {
        id: signup.id,
        firstName: signup.first_name,
        lastName: signup.last_name,
        email: signup.email,
        status: signup.status,
        product: signup.product || sanitizedProduct,
        createdAt: signup.created_at
      }
    });
  } catch (error) {
    logger.error('Failed to create admin beta signup', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/support/admin/beta-signups/:id
 * Get a single beta signup by ID
 */
router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const signup = await betaSignupModel.getById(id);

    if (!signup) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Beta signup not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: signup.id,
        firstName: signup.first_name,
        lastName: signup.last_name,
        email: signup.email,
        status: signup.status,
        product: signup.product || 'cloud',
        createdAt: signup.created_at,
        confirmationSentAt: signup.confirmation_sent_at,
        adminNotifiedAt: signup.admin_notified_at,
        invitationSentAt: signup.invitation_sent_at,
        tokenExpiresAt: signup.access_token_expires_at,
        tokenUsedAt: signup.access_token_used_at,
        ipAddress: signup.ip_address,
        userAgent: signup.user_agent,
        referrer: signup.referrer,
        notes: signup.notes
      }
    });
  } catch (error) {
    logger.error('Failed to get beta signup', { signupId: req.params.id, error: error.message });
    next(error);
  }
});

/**
 * POST /api/support/admin/beta-signups/:id/send-invitation
 * Generate a new access token and send invitation email
 */
router.post('/:id/send-invitation', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminBcc } = req.body || {};
    const { userId: adminId } = getUserFromHeaders(req);

    // Get the signup
    const signup = await betaSignupModel.getById(id);
    if (!signup) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Beta signup not found'
      });
    }

    // Check if already converted
    if (signup.status === 'converted') {
      return res.status(409).json({
        success: false,
        error: 'already_converted',
        message: 'This signup has already been converted to a user account'
      });
    }

    // Generate token and update record (overwrites any existing token)
    const result = await betaSignupModel.createAccessToken(id, adminId);
    if (!result) {
      return res.status(500).json({
        success: false,
        error: 'token_generation_failed',
        message: 'Failed to generate access token'
      });
    }

    // Build the access URL
    const accessUrl = `${PORTAL_URL}/login?beta_token=${encodeURIComponent(result.token)}`;

    // Queue the invitation email (with optional admin BCC)
    const correlationId = await emailClient.queueBetaInvitationEmail({
      firstName: result.signup.first_name,
      email: result.signup.email,
      accessUrl,
      expiresIn: '7 days',
      adminBcc: Boolean(adminBcc)
    });

    if (!correlationId) {
      logger.warn('Failed to queue beta invitation email', { signupId: id });
    } else {
      logger.info('Beta invitation email queued', { signupId: id, correlationId, adminBcc: Boolean(adminBcc) });
    }

    res.json({
      success: true,
      message: 'Beta invitation sent successfully',
      data: {
        signupId: id,
        email: result.signup.email,
        expiresAt: result.expiresAt.toISOString(),
        emailQueued: !!correlationId
      }
    });
  } catch (error) {
    logger.error('Failed to send beta invitation', { signupId: req.params.id, error: error.message });
    next(error);
  }
});

/**
 * POST /api/support/admin/beta-signups/:id/resend-invitation
 * Clear expired token and send a new invitation
 */
router.post('/:id/resend-invitation', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { userId: adminId } = getUserFromHeaders(req);

    // Get the signup
    const signup = await betaSignupModel.getById(id);
    if (!signup) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Beta signup not found'
      });
    }

    // Check if already converted
    if (signup.status === 'converted') {
      return res.status(409).json({
        success: false,
        error: 'already_converted',
        message: 'This signup has already been converted to a user account'
      });
    }

    // Check if there's an active (non-expired) token
    const hasActive = await betaSignupModel.hasActiveToken(id);
    if (hasActive) {
      return res.status(409).json({
        success: false,
        error: 'active_token_exists',
        message: 'Cannot resend while an active invitation exists. The current token is still valid.'
      });
    }

    // Clear any expired token
    await betaSignupModel.clearExpiredToken(id);

    // Generate new token and update record
    const result = await betaSignupModel.createAccessToken(id, adminId);
    if (!result) {
      return res.status(500).json({
        success: false,
        error: 'token_generation_failed',
        message: 'Failed to generate access token'
      });
    }

    // Build the access URL
    const accessUrl = `${PORTAL_URL}/login?beta_token=${encodeURIComponent(result.token)}`;

    // Queue the invitation email
    const correlationId = await emailClient.queueBetaInvitationEmail({
      firstName: result.signup.first_name,
      email: result.signup.email,
      accessUrl,
      expiresIn: '7 days'
    });

    if (!correlationId) {
      logger.warn('Failed to queue beta invitation email (resend)', { signupId: id });
    } else {
      logger.info('Beta invitation email re-queued', { signupId: id, correlationId });
    }

    res.json({
      success: true,
      message: 'Beta invitation resent successfully',
      data: {
        signupId: id,
        email: result.signup.email,
        expiresAt: result.expiresAt.toISOString(),
        emailQueued: !!correlationId
      }
    });
  } catch (error) {
    logger.error('Failed to resend beta invitation', { signupId: req.params.id, error: error.message });
    next(error);
  }
});

/**
 * POST /api/support/admin/beta-signups/:id/send-ai-invitation
 * Generate a Notely AI license key and send it via email
 */
router.post('/:id/send-ai-invitation', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminBcc } = req.body || {};
    const { userId: adminId } = getUserFromHeaders(req);

    // Get the signup
    const signup = await betaSignupModel.getById(id);
    if (!signup) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Beta signup not found'
      });
    }

    // Verify this is an AI signup
    if (signup.product !== 'ai') {
      return res.status(400).json({
        success: false,
        error: 'wrong_product',
        message: 'This signup is not for Notely AI. Use send-invitation for Cloud signups.'
      });
    }

    // Check if already invited or converted
    if (signup.status === 'invite_sent' || signup.status === 'converted') {
      return res.status(409).json({
        success: false,
        error: signup.status === 'converted' ? 'already_converted' : 'already_invited',
        message: signup.status === 'converted'
          ? 'This signup has already been converted'
          : 'An invitation has already been sent for this signup'
      });
    }

    // Generate a Notely AI license via the license service
    let licenseKey = null;
    try {
      const licenseResponse = await fetch(
        `${LICENSE_SERVICE_URL}/api/license/admin/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-service': 'support',
            'x-auth-subject': adminId,
            'x-auth-role': 'admin'
          },
          body: JSON.stringify({
            productType: 'notely-ai',
            type: 'subscription',
            email: signup.email,
            expiresAt: '2026-04-30T23:59:59Z',
            activationLimit: 1,
            notes: `Beta invitation - signup ID: ${signup.id}, email: ${signup.email}`
          })
        }
      );

      if (!licenseResponse.ok) {
        const errorData = await licenseResponse.json().catch(() => ({}));
        logger.error('License generation failed', {
          signupId: id,
          status: licenseResponse.status,
          error: errorData.message || errorData.error
        });
        return res.status(502).json({
          success: false,
          error: 'license_generation_failed',
          message: errorData.message || 'Failed to generate license key'
        });
      }

      const licenseData = await licenseResponse.json();
      licenseKey = licenseData.licenseKey;
    } catch (fetchError) {
      logger.error('Failed to contact license service', {
        signupId: id,
        error: fetchError.message
      });
      return res.status(502).json({
        success: false,
        error: 'license_service_unavailable',
        message: 'Could not reach the license service'
      });
    }

    // Queue the AI license email
    const correlationId = await emailClient.queueNotelyAiLicenseEmail({
      firstName: signup.first_name,
      email: signup.email,
      licenseKey,
      expiresAt: 'April 30, 2026',
      adminBcc: Boolean(adminBcc)
    });

    if (!correlationId) {
      logger.warn('Failed to queue AI license email', { signupId: id });
    } else {
      logger.info('AI license email queued', { signupId: id, correlationId, adminBcc: Boolean(adminBcc) });
    }

    // Update invitation tracking fields
    const updateQuery = `
      UPDATE support.beta_signups
      SET invitation_sent_at = NOW(),
          invitation_sent_by = $2,
          status = 'invite_sent'
      WHERE id = $1
      RETURNING id
    `;
    await require('@notely/shared').database.query(updateQuery, [id, adminId]);

    logger.info('AI beta invitation sent', {
      signupId: id,
      email: signup.email,
      adminId
    });

    res.json({
      success: true,
      message: 'Notely AI license generated and emailed successfully',
      data: {
        signupId: id,
        email: signup.email,
        licenseGenerated: true,
        emailQueued: !!correlationId
      }
    });
  } catch (error) {
    logger.error('Failed to send AI invitation', { signupId: req.params.id, error: error.message });
    next(error);
  }
});

/**
 * POST /api/support/admin/beta-signups/:id/convert
 * Convert a beta signup into a full platform user with a license.
 * Creates the user account via auth service, generates a license, and marks as converted.
 */
router.post('/:id/convert', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { product } = req.body || {};
    const { userId: adminId } = getUserFromHeaders(req);

    // Get the signup
    const signup = await betaSignupModel.getById(id);
    if (!signup) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Beta signup not found'
      });
    }

    // Check if already converted or unsubscribed
    if (signup.status === 'converted') {
      return res.status(409).json({
        success: false,
        error: 'already_converted',
        message: 'This signup has already been converted'
      });
    }
    if (signup.status === 'unsubscribed') {
      return res.status(409).json({
        success: false,
        error: 'unsubscribed',
        message: 'This signup has unsubscribed and cannot be converted'
      });
    }

    // Determine product type — use request body or fall back to signup's product
    const validProducts = ['cloud', 'ai'];
    const selectedProduct = validProducts.includes(product) ? product : (signup.product || 'cloud');

    // Step 1: Create user account via auth service
    let userId = null;
    try {
      const authResponse = await fetch(
        `${AUTH_SERVICE_URL}/internal/admin-create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-service': 'support'
          },
          body: JSON.stringify({
            email: signup.email,
            firstName: signup.first_name,
            lastName: signup.last_name
          })
        }
      );

      if (authResponse.status === 409) {
        // User already exists — extract their ID from the response
        const existingData = await authResponse.json();
        userId = existingData.user?.id;
        logger.info('User already exists, proceeding with existing account', {
          signupId: id,
          email: signup.email,
          userId
        });
      } else if (!authResponse.ok) {
        const errorData = await authResponse.json().catch(() => ({}));
        logger.error('Auth service user creation failed', {
          signupId: id,
          status: authResponse.status,
          error: errorData.message || errorData.error
        });
        return res.status(502).json({
          success: false,
          error: 'user_creation_failed',
          message: errorData.message || 'Failed to create user account'
        });
      } else {
        const authData = await authResponse.json();
        userId = authData.user?.id;
      }
    } catch (fetchError) {
      logger.error('Failed to contact auth service', {
        signupId: id,
        error: fetchError.message
      });
      return res.status(502).json({
        success: false,
        error: 'auth_service_unavailable',
        message: 'Could not reach the authentication service'
      });
    }

    if (!userId) {
      return res.status(502).json({
        success: false,
        error: 'user_id_missing',
        message: 'User was created but no user ID was returned'
      });
    }

    // Step 2: Generate license via license service
    try {
      const licenseResponse = await fetch(
        `${LICENSE_SERVICE_URL}/api/license/admin/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-service': 'support',
            'x-auth-subject': adminId,
            'x-auth-role': 'admin'
          },
          body: JSON.stringify({
            productType: selectedProduct === 'ai' ? 'notely-ai' : 'desktop',
            type: 'subscription',
            userId,
            email: signup.email,
            expiresAt: '2026-04-30T23:59:59Z',
            activationLimit: 1,
            notes: `Admin conversion — signup ID: ${id}, email: ${signup.email}`
          })
        }
      );

      if (!licenseResponse.ok) {
        const errorData = await licenseResponse.json().catch(() => ({}));
        logger.error('License generation failed during conversion', {
          signupId: id,
          status: licenseResponse.status,
          error: errorData.message || errorData.error
        });
        return res.status(502).json({
          success: false,
          error: 'license_generation_failed',
          message: errorData.message || 'Failed to generate license'
        });
      }
    } catch (fetchError) {
      logger.error('Failed to contact license service during conversion', {
        signupId: id,
        error: fetchError.message
      });
      return res.status(502).json({
        success: false,
        error: 'license_service_unavailable',
        message: 'Could not reach the license service'
      });
    }

    // Step 3: Mark signup as converted and link to user account
    const db = require('@notely/shared').database;
    const updateQuery = `
      UPDATE support.beta_signups
      SET status = 'converted',
          user_id = $2
      WHERE id = $1
      RETURNING id
    `;
    await db.query(updateQuery, [id, userId]);

    logger.info('Beta signup converted to full user', {
      signupId: id,
      email: signup.email,
      userId,
      product: selectedProduct,
      adminId
    });

    res.json({
      success: true,
      message: `Account created and license assigned for ${signup.email}`,
      data: {
        signupId: id,
        userId,
        licenseGenerated: true,
        product: selectedProduct
      }
    });
  } catch (error) {
    logger.error('Failed to convert beta signup', { signupId: req.params.id, error: error.message });
    next(error);
  }
});

/**
 * DELETE /admin/beta-signups/:id
 * Delete a beta signup (admin only)
 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get signup to check if it exists
    const signup = await betaSignupModel.getById(id);
    if (!signup) {
      return res.status(404).json({
        success: false,
        error: 'signup_not_found',
        message: 'Beta signup not found'
      });
    }

    // Delete the signup
    await betaSignupModel.deleteById(id);

    logger.info('Beta signup deleted', {
      signupId: id,
      email: signup.email,
      deletedBy: getUserFromHeaders(req).userId
    });

    res.json({
      success: true,
      message: 'Beta signup deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete beta signup', { signupId: req.params.id, error: error.message });
    next(error);
  }
});

/**
 * POST /admin/beta-signups/internal/mark-converted
 * Internal endpoint: mark an AI beta signup as converted after license activation.
 * Called by the license service — requires x-internal-service header.
 */
router.post('/internal/mark-converted', async (req, res, next) => {
  try {
    const internalService = req.headers['x-internal-service'];
    if (!internalService) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'This endpoint is for internal service use only'
      });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'missing_email',
        message: 'Email is required'
      });
    }

    const db = require('@notely/shared').database;
    const query = `
      UPDATE support.beta_signups
      SET status = 'converted',
          user_id = (SELECT id FROM global_auth.user_credentials WHERE LOWER(email) = LOWER($1) LIMIT 1)
      WHERE email = $1
        AND status = 'invite_sent'
        AND product = 'ai'
      RETURNING id, email, status, user_id
    `;

    const result = await db.query(query, [email.toLowerCase()]);

    if (result.rows.length === 0) {
      logger.info('No matching invite_sent signup found for conversion', { email });
      return res.json({
        success: true,
        converted: false,
        message: 'No matching invite_sent signup found'
      });
    }

    logger.info('Beta signup marked as converted after license activation', {
      signupId: result.rows[0].id,
      email: result.rows[0].email,
      triggeredBy: internalService
    });

    res.json({
      success: true,
      converted: true,
      signupId: result.rows[0].id
    });
  } catch (error) {
    logger.error('Failed to mark beta signup as converted', { error: error.message });
    next(error);
  }
});

/**
 * POST /admin/beta-signups/internal/send-license-email
 * Internal endpoint: send (or re-send) a license key email.
 * Called by the license service after reissuing a beta license.
 * Requires x-internal-service header.
 */
router.post('/internal/send-license-email', async (req, res, next) => {
  try {
    const internalService = req.headers['x-internal-service'];
    if (!internalService) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'This endpoint is for internal service use only'
      });
    }

    const { firstName, email, licenseKey, expiresAt, product, adminBcc } = req.body;
    if (!email || !licenseKey) {
      return res.status(400).json({
        success: false,
        error: 'missing_fields',
        message: 'email and licenseKey are required'
      });
    }

    if (product === 'notely-ai') {
      const correlationId = await emailClient.queueNotelyAiLicenseEmail({
        firstName: firstName || 'User',
        email,
        licenseKey,
        expiresAt: expiresAt || 'April 30, 2026',
        adminBcc: Boolean(adminBcc)
      });

      logger.info('License email queued via internal endpoint', {
        email,
        product,
        correlationId,
        triggeredBy: internalService
      });

      return res.json({
        success: true,
        emailQueued: !!correlationId,
        correlationId
      });
    }

    // For desktop/cloud licenses, no email template exists yet
    return res.json({
      success: true,
      emailQueued: false,
      message: 'No email template for desktop licenses - license is fetched via API'
    });
  } catch (error) {
    logger.error('Failed to send license email via internal endpoint', { error: error.message });
    next(error);
  }
});

module.exports = router;
