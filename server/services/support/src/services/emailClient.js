/**
 * Email Client - Publishes email requests to RabbitMQ for the email microservice to process
 * Uses shared messaging module for connection management, heartbeat, and error recovery
 * Supports CC and BCC recipients for admin visibility
 */

const { v4: uuidv4 } = require('uuid');
const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'support-email-client' });

let messagingContext = null;

const EXCHANGE_NAME = 'email.requests';
const ROUTING_KEY = 'email.send';

// Admin email for BCC on outgoing emails (configurable via environment)
const ADMIN_BCC_EMAIL = process.env.EMAIL_ADMIN_BCC || process.env.BETA_ADMIN_EMAIL || 'admin@example.com';
const ENABLE_ADMIN_BCC = process.env.EMAIL_ADMIN_BCC_ENABLED !== 'false'; // Enabled by default

/**
 * Initialize RabbitMQ connection using shared messaging module
 * Provides connection caching, heartbeat (30s), and automatic cache invalidation on disconnect
 */
async function initialize() {
  if (messagingContext) {
    return messagingContext;
  }

  try {
    messagingContext = await shared.messaging.createContext({
      serviceName: process.env.SERVICE_NAME || 'support',
      exchange: EXCHANGE_NAME
    });

    logger.info('Email client initialized', { exchange: EXCHANGE_NAME });
  } catch (error) {
    logger.error('Failed to initialize email client messaging', { error: error.message });
    throw error;
  }

  return messagingContext;
}

