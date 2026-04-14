const fs = require('fs');
const path = require('path');
const shared = require('@notely/shared');
const db = shared.database;
const logger = shared.logger.child({ module: 'template-model' });

const TEMPLATES_DIR = path.join(__dirname, '../templates');

/**
 * Default metadata for each template — subject, flow, order, description.
 * Used during seeding so the DB has useful defaults from day one.
 */
const TEMPLATE_DEFAULTS = {
  'base': {
    subject: null,
    flow: null,
    flowOrder: 0,
    description: 'Base HTML wrapper applied to all outgoing emails'
  },
  'email-verification': {
    subject: 'Verify Your Email - Notely',
    flow: 'Registration',
    flowOrder: 1,
    description: 'Sent when a new user registers — contains a verification code'
  },
  'beta-confirmation': {
    subject: 'Thank you for signing up for the Notely Beta!',
    flow: 'Beta Signup',
    flowOrder: 1,
    description: 'Confirmation sent to user after signing up for beta'
  },
  'beta-invitation': {
    subject: "You're Invited to Notely Beta!",
    flow: 'Beta Signup',
    flowOrder: 2,
    description: 'Sent by admin to invite a beta user with an access link'
  },
  'beta-welcome': {
    subject: 'Welcome to the Notely Beta!',
    flow: 'Beta Signup',
    flowOrder: 3,
    description: 'Sent after a beta user redeems their invitation'
  },
  'beta-email-verification': {
    subject: 'Verify Your Email — Notely AI Beta',
    flow: 'AI Beta Signup',
    flowOrder: 1,
    description: 'Verification code sent when user signs up for Notely AI beta'
  },
  'beta-ai-license': {
    subject: 'Your Notely AI Beta License Key',
    flow: 'Beta Signup',
    flowOrder: 4,
    description: 'Delivers an AI beta license key to the user'
  },
  'contact-confirmation': {
    subject: "We've received your message — Notely",
    flow: 'Contact Form',
    flowOrder: 1,
    description: 'Auto-reply confirming receipt of a contact form submission'
  },
  'contact-support-notification': {
    subject: 'Contact Form: {{firstName}} {{lastName}} — {{product}}',
    flow: 'Contact Form',
    flowOrder: 2,
    description: 'Internal notification sent to support with submission details'
  },
  'admin-notification': {
    subject: 'New Beta Signup: {{firstName}} {{lastName}}',
    flow: 'Admin Alerts',
    flowOrder: 1,
    description: 'Notification sent to admin when a new beta signup or registration occurs'
  }
};

/**
 * Get all email templates
 */
async function getAllTemplates() {
  const result = await db.query(
    `SELECT id, name, subject, description, variables, is_base, flow, flow_order, updated_at, updated_by
     FROM email.email_templates
     ORDER BY is_base DESC, flow NULLS LAST, flow_order ASC, name ASC`
  );
  return result.rows;
}

/**
 * Get a single template by name
 */
async function getTemplateByName(name) {
  const result = await db.query(
    `SELECT id, name, subject, html_content, description, variables, is_base, flow, flow_order, updated_at, updated_by
     FROM email.email_templates
     WHERE name = $1`,
    [name]
  );
  return result.rows[0] || null;
}

/**
 * Update an existing template
 */
async function updateTemplate(name, { htmlContent, subject, description, variables, updatedBy }) {
  const result = await db.query(
    `UPDATE email.email_templates
     SET html_content = COALESCE($1, html_content),
         subject = COALESCE($2, subject),
         description = COALESCE($3, description),
         variables = COALESCE($4, variables),
         updated_by = $5,
         updated_at = NOW()
     WHERE name = $6
     RETURNING id, name, subject, description, variables, is_base, flow, flow_order, updated_at, updated_by`,
    [htmlContent, subject, description, variables ? JSON.stringify(variables) : null, updatedBy, name]
  );
  return result.rows[0] || null;
}

/**
 * Seed templates from file system into DB (idempotent — won't overwrite existing)
 */
async function seedFromFiles(templatesDir = TEMPLATES_DIR) {
  const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.html'));
  let seeded = 0;

  for (const file of files) {
    const name = file.replace('.html', '');
    const filePath = path.join(templatesDir, file);
    const htmlContent = fs.readFileSync(filePath, 'utf8');
    const isBase = name === 'base';
    const defaults = TEMPLATE_DEFAULTS[name] || {};

    // Extract variable names from template content ({{varName}} patterns)
    const varMatches = htmlContent.match(/\{\{(\w+)\}\}/g) || [];
    const variables = [...new Set(varMatches.map(m => m.replace(/\{\{|\}\}/g, '')))];

    const result = await db.query(
      `INSERT INTO email.email_templates (name, html_content, variables, is_base, subject, flow, flow_order, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (name) DO NOTHING
       RETURNING name`,
      [
        name,
        htmlContent,
        JSON.stringify(variables),
        isBase,
        defaults.subject || null,
        defaults.flow || null,
        defaults.flowOrder || 0,
        defaults.description || `${name} email template`
      ]
    );

    if (result.rows.length > 0) {
      seeded++;
      logger.info('Seeded email template from file', { name });
    }
  }

  logger.info('Email template seeding complete', { total: files.length, seeded });
}

/**
 * Reset a template to the file-system default
 */
async function resetToDefault(name, templatesDir = TEMPLATES_DIR) {
  const filePath = path.join(templatesDir, `${name}.html`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Default template file not found: ${name}`);
  }

  const htmlContent = fs.readFileSync(filePath, 'utf8');
  const varMatches = htmlContent.match(/\{\{(\w+)\}\}/g) || [];
  const variables = [...new Set(varMatches.map(m => m.replace(/\{\{|\}\}/g, '')))];
  const defaults = TEMPLATE_DEFAULTS[name] || {};

  const result = await db.query(
    `UPDATE email.email_templates
     SET html_content = $1, variables = $2, subject = COALESCE($3, subject),
         updated_at = NOW(), updated_by = NULL
     WHERE name = $4
     RETURNING id, name, subject, description, variables, is_base, flow, flow_order, updated_at`,
    [htmlContent, JSON.stringify(variables), defaults.subject || null, name]
  );

  return result.rows[0] || null;
}

/**
 * Get the file-system default content for comparison
 */
function getDefaultContent(name, templatesDir = TEMPLATES_DIR) {
  const filePath = path.join(templatesDir, `${name}.html`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf8');
}

module.exports = {
  getAllTemplates,
  getTemplateByName,
  updateTemplate,
  seedFromFiles,
  resetToDefault,
  getDefaultContent
};
