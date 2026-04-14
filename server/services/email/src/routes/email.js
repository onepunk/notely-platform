/**
 * Email routes
 * Handles email sending requests
 */

const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const shared = require('@notely/shared');
const { isAdmin } = shared.constants.roles;
const logger = shared.logger;

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
 * Check if user is authenticated
 */
function requireAuth(req, res, next) {
  const { userId } = getUserFromHeaders(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }
  next();
}

/**
 * Check if user is admin
 */
function requireAdmin(req, res, next) {
  const { role } = getUserFromHeaders(req);
  if (!isAdmin(role)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }
  next();
}

/**
 * POST /api/email/send
 * Send a custom email (admin only)
 */
router.post('/send', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { to, subject, html, text } = req.body;

    // Validate required fields
    if (!to || !subject || (!html && !text)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'To, subject, and content (html or text) are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid email address'
      });
    }

    const result = await emailService.sendEmail({ to, subject, html, text });

    res.status(200).json({
      success: true,
      messageId: result.messageId,
      message: 'Email sent successfully'
    });
  } catch (error) {
    logger.error('Failed to send email', { error: error.message });
    next(error);
  }
});

/**
 * POST /api/email/send-template
 * Send an email using a template (admin only)
 */
router.post('/send-template', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { to, subject, template, templateData } = req.body;

    // Validate required fields
    if (!to || !subject || !template) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'To, subject, and template are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid email address'
      });
    }

    const result = await emailService.sendTemplate(template, {
      to,
      subject,
      templateData: templateData || {}
    });

    res.status(200).json({
      success: true,
      messageId: result.messageId,
      message: 'Template email sent successfully'
    });
  } catch (error) {
    if (error.message.includes('Template not found')) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message
      });
    }
    logger.error('Failed to send template email', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/email/templates
 * List available email templates (admin only)
 */
router.get('/templates', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');

    const templatesDir = path.join(__dirname, '../templates');
    const files = await fs.readdir(templatesDir);

    const templates = files
      .filter(f => f.endsWith('.html') && f !== 'base.html')
      .map(f => f.replace('.html', ''));

    res.json({
      success: true,
      templates
    });
  } catch (error) {
    logger.error('Failed to list templates', { error: error.message });
    next(error);
  }
});

module.exports = router;
