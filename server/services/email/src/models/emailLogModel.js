const shared = require('@notely/shared');
const db = shared.database;

/**
 * Insert a pending email log row.
 * @returns {string} the generated log id (UUID)
 */
async function createLog({ correlationId, recipient, subject, templateName, metadata = {} }) {
  const result = await db.query(
    `INSERT INTO email.email_logs (correlation_id, recipient, subject, template_name, status, metadata)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id`,
    [correlationId || null, recipient, subject, templateName || null, JSON.stringify(metadata)]
  );
  return result.rows[0].id;
}

/**
 * Mark an email log as successfully sent.
 */
async function markSent(id) {
  await db.query(
    `UPDATE email.email_logs SET status = 'sent', sent_at = NOW() WHERE id = $1`,
    [id]
  );
}

/**
 * Mark an email log as failed with an error message.
 */
async function markFailed(id, errorMessage) {
  await db.query(
    `UPDATE email.email_logs SET status = 'failed', error_message = $1 WHERE id = $2`,
    [errorMessage, id]
  );
}

module.exports = {
  createLog,
  markSent,
  markFailed
};