/**
 * Queue an email to be sent by the email microservice
 * @param {Object} options - Email options
 * @param {string} options.type - Email type: 'templated' or 'raw'
 * @param {string} options.recipient - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} [options.templateName] - Template name (for templated emails)
 * @param {Object} [options.variables] - Template variables (for templated emails)
 * @param {string} [options.html] - HTML content (for raw emails)
 * @param {string} [options.text] - Plain text content (for raw emails)
 * @param {string} [options.footerText] - Custom footer text
 * @param {string[]} [options.cc] - CC recipients
 * @param {string[]} [options.bcc] - BCC recipients
 * @param {boolean} [options.adminBcc=false] - Include admin BCC for visibility
 * @param {string} [options.replyTo] - Reply-to email address
 * @param {string} [options.from] - Override sender email address
 * @param {string} [options.fromName] - Override sender display name
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueEmail({ type, recipient, subject, templateName, variables, html, text, footerText, cc, bcc, adminBcc = false, replyTo, from, fromName }) {
  if (!messagingContext) {
    logger.warn('Email not queued - messaging context not initialized', { recipient, subject });
    return null;
  }

  try {
    const correlationId = uuidv4();

    // Build message payload based on type
    const payload = {
      correlationId,
      timestamp: new Date().toISOString(),
      recipient,
      subject
    };

    if (type === 'templated') {
      payload.template = templateName;
      payload.templateData = {
        ...variables,
        footerText: footerText || "You're receiving this email from Notely."
      };
    } else if (type === 'raw') {
      payload.html = html;
      if (text) payload.text = text;
    }

    // For backward compatibility with email service, also set 'to' field
    payload.to = recipient;

    // Add CC recipients if provided
    if (cc && Array.isArray(cc) && cc.length > 0) {
      payload.cc = cc;
    }

    // Build BCC list
    const bccList = [];
    if (bcc && Array.isArray(bcc)) {
      bccList.push(...bcc);
    }
    // Add admin BCC if enabled and requested
    if (adminBcc && ENABLE_ADMIN_BCC && ADMIN_BCC_EMAIL) {
      // Don't duplicate if admin is already the recipient or in BCC
      if (ADMIN_BCC_EMAIL !== recipient && !bccList.includes(ADMIN_BCC_EMAIL)) {
        bccList.push(ADMIN_BCC_EMAIL);
      }
    }
    if (bccList.length > 0) {
      payload.bcc = bccList;
    }

    if (replyTo) {
      payload.replyTo = replyTo;
    }

    if (from) {
      payload.from = from;
    }

    if (fromName) {
      payload.fromName = fromName;
    }

    await messagingContext.publish(ROUTING_KEY, payload);

    logger.info('Email queued for sending', {
      correlationId,
      recipient,
      subject,
      type,
      templateName: templateName || 'N/A',
      hasCc: Boolean(payload.cc),
      hasBcc: Boolean(payload.bcc)
    });

    return correlationId;
  } catch (error) {
    logger.error('Failed to queue email', {
      recipient,
      subject,
      error: error.message
    });
    return null;
  }
}

/**
 * Queue a templated email
 * @param {Object} options - Email options
 * @param {string} options.recipient - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.templateName - Template name (without .html extension)
 * @param {Object} [options.variables] - Template variables for substitution
 * @param {string} [options.footerText] - Custom footer text
 * @param {string[]} [options.cc] - CC recipients
 * @param {string[]} [options.bcc] - BCC recipients
 * @param {boolean} [options.adminBcc=false] - Include admin BCC for visibility
 * @param {string} [options.replyTo] - Reply-to email address
 * @param {string} [options.from] - Override sender email address
 * @param {string} [options.fromName] - Override sender display name
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueTemplatedEmail({ recipient, subject, templateName, variables = {}, footerText, cc, bcc, adminBcc = false, replyTo, from, fromName }) {
  return queueEmail({
    type: 'templated',
    recipient,
    subject,
    templateName,
    variables,
    footerText,
    cc,
    bcc,
    adminBcc,
    replyTo,
    from,
    fromName
  });
}

/**
 * Queue a raw HTML email
 * @param {Object} options - Email options
 * @param {string} options.recipient - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} [options.text] - Plain text fallback
 * @param {string} [options.footerText] - Custom footer text
 * @param {string[]} [options.cc] - CC recipients
 * @param {string[]} [options.bcc] - BCC recipients
 * @param {boolean} [options.adminBcc=false] - Include admin BCC for visibility
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueRawEmail({ recipient, subject, html, text, footerText, cc, bcc, adminBcc = false }) {
  return queueEmail({
    type: 'raw',
    recipient,
    subject,
    html,
    text,
    footerText,
    cc,
    bcc,
    adminBcc
  });
}

/**
 * Queue beta confirmation email to user
 * @param {Object} options - User details
 * @param {string} options.firstName - User's first name
 * @param {string} options.lastName - User's last name
 * @param {string} options.email - User's email address
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueBetaConfirmationEmail({ firstName, lastName, email }) {
  return queueTemplatedEmail({
    recipient: email,
    subject: 'Thank you for signing up for the Notely Beta!',
    templateName: 'beta-confirmation',
    variables: { firstName, lastName, registerUrl: `${process.env.PORTAL_URL}/register` },
    footerText: "You're receiving this because you signed up for the Notely beta.",
    adminBcc: true, // Admin gets BCC to know confirmation was sent
    replyTo: 'support@example.com',
    from: 'support@example.com',
    fromName: 'Notely Support'
  });
}

/**
 * Queue beta signup notification email to admin
 * @param {Object} options - Signup details
 * @param {string} options.firstName - User's first name
 * @param {string} options.lastName - User's last name
 * @param {string} options.email - User's email address
 * @param {string} [options.ipAddress] - User's IP address
 * @param {string} [options.userAgent] - User's user agent
 * @param {string|Date} options.createdAt - Signup timestamp
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueBetaAdminNotification({ firstName, lastName, email, ipAddress, userAgent, createdAt }) {
  const adminEmail = process.env.BETA_ADMIN_EMAIL || 'admin@example.com';

  return queueTemplatedEmail({
    recipient: adminEmail,
    subject: `New Beta Signup: ${firstName} ${lastName}`,
    templateName: 'admin-notification',
    variables: {
      firstName,
      lastName,
      email,
      timestamp: new Date(createdAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }),
      ipAddress: ipAddress || 'N/A',
      userAgent: userAgent ? userAgent.substring(0, 100) : null,
      isBeta: true
    },
    footerText: 'This is an automated notification from Notely.'
    // No adminBcc needed - this IS the admin notification
  });
}

/**
 * Queue beta access invitation email to user
 * @param {Object} options - Invitation details
 * @param {string} options.firstName - User's first name
 * @param {string} options.email - User's email address
 * @param {string} options.accessUrl - The full URL with token for beta access
 * @param {string} options.expiresIn - Human-readable expiry time (e.g., "24 hours")
 * @param {boolean} [options.adminBcc=false] - Include admin BCC for visibility
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueBetaInvitationEmail({ firstName, email, accessUrl, expiresIn, adminBcc = false }) {
  return queueTemplatedEmail({
    recipient: email,
    subject: "You're Invited to Notely Beta!",
    templateName: 'beta-cloud-invitation',
    variables: {
      firstName,
      email,
      accessUrl,
      expiresIn
    },
    footerText: "You're receiving this because you signed up for the Notely beta.",
    adminBcc,
    replyTo: 'support@example.com',
    from: 'support@example.com',
    fromName: 'Notely Support'
  });
}

/**
 * Queue beta welcome email to user after successful activation
 * @param {Object} options - User details
 * @param {string} options.firstName - User's first name
 * @param {string} options.email - User's email address
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueBetaWelcomeEmail({ firstName, email }) {
  return queueTemplatedEmail({
    recipient: email,
    subject: 'Welcome to the Notely Beta!',
    templateName: 'beta-cloud-welcome',
    variables: { firstName, email },
    footerText: "You're receiving this because you activated your Notely beta access.",
    adminBcc: true, // Admin gets BCC to know user completed activation
    replyTo: 'support@example.com',
    from: 'support@example.com',
    fromName: 'Notely Support'
  });
}

/**
 * Queue Notely AI beta license email to user
 * @param {Object} options - License details
 * @param {string} options.firstName - User's first name
 * @param {string} options.email - User's email address
 * @param {string} options.licenseKey - The generated license key
 * @param {string} options.expiresAt - Human-readable expiration date
 * @param {string} [options.accessUrl] - Portal access URL with beta token (falls back to plain login)
 * @param {boolean} [options.adminBcc=false] - Include admin BCC for visibility
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueNotelyAiLicenseEmail({ firstName, email, licenseKey, expiresAt, accessUrl, adminBcc = false }) {
  return queueTemplatedEmail({
    recipient: email,
    subject: 'Your Notely AI Beta License Key',
    templateName: 'beta-ai-license',
    variables: {
      firstName,
      email,
      licenseKey,
      expiresAt,
      accessUrl: accessUrl || `${process.env.PORTAL_URL}/login`
    },
    footerText: "You're receiving this because you signed up for the Notely AI beta.",
    adminBcc
  });
}

/**
 * Queue beta email verification code for AI beta signup
 * @param {Object} options - User details
 * @param {string} options.firstName - User's first name
 * @param {string} options.email - User's email address
 * @param {string} options.code - The 8-char verification code
 * @param {string} [options.verifyUrl] - Magic link verification URL
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueBetaVerificationEmail({ firstName, email, code, verifyUrl }) {
  return queueTemplatedEmail({
    recipient: email,
    subject: 'Verify Your Email — Notely AI Beta',
    templateName: 'beta-ai-email-verification',
    variables: { firstName, code, verifyUrl: verifyUrl || '' },
    footerText: "You're receiving this because you signed up for the Notely AI beta.",
    adminBcc: true,
    replyTo: 'support@example.com',
    from: 'support@example.com',
    fromName: 'Notely Support'
  });
}

/**
 * Queue beta email verification code for Cloud beta signup
 * @param {Object} options - User details
 * @param {string} options.firstName - User's first name
 * @param {string} options.email - User's email address
 * @param {string} options.code - The 8-char verification code
 * @param {string} [options.verifyUrl] - Magic link verification URL
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueCloudBetaVerificationEmail({ firstName, email, code, verifyUrl }) {
  return queueTemplatedEmail({
    recipient: email,
    subject: 'Verify Your Email — Notely Cloud Beta',
    templateName: 'beta-cloud-email-verification',
    variables: { firstName, code, verifyUrl: verifyUrl || '' },
    footerText: "You're receiving this because you signed up for the Notely Cloud beta.",
    adminBcc: true,
    replyTo: 'support@example.com',
    from: 'support@example.com',
    fromName: 'Notely Support'
  });
}

/**
 * Queue contact form support notification email to support team
 * @param {Object} options - Submission details
 * @param {string} options.firstName - User's first name
 * @param {string} options.lastName - User's last name
 * @param {string} options.email - User's email address
 * @param {string} options.product - Selected product
 * @param {string} options.message - User's message
 * @param {string} [options.ipAddress] - User's IP address
 * @param {string|Date} options.createdAt - Submission timestamp
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueContactSupportNotification({ firstName, lastName, email, product, message, ipAddress, createdAt }) {
  return queueTemplatedEmail({
    recipient: 'support@example.com',
    subject: `Contact Form: ${firstName} ${lastName} — ${product}`,
    templateName: 'contact-support-notification',
    variables: {
      firstName,
      lastName,
      email,
      product,
      message,
      timestamp: new Date(createdAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }),
      ipAddress: ipAddress || 'N/A'
    },
    footerText: 'This is an automated notification from the Notely contact form.'
  });
}

/**
 * Queue contact form confirmation email to user
 * @param {Object} options - User details
 * @param {string} options.firstName - User's first name
 * @param {string} options.email - User's email address
 * @returns {Promise<string|null>} - Correlation ID for tracking, or null if failed
 */
