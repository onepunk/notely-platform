const express = require('express');
const router = express.Router();
const shared = require('@notely/shared');
const { isAdmin } = shared.constants.roles;
const logger = shared.logger.child({ module: 'template-admin' });
const templateModel = require('../models/templateModel');
const emailService = require('../services/emailService');

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

function requireAuth(req, res, next) {
  const { userId } = getUserFromHeaders(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }
  req.userId = userId;
  next();
}

function requireAdmin(req, res, next) {
  const { role } = getUserFromHeaders(req);
  if (!isAdmin(role)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }
  next();
}

/**
 * GET / — List all templates
 */
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const templates = await templateModel.getAllTemplates();
    res.json({ success: true, templates });
  } catch (error) {
    logger.error('Failed to list templates', { error: error.message });
    next(error);
  }
});

/**
 * GET /:name — Get full template by name
 */
router.get('/:name', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const template = await templateModel.getTemplateByName(req.params.name);
    if (!template) {
      return res.status(404).json({ error: 'Not Found', message: `Template '${req.params.name}' not found` });
    }

    // Include whether the current content differs from the file default
    const defaultContent = templateModel.getDefaultContent(req.params.name);
    template.hasDefault = defaultContent !== null;
    template.isModified = defaultContent !== null && defaultContent !== template.html_content;

    res.json({ success: true, template });
  } catch (error) {
    logger.error('Failed to get template', { name: req.params.name, error: error.message });
    next(error);
  }
});

/**
 * PUT /:name — Update template
 */
router.put('/:name', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { htmlContent, subject, description, variables } = req.body;

    if (!htmlContent && !subject && !description && !variables) {
      return res.status(400).json({ error: 'Bad Request', message: 'At least one field to update is required' });
    }

    const updated = await templateModel.updateTemplate(req.params.name, {
      htmlContent,
      subject,
      description,
      variables,
      updatedBy: req.userId
    });

    if (!updated) {
      return res.status(404).json({ error: 'Not Found', message: `Template '${req.params.name}' not found` });
    }

    // Clear in-memory cache so next send uses the new content
    emailService.clearTemplateCache();

    logger.info('Template updated', { name: req.params.name, updatedBy: req.userId });
    res.json({ success: true, template: updated });
  } catch (error) {
    logger.error('Failed to update template', { name: req.params.name, error: error.message });
    next(error);
  }
});

/**
 * POST /:name/reset — Reset template to file default
 */
router.post('/:name/reset', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const reset = await templateModel.resetToDefault(req.params.name);

    if (!reset) {
      return res.status(404).json({ error: 'Not Found', message: `Template '${req.params.name}' not found` });
    }

    emailService.clearTemplateCache();

    logger.info('Template reset to default', { name: req.params.name, resetBy: req.userId });
    res.json({ success: true, template: reset });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Not Found', message: error.message });
    }
    logger.error('Failed to reset template', { name: req.params.name, error: error.message });
    next(error);
  }
});

/**
 * POST /:name/preview — Render a preview with sample data
 */
router.post('/:name/preview', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { sampleData = {}, htmlContent } = req.body;
    const name = req.params.name;

    // Use provided htmlContent (from editor) or load from DB
    let content;
    if (htmlContent) {
      content = htmlContent;
    } else {
      const template = await templateModel.getTemplateByName(name);
      if (!template) {
        return res.status(404).json({ error: 'Not Found', message: `Template '${name}' not found` });
      }
      content = template.html_content;
    }

    // Substitute variables
    const rendered = emailService.substituteVariables(content, sampleData);

    // If not the base template, wrap in base
    let html;
    if (name === 'base') {
      html = emailService.substituteVariables(rendered, {
        title: sampleData.title || 'Preview',
        content: sampleData.content || '<p>Sample content block</p>',
        footerText: sampleData.footerText || 'This email was sent by Notely. Please do not reply to this email.'
      });
    } else {
      html = await emailService.wrapInTemplate({
        title: sampleData.title || 'Preview',
        content: rendered,
        footerText: sampleData.footerText || 'This email was sent by Notely. Please do not reply to this email.'
      });
    }

    res.json({ success: true, html });
  } catch (error) {
    logger.error('Failed to render preview', { name: req.params.name, error: error.message });
    next(error);
  }
});

/**
 * POST /:name/test — Send a test email using this template
 */
router.post('/:name/test', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { recipientEmail, sampleData = {} } = req.body;
    const name = req.params.name;

    if (!recipientEmail) {
      return res.status(400).json({ error: 'Bad Request', message: 'recipientEmail is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid email address' });
    }

    if (name === 'base') {
      return res.status(400).json({ error: 'Bad Request', message: 'Cannot send test for the base wrapper template' });
    }

    // Load template from DB
    const template = await templateModel.getTemplateByName(name);
    if (!template) {
      return res.status(404).json({ error: 'Not Found', message: `Template '${name}' not found` });
    }

    // Render with sample data
    const rendered = emailService.substituteVariables(template.html_content, sampleData);
    const html = await emailService.wrapInTemplate({
      title: template.subject || `Test: ${name}`,
      content: rendered,
      footerText: 'This is a test email sent from the Notely admin panel.'
    });

    // Substitute variables in subject too
    const subject = emailService.substituteVariables(
      template.subject || `[Test] ${name}`,
      sampleData
    );

    await emailService.sendEmail({
      recipient: recipientEmail,
      subject: `[Test] ${subject}`,
      html,
      template: name
    });

    logger.info('Test email sent', { name, recipientEmail, sentBy: req.userId });
    res.json({ success: true, message: `Test email sent to ${recipientEmail}` });
  } catch (error) {
    logger.error('Failed to send test email', { name: req.params.name, error: error.message });
    next(error);
  }
});

module.exports = router;
