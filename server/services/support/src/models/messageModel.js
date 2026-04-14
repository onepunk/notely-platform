/**
 * Message Model - Database operations for ticket messages
 */

const shared = require('@notely/shared');
const db = shared.database;
const logger = shared.logger;

/**
 * Add a message to a ticket
 */
async function createMessage({ ticketId, userId, senderEmail, senderName, message, isInternal = false, source = 'portal', emailMessageId = null }) {
  const query = `
    INSERT INTO support.messages (ticket_id, user_id, sender_email, sender_name, message, is_internal, source, email_message_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  const result = await db.query(query, [
    ticketId,
    userId,
    senderEmail,
    senderName,
    message,
    isInternal,
    source,
    emailMessageId
  ]);

  // Update the ticket's updated_at timestamp
  await db.query('UPDATE support.tickets SET updated_at = NOW() WHERE id = $1', [ticketId]);

  return result.rows[0];
}

/**
 * Get messages for a ticket (optionally excluding internal notes for non-admins)
 */
async function getMessagesByTicketId(ticketId, { includeInternal = false } = {}) {
  let query = `
    SELECT m.*,
           COALESCE(u.email, m.sender_email) as sender_display_email
    FROM support.messages m
    LEFT JOIN global_auth.user_credentials u ON m.user_id = u.id
    WHERE m.ticket_id = $1
  `;

  if (!includeInternal) {
    query += ' AND m.is_internal = false';
  }

  query += ' ORDER BY m.created_at ASC';

  const result = await db.query(query, [ticketId]);
  return result.rows;
}

/**
 * Get a single message by ID
 */
async function getMessageById(messageId) {
  const query = `
    SELECT m.*,
           COALESCE(u.email, m.sender_email) as sender_display_email
    FROM support.messages m
    LEFT JOIN global_auth.user_credentials u ON m.user_id = u.id
    WHERE m.id = $1
  `;

  const result = await db.query(query, [messageId]);
  return result.rows[0] || null;
}

/**
 * Check if an email has already been processed (for deduplication)
 */
async function isEmailProcessed(emailMessageId) {
  const query = 'SELECT 1 FROM support.email_processing_log WHERE email_message_id = $1';
  const result = await db.query(query, [emailMessageId]);
  return result.rows.length > 0;
}

/**
 * Log a processed email
 */
async function logProcessedEmail(emailMessageId, ticketId) {
  const query = `
    INSERT INTO support.email_processing_log (email_message_id, ticket_id)
    VALUES ($1, $2)
    ON CONFLICT (email_message_id) DO NOTHING
    RETURNING *
  `;

  const result = await db.query(query, [emailMessageId, ticketId]);
  return result.rows[0];
}

/**
 * Get message count for a ticket
 */
async function getMessageCount(ticketId, { includeInternal = false } = {}) {
  let query = 'SELECT COUNT(*) as count FROM support.messages WHERE ticket_id = $1';

  if (!includeInternal) {
    query += ' AND is_internal = false';
  }

  const result = await db.query(query, [ticketId]);
  return parseInt(result.rows[0].count, 10);
}

module.exports = {
  createMessage,
  getMessagesByTicketId,
  getMessageById,
  isEmailProcessed,
  logProcessedEmail,
  getMessageCount
};
