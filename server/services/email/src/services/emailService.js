/**
 * Email Service - Sends emails via Microsoft Graph API
 * Supports HTML templates with retry logic and proper error handling
 */

const fs = require('fs');
const path = require('path');
const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'email-service' });
const metrics = require('../utils/metrics');
const eventPublisher = require('./eventPublisher');
const templateModel = require('../models/templateModel');
const emailLogModel = require('../models/emailLogModel');

// Template directory path
const TEMPLATES_DIR = path.join(__dirname, '../templates');

// Template cache to avoid repeated file reads
const templateCache = new Map();

// Microsoft Graph configuration
const GRAPH_CLIENT_ID = process.env.MAIL_APP_CLIENT_ID;
const GRAPH_CLIENT_SECRET = process.env.MAIL_APP_CLIENT_SECRET;
const GRAPH_TENANT_ID = process.env.MAIL_TENANT_ID;
const GRAPH_SENDER_EMAIL = process.env.MICROSOFT_SENDER_EMAIL;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Notely';

const FETCH_TIMEOUT_MS = parseInt(process.env.EMAIL_FETCH_TIMEOUT_MS || '10000', 10);

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // 1s, 2s, 4s

let cachedGraphToken = null;
let graphTokenExpiresAt = 0;

/**
 * Check if Graph email configuration is available
 */
function hasGraphConfig() {
  return Boolean(GRAPH_CLIENT_ID && GRAPH_CLIENT_SECRET && GRAPH_TENANT_ID && GRAPH_SENDER_EMAIL);
}

/**
 * Get Graph API access token (with caching)
 * Token is renewed 60 seconds before expiration
 */
async function getGraphAccessToken() {
  if (!hasGraphConfig()) {
    return null;
  }

  const now = Date.now();
  // Renew 60 seconds before expiration
  if (cachedGraphToken && now < graphTokenExpiresAt) {
    return cachedGraphToken;
  }

  const params = new URLSearchParams();
  params.set('client_id', GRAPH_CLIENT_ID);
  params.set('client_secret', GRAPH_CLIENT_SECRET);
  params.set('grant_type', 'client_credentials');
  params.set('scope', 'https://graph.microsoft.com/.default');

  const tokenUrl = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph token request failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('Graph token response missing access_token');
    }

    cachedGraphToken = data.access_token;
    const expiresIn = Number(data.expires_in) || 3600;
    // Renew 60 seconds before actual expiration
    graphTokenExpiresAt = now + (expiresIn - 60) * 1000;

    logger.debug('Graph access token obtained', { expiresIn });
    return cachedGraphToken;
  } catch (error) {
    logger.error('Failed to obtain Graph access token', { error: error.message });
    cachedGraphToken = null;
    graphTokenExpiresAt = 0;
    return null;
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send an email via Microsoft Graph API with retry logic
 * @param {Object} options - Email options
 * @param {string} options.recipient - Recipient email address (or use 'to' for backward compatibility)
 * @param {string} options.to - Alias for recipient (backward compatibility)
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} [options.text] - Plain text fallback (optional)
 * @param {string} [options.template] - Template name for metrics (optional)
 * @param {string[]} [options.cc] - CC recipients (optional)
 * @param {string[]} [options.bcc] - BCC recipients (optional)
 * @param {string} [options.replyTo] - Reply-to email address (optional)
 * @param {string} [options.from] - Override sender email address (optional, defaults to MICROSOFT_SENDER_EMAIL)
 * @param {string} [options.fromName] - Override sender display name (optional, defaults to EMAIL_FROM_NAME)
 * @returns {Promise<Object>} - Send result with success status
 */
