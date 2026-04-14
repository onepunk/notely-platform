/**
 * Contact Model - Database operations for contact form submissions
 */

const shared = require('@notely/shared');
const db = shared.database;
const logger = shared.logger.child({ module: 'support-contact-model' });

/**
 * Create a new contact submission
 */
async function createSubmission({ firstName, lastName, email, product, message, ipAddress, userAgent, referrer }) {
  const query = `
    INSERT INTO support.contact_submissions (first_name, last_name, email, product, message, ip_address, user_agent, referrer)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, first_name, last_name, email, product, ip_address, created_at, status
  `;

  const result = await db.query(query, [
    firstName.trim(),
    lastName.trim(),
    email.trim().toLowerCase(),
    product,
    message.trim(),
    ipAddress || null,
    userAgent || null,
    referrer || null
  ]);

  return result.rows[0];
}

/**
 * Get submission by ID
 */
async function getById(id) {
  const query = `
    SELECT id, first_name, last_name, email, product, message, ip_address, user_agent,
           referrer, created_at, support_notified_at, confirmation_sent_at, status
    FROM support.contact_submissions
    WHERE id = $1
  `;

  const result = await db.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * Mark support notification as sent
 */
async function markSupportNotified(id) {
  const query = `
    UPDATE support.contact_submissions
    SET support_notified_at = NOW()
    WHERE id = $1
    RETURNING id, support_notified_at
  `;

  const result = await db.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * Mark confirmation email as sent
 */
async function markConfirmationSent(id) {
  const query = `
    UPDATE support.contact_submissions
    SET confirmation_sent_at = NOW()
    WHERE id = $1
    RETURNING id, confirmation_sent_at
  `;

  const result = await db.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * List submissions (for admin)
 */
async function listSubmissions({ limit = 50, offset = 0, status = null } = {}) {
  let query = `
    SELECT id, first_name, last_name, email, product, message, created_at, status,
           support_notified_at, confirmation_sent_at
    FROM support.contact_submissions
  `;

  const params = [];

  if (status) {
    params.push(status);
    query += ` WHERE status = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC`;

  params.push(limit);
  query += ` LIMIT $${params.length}`;

  params.push(offset);
  query += ` OFFSET $${params.length}`;

  const result = await db.query(query, params);
  return result.rows;
}

module.exports = {
  createSubmission,
  getById,
  markSupportNotified,
  markConfirmationSent,
  listSubmissions
};