async function queueContactConfirmationEmail({ firstName, email }) {
  return queueTemplatedEmail({
    recipient: email,
    subject: "We've received your message — Notely",
    templateName: 'contact-confirmation',
    variables: { firstName },
    footerText: "You're receiving this because you submitted a contact form on yourdomain.com.",
    adminBcc: true
  });
}

/**
 * Check if email client is ready (has messaging connection)
 * @returns {boolean} - True if client is ready to queue emails
 */
function isReady() {
  return Boolean(messagingContext);
}

/**
 * Close messaging connection
 */
async function close() {
  if (!messagingContext) {
    return;
  }

  try {
    await messagingContext.close();
    messagingContext = null;
    logger.info('Email client closed');
  } catch (error) {
    logger.error('Error closing email client', { error: error.message });
  }
}

module.exports = {
  initialize,
  queueEmail,
  queueTemplatedEmail,
  queueRawEmail,
  queueBetaConfirmationEmail,
  queueBetaAdminNotification,
  queueBetaInvitationEmail,
  queueBetaWelcomeEmail,
  queueNotelyAiLicenseEmail,
  queueBetaVerificationEmail,
  queueCloudBetaVerificationEmail,
  queueContactSupportNotification,
  queueContactConfirmationEmail,
  isReady,
  close
};