async function sendEmail({ recipient, to, subject, html, text, template, cc = [], bcc = [], replyTo, from, fromName, correlationId }) {
  // Support both 'recipient' and 'to' parameter names for backward compatibility
  const recipientEmail = recipient || to;
  // Ensure cc and bcc are arrays
  const ccRecipients = Array.isArray(cc) ? cc : [];
  const bccRecipients = Array.isArray(bcc) ? bcc : [];

  if (!hasGraphConfig()) {
    const error = new Error('Graph mail configuration is missing; cannot send email');
    logger.error(error.message, {
      hasClientId: Boolean(GRAPH_CLIENT_ID),
      hasSecret: Boolean(GRAPH_CLIENT_SECRET),
      hasTenant: Boolean(GRAPH_TENANT_ID),
      hasSender: Boolean(GRAPH_SENDER_EMAIL)
    });

    if (template) {
      metrics.recordEmailFailed(template, 'config_missing');
      await eventPublisher.publishEmailFailed({ to: recipientEmail, subject, template }, error);
    }

    throw error;
  }

  const token = await getGraphAccessToken();
  if (!token) {
    const error = new Error('Failed to obtain Graph access token');
    if (template) {
      metrics.recordEmailFailed(template, 'auth_failed');
      await eventPublisher.publishEmailFailed({ to: recipientEmail, subject, template }, error);
    }
    throw error;
  }

  const senderEmail = from || GRAPH_SENDER_EMAIL;
  const senderName = fromName || EMAIL_FROM_NAME;
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`;

  const payload = {
    message: {
      subject,
      body: {
        contentType: 'HTML',
        content: html
      },
      toRecipients: [
        {
          emailAddress: { address: recipientEmail }
        }
      ],
      from: {
        emailAddress: {
          address: senderEmail,
          name: senderName
        }
      }
    },
    saveToSentItems: false
  };

  // Add CC recipients if provided
  if (ccRecipients.length > 0) {
    payload.message.ccRecipients = ccRecipients.map(email => ({
      emailAddress: { address: email }
    }));
  }

  // Add BCC recipients if provided
  if (bccRecipients.length > 0) {
    payload.message.bccRecipients = bccRecipients.map(email => ({
      emailAddress: { address: email }
    }));
  }

  // Add Reply-To if provided
  if (replyTo) {
    payload.message.replyTo = [
      { emailAddress: { address: replyTo } }
    ];
  }

  // Log to email.email_logs (non-fatal — never block delivery)
  let logId = null;
  try {
    logId = await emailLogModel.createLog({
      correlationId,
      recipient: recipientEmail,
      subject,
      templateName: template || null,
      metadata: {
        ccCount: ccRecipients.length,
        bccCount: bccRecipients.length
      }
    });
  } catch (logError) {
    logger.warn('Failed to create email log row', { error: logError.message });
  }

  let lastError = null;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Graph sendMail failed: ${response.status} ${body}`);
      }

      // Success
      const messageId = `graph-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      if (logId) {
        try { await emailLogModel.markSent(logId); } catch (logError) {
          logger.warn('Failed to mark email log as sent', { logId, error: logError.message });
        }
      }

      logger.info('Email sent successfully via Microsoft Graph', {
        recipient: recipientEmail,
        subject,
        sender: senderEmail,
        template: template || 'custom',
        attempt: attempt + 1,
        messageId,
        ccCount: ccRecipients.length,
        bccCount: bccRecipients.length
      });

      if (template) {
        metrics.recordEmailSent(template, 'user');
        await eventPublisher.publishEmailSent({
          messageId,
          to: recipientEmail,
          subject,
          template
        });
      }

      return { success: true, recipient: recipientEmail, subject, messageId };
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === MAX_RETRIES - 1;

      logger.warn('Email send attempt failed', {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        recipient: recipientEmail,
        subject,
        error: error.message,
        willRetry: !isLastAttempt
      });

      // Don't sleep after the last attempt
      if (!isLastAttempt) {
        const delay = RETRY_DELAYS[attempt];
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  if (logId) {
    try { await emailLogModel.markFailed(logId, lastError.message); } catch (logError) {
      logger.warn('Failed to mark email log as failed', { logId, error: logError.message });
    }
  }

  logger.error('Failed to send email after all retries', {
    recipient: recipientEmail,
    subject,
    template: template || 'custom',
    maxRetries: MAX_RETRIES,
    error: lastError.message
  });

  if (template) {
    metrics.recordEmailFailed(template, lastError.code || 'unknown');
    await eventPublisher.publishEmailFailed({ to: recipientEmail, subject, template }, lastError);
  }

  throw lastError;
}

/**
 * Load a template — DB-first with file fallback
 * Uses caching to avoid repeated lookups
 * @param {string} templateName - Name of the template (without .html extension)
 * @returns {Promise<string>} - Template content
 */
async function loadTemplate(templateName) {
  const cacheKey = templateName;

  if (templateCache.has(cacheKey)) {
    return templateCache.get(cacheKey);
  }

  // Try DB first
  try {
    const row = await templateModel.getTemplateByName(templateName);
    if (row) {
      templateCache.set(cacheKey, row.html_content);
      logger.debug('Template loaded from DB and cached', { templateName });
      return row.html_content;
    }
  } catch (dbError) {
    logger.warn('DB template lookup failed, falling back to file', { templateName, error: dbError.message });
  }

  // Fall back to file system
  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  try {
    const content = fs.readFileSync(templatePath, 'utf8');
    templateCache.set(cacheKey, content);
    logger.debug('Template loaded from file and cached', { templateName });
    return content;
  } catch (error) {
    logger.error('Failed to load email template', { templateName, error: error.message });
    throw new Error(`Email template not found: ${templateName}`);
  }
}

/**
 * Replace template variables with actual values
 * Supports:
 *   - {{variableName}} - simple substitution
 *   - {{#if variableName}}content{{/if}} - conditional (truthy check)
 *   - {{#if variableName}}content{{else}}alternative{{/if}} - conditional with else
 * @param {string} template - Template string with placeholders
 * @param {Object} variables - Key-value pairs for substitution
 * @returns {string} - Processed template
 */
function substituteVariables(template, variables) {
  let result = template;

  // Process simple conditionals FIRST (no else clause)
  // Use negative lookahead to avoid matching across other {{#if or {{else}} tags
  const ifOnlyPattern = /\{\{#if\s+(\w+)\}\}((?:(?!\{\{#if|\{\{else\}\}|\{\{\/if\}\})[\s\S])*?)\{\{\/if\}\}/;
  while (true) {
    const match = result.match(ifOnlyPattern);
    if (!match) break;
    const [fullMatch, key, content] = match;
    const value = variables[key];
    const isTruthy = value !== undefined && value !== null && value !== '' && value !== false;
    result = result.replace(fullMatch, isTruthy ? content : '');
  }

  // Then process if-else conditionals
  // Use negative lookahead to avoid matching across other {{#if or {{/if}} tags
  const ifElsePattern = /\{\{#if\s+(\w+)\}\}((?:(?!\{\{#if|\{\{\/if\}\})[\s\S])*?)\{\{else\}\}((?:(?!\{\{#if|\{\{\/if\}\})[\s\S])*?)\{\{\/if\}\}/;
  while (true) {
    const match = result.match(ifElsePattern);
    if (!match) break;
    const [fullMatch, key, ifContent, elseContent] = match;
    const value = variables[key];
    const isTruthy = value !== undefined && value !== null && value !== '' && value !== false;
    result = result.replace(fullMatch, isTruthy ? ifContent : elseContent);
  }

  // Finally, process simple variable substitution: {{var}}
  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables.hasOwnProperty(key) ? variables[key] : match;
  });

  return result;
}

/**
 * Wrap content in base template
 * @param {Object} options - Template options
 * @param {string} options.title - Email title
 * @param {string} options.content - HTML content to insert
 * @param {string} [options.footerText] - Custom footer text
 * @returns {Promise<string>} - Complete HTML email
 */
async function wrapInTemplate({ title, content, footerText }) {
  const baseTemplate = await loadTemplate('base');

  return substituteVariables(baseTemplate, {
    title,
    content,
    footerText: footerText || 'This email was sent by Notely. Please do not reply to this email.'
  });
}

/**
 * Send templated email
 * @param {Object} options - Email options
 * @param {string} options.recipient - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.templateName - Template name (without .html)
 * @param {Object} [options.variables] - Variables for template substitution
 * @param {string} [options.footerText] - Custom footer text
 * @param {string[]} [options.cc] - CC recipients
 * @param {string[]} [options.bcc] - BCC recipients
 * @param {string} [options.replyTo] - Reply-to email address
 * @param {string} [options.from] - Override sender email address
 * @param {string} [options.fromName] - Override sender display name
 * @returns {Promise<Object>} - Send result
 */
async function sendTemplatedEmail({ recipient, subject, templateName, variables = {}, footerText, cc = [], bcc = [], replyTo, from, fromName, correlationId }) {
  try {
    metrics.recordTemplateUsage(templateName);

    // Load and render template
    const contentTemplate = await loadTemplate(templateName);
    const content = substituteVariables(contentTemplate, variables);

    // Wrap in base template
    const html = await wrapInTemplate({
      title: subject,
      content,
      footerText
    });

    return await sendEmail({
      recipient,
      subject,
      html,
      template: templateName,
      cc,
      bcc,
      replyTo,
      from,
      fromName,
      correlationId
    });
  } catch (error) {
    logger.error('Failed to send templated email', {
      templateName,
      recipient,
      subject,
      error: error.message
    });
    throw error;
  }
}

/**
 * Send raw email without template
 * @param {Object} options - Email options
 * @param {string} options.recipient - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} [options.text] - Plain text fallback
 * @param {string[]} [options.cc] - CC recipients
 * @param {string[]} [options.bcc] - BCC recipients
 * @returns {Promise<Object>} - Send result
 */
async function sendRawEmail({ recipient, subject, html, text, cc = [], bcc = [], correlationId }) {
  return await sendEmail({
    recipient,
    subject,
    html,
    text,
    template: 'raw',
    cc,
    bcc,
    correlationId
  });
}

/**
 * Clear template cache (useful for development/testing)
 */
function clearTemplateCache() {
  templateCache.clear();
  logger.debug('Template cache cleared');
}

/**
 * Initialize email service
 */
async function initialize() {
  try {
    if (!hasGraphConfig()) {
      logger.warn('Email service initialized without Graph configuration - emails cannot be sent', {
        hasClientId: Boolean(GRAPH_CLIENT_ID),
        hasSecret: Boolean(GRAPH_CLIENT_SECRET),
        hasTenant: Boolean(GRAPH_TENANT_ID),
        hasSender: Boolean(GRAPH_SENDER_EMAIL)
      });
      return;
    }

    // Test token acquisition
    const token = await getGraphAccessToken();
    if (token) {
      logger.info('Email service initialized successfully with Microsoft Graph API', {
        sender: GRAPH_SENDER_EMAIL,
        fromName: EMAIL_FROM_NAME
      });
    } else {
      logger.warn('Email service initialized but failed to obtain access token');
    }

    // Seed templates from files into DB (idempotent)
    try {
      await templateModel.seedFromFiles(TEMPLATES_DIR);
    } catch (seedError) {
      logger.warn('Template seeding failed — file fallback will be used', { error: seedError.message });
    }
  } catch (error) {
    logger.error('Failed to initialize email service', { error: error.message });
    // Don't fail service startup, allow it to run in degraded mode
  }
}

/**
 * Check health of email service
 */
async function checkHealth() {
  if (!hasGraphConfig()) {
    return false;
  }

  try {
    const token = await getGraphAccessToken();
    return Boolean(token);
  } catch (error) {
    logger.error('Email health check failed', { error: error.message });
    return false;
  }
}

/**
 * Legacy compatibility - sendTemplate function
 * Maps to sendTemplatedEmail
 */
async function sendTemplate(templateName, { to, subject, templateData = {}, cc = [], bcc = [], replyTo, from, fromName, correlationId }) {
  return await sendTemplatedEmail({
    recipient: to,
    subject,
    templateName,
    variables: templateData,
    footerText: templateData.footerText,
    cc,
    bcc,
    replyTo,
    from,
    fromName,
    correlationId
  });
}

/**
 * Close/cleanup (no-op for Graph API)
 */
async function close() {
  // Clear cached token
  cachedGraphToken = null;
  graphTokenExpiresAt = 0;
  logger.info('Email service closed');
}

module.exports = {
  initialize,
  checkHealth,
  sendEmail,
  sendTemplatedEmail,
  sendRawEmail,
  loadTemplate,
  substituteVariables,
  wrapInTemplate,
  clearTemplateCache,
  sendTemplate, // Legacy compatibility
  close,
  hasGraphConfig,
  TEMPLATES_DIR
};
