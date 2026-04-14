/**
 * Contact Form Routes - Public API for contact form submissions
 */

const express = require('express');
const https = require('https');
const shared = require('@notely/shared');
const contactModel = require('../models/contactModel');
const emailClient = require('../services/emailClient');

const logger = shared.logger.child({ module: 'support-contact-routes' });
const router = express.Router();

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

/**
 * Verify reCAPTCHA token with Google's API
 */
function verifyRecaptcha(token, remoteIp) {
  return new Promise((resolve, reject) => {
    const postData = `secret=${encodeURIComponent(RECAPTCHA_SECRET_KEY)}&response=${encodeURIComponent(token)}${remoteIp ? '&remoteip=' + encodeURIComponent(remoteIp) : ''}`;

    const options = {
      hostname: 'www.google.com',
      port: 443,
      path: '/recaptcha/api/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Failed to parse reCAPTCHA response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Rate limiter for contact form - 3 attempts per IP per 15 minutes
const contactRateLimiter = shared.middleware.rateLimiter.createEndpointLimiter('contact-form', {
  points: 3,                  // 3 submissions
  duration: 15 * 60,          // per 15 minutes
  blockDuration: 15 * 60      // block for 15 minutes if exceeded
});

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Valid product values
const VALID_PRODUCTS = ['general', 'ai', 'cloud', 'enterprise'];

/**
 * POST /api/support/contact
 * Public endpoint for contact form submissions
 * Rate limited: 3 attempts per IP per 15 minutes
 */
router.post('/', contactRateLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, product, message, recaptchaToken } = req.body;

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

    if (!product || !VALID_PRODUCTS.includes(product)) {
      errors.push({ field: 'product', message: 'Please select a valid product' });
    }

    if (!message || typeof message !== 'string' || message.trim().length < 1) {
      errors.push({ field: 'message', message: 'Message is required' });
    } else if (message.trim().length > 5000) {
      errors.push({ field: 'message', message: 'Message must be 5000 characters or less' });
    }

    if (!recaptchaToken || typeof recaptchaToken !== 'string') {
      errors.push({ field: 'recaptchaToken', message: 'reCAPTCHA verification is required' });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Please correct the errors below',
        errors
      });
    }

    // Verify reCAPTCHA with Google
    if (RECAPTCHA_SECRET_KEY) {
      try {
        const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                          req.headers['x-real-ip'] ||
                          req.socket?.remoteAddress || null;

        const recaptchaResult = await verifyRecaptcha(recaptchaToken, ipAddress);

        if (!recaptchaResult.success) {
          logger.warn('reCAPTCHA verification failed', {
            errorCodes: recaptchaResult['error-codes'],
            ipAddress
          });
          return res.status(400).json({
            success: false,
            error: 'recaptcha_failed',
            message: 'reCAPTCHA verification failed. Please try again.',
            errors: [{ field: 'recaptchaToken', message: 'reCAPTCHA verification failed' }]
          });
        }

        // v3 score check: 0.0 = likely bot, 1.0 = likely human
        const score = recaptchaResult.score;
        const action = recaptchaResult.action;

        logger.info('reCAPTCHA v3 result', { score, action, ipAddress });

        if (action !== 'contact_form') {
          logger.warn('reCAPTCHA action mismatch', { expected: 'contact_form', got: action, ipAddress });
          return res.status(400).json({
            success: false,
            error: 'recaptcha_failed',
            message: 'reCAPTCHA verification failed. Please try again.',
            errors: [{ field: 'recaptchaToken', message: 'reCAPTCHA verification failed' }]
          });
        }

        if (score < 0.5) {
          logger.warn('reCAPTCHA score too low', { score, ipAddress });
          return res.status(400).json({
            success: false,
            error: 'recaptcha_failed',
            message: 'Our system flagged this submission as suspicious. Please try again.',
            errors: [{ field: 'recaptchaToken', message: 'reCAPTCHA score too low' }]
          });
        }
      } catch (err) {
        logger.error('reCAPTCHA verification error', { error: err.message });
        return res.status(500).json({
          success: false,
          error: 'server_error',
          message: 'Could not verify reCAPTCHA. Please try again later.'
        });
      }
    } else {
      logger.warn('RECAPTCHA_SECRET_KEY not configured — skipping verification');
    }

    // Get client info
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                      req.headers['x-real-ip'] ||
                      req.socket?.remoteAddress ||
                      null;
    const userAgent = req.headers['user-agent'] || null;
    const referrer = req.headers['referer'] || req.headers['referrer'] || null;

    // Create submission record
    const submission = await contactModel.createSubmission({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      product,
      message: message.trim(),
      ipAddress,
      userAgent,
      referrer
    });

    logger.info('Contact form submission created', {
      submissionId: submission.id,
      email: submission.email,
      product,
      ipAddress
    });

    // Queue support notification email (async, don't block response)
    emailClient.queueContactSupportNotification({
      firstName: submission.first_name,
      lastName: submission.last_name,
      email: submission.email,
      product,
      message: message.trim(),
      ipAddress,
      createdAt: submission.created_at
    }).then(async (correlationId) => {
      if (correlationId) {
        await contactModel.markSupportNotified(submission.id);
        logger.info('Contact support notification queued', { submissionId: submission.id, correlationId });
      } else {
        logger.warn('Failed to queue contact support notification', { submissionId: submission.id });
      }
    }).catch((err) => {
      logger.error('Error queueing contact support notification', { submissionId: submission.id, error: err.message });
    });

    // Queue confirmation email to user (async, don't block response)
    emailClient.queueContactConfirmationEmail({
      firstName: submission.first_name,
      email: submission.email
    }).then(async (correlationId) => {
      if (correlationId) {
        await contactModel.markConfirmationSent(submission.id);
        logger.info('Contact confirmation email queued', { submissionId: submission.id, correlationId });
      } else {
        logger.warn('Failed to queue contact confirmation email', { submissionId: submission.id });
      }
    }).catch((err) => {
      logger.error('Error queueing contact confirmation email', { submissionId: submission.id, error: err.message });
    });

    return res.json({
      success: true,
      message: "Thank you for your message! We'll get back to you soon."
    });

  } catch (error) {
    logger.error('Contact form submission error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'An error occurred. Please try again later.'
    });
  }
});

module.exports = router;
