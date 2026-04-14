/**
 * Ticket Model - Database operations for support tickets
 */

const shared = require('@notely/shared');
const db = shared.database;
const logger = shared.logger;

/**
 * Format ticket number as n12345678
 */
function formatTicketNumber(ticketNumber) {
  return `n${String(ticketNumber).padStart(8, '0')}`;
}

/**
 * Create a new support ticket
 */
async function createTicket({ userId, userEmail, subject, description, category = 'general', priority = 'normal', source = 'portal' }) {
  const query = `
    INSERT INTO support.tickets (user_id, user_email, subject, description, category, priority, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, ticket_number, user_id, user_email, subject, description, category, priority, status, source, assigned_to, created_at, updated_at
  `;

  const result = await db.query(query, [userId, userEmail, subject, description, category, priority, source]);
  const ticket = result.rows[0];

  return {
    ...ticket,
    ticketNumberFormatted: formatTicketNumber(ticket.ticket_number)
  };
}

/**
 * Get ticket by ID
 */
async function getTicketById(ticketId) {
  const query = `
    SELECT t.*,
           u.email as assigned_to_email,
           cu.first_name as user_first_name,
           cu.last_name as user_last_name,
           (SELECT COUNT(*) FROM support.messages m WHERE m.ticket_id = t.id AND NOT m.is_internal) as message_count
    FROM support.tickets t
    LEFT JOIN global_auth.user_credentials u ON t.assigned_to = u.id
    LEFT JOIN global_auth.user_credentials cu ON t.user_id = cu.id
    WHERE t.id = $1
  `;

  const result = await db.query(query, [ticketId]);
  if (result.rows.length === 0) {
    return null;
  }

  const ticket = result.rows[0];
  return {
    ...ticket,
    ticketNumberFormatted: formatTicketNumber(ticket.ticket_number)
  };
}

/**
 * Get tickets for a specific user
 */
async function getTicketsByUserId(userId, { limit = 50, offset = 0, status = null } = {}) {
  let query = `
    SELECT t.*,
           (SELECT COUNT(*) FROM support.messages m WHERE m.ticket_id = t.id AND NOT m.is_internal) as message_count
    FROM support.tickets t
    WHERE t.user_id = $1
  `;

  const params = [userId];

  if (status) {
    params.push(status);
    query += ` AND t.status = $${params.length}`;
  }

  query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await db.query(query, params);

  return result.rows.map(ticket => ({
    ...ticket,
    ticketNumberFormatted: formatTicketNumber(ticket.ticket_number)
  }));
}

/**
 * Get all tickets (admin view) with optional filters
 */
async function getAllTickets({ limit = 50, offset = 0, status = null, priority = null, assignedTo = null, search = null, createdSince = null } = {}) {
  let query = `
    SELECT t.*,
           u.email as assigned_to_email,
           (SELECT COUNT(*) FROM support.messages m WHERE m.ticket_id = t.id) as message_count
    FROM support.tickets t
    LEFT JOIN global_auth.user_credentials u ON t.assigned_to = u.id
    WHERE 1=1
  `;

  const params = [];

  if (status) {
    params.push(status);
    query += ` AND t.status = $${params.length}`;
  }

  if (priority) {
    params.push(priority);
    query += ` AND t.priority = $${params.length}`;
  }

  if (assignedTo) {
    params.push(assignedTo);
    query += ` AND t.assigned_to = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (t.subject ILIKE $${params.length} OR t.description ILIKE $${params.length} OR t.user_email ILIKE $${params.length})`;
  }

  if (createdSince) {
    params.push(createdSince);
    query += ` AND t.created_at >= $${params.length}`;
  }

  query += ` ORDER BY
    CASE t.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
    END,
    t.created_at DESC
  `;

  params.push(limit, offset);
  query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const result = await db.query(query, params);

  return result.rows.map(ticket => ({
    ...ticket,
    ticketNumberFormatted: formatTicketNumber(ticket.ticket_number)
  }));
}

/**
 * Update ticket (admin operations)
 */
async function updateTicket(ticketId, updates) {
  const allowedFields = ['status', 'priority', 'category', 'assigned_to'];
  const setClauses = [];
  const params = [ticketId];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      params.push(value);
      setClauses.push(`${key} = $${params.length}`);
    }
  }

  // Handle special status-related timestamps
  if (updates.status === 'resolved' && !updates.resolved_at) {
    setClauses.push('resolved_at = NOW()');
  }
  if (updates.status === 'closed' && !updates.closed_at) {
    setClauses.push('closed_at = NOW()');
  }

  if (setClauses.length === 0) {
    return getTicketById(ticketId);
  }

  const query = `
    UPDATE support.tickets
    SET ${setClauses.join(', ')}, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;

  const result = await db.query(query, params);
  if (result.rows.length === 0) {
    return null;
  }

  const ticket = result.rows[0];
  return {
    ...ticket,
    ticketNumberFormatted: formatTicketNumber(ticket.ticket_number)
  };
}

/**
 * Get ticket stats for admin dashboard
 */
async function getTicketStats() {
  const query = `
    SELECT
      COUNT(*) FILTER (WHERE status = 'open') as open_count,
      COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_count,
      COUNT(*) FILTER (WHERE status = 'waiting') as waiting_count,
      COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
      COUNT(*) FILTER (WHERE status = 'closed') as closed_count,
      COUNT(*) FILTER (WHERE priority = 'urgent') as urgent_count,
      COUNT(*) FILTER (WHERE priority = 'high') as high_priority_count,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as created_last_24h,
      COUNT(*) FILTER (WHERE resolved_at > NOW() - INTERVAL '24 hours') as resolved_last_24h
    FROM support.tickets
  `;

  const result = await db.query(query);
  return result.rows[0];
}

/**
 * Check if user owns the ticket
 */
async function userOwnsTicket(ticketId, userId) {
  const query = 'SELECT 1 FROM support.tickets WHERE id = $1 AND user_id = $2';
  const result = await db.query(query, [ticketId, userId]);
  return result.rows.length > 0;
}

module.exports = {
  formatTicketNumber,
  createTicket,
  getTicketById,
  getTicketsByUserId,
  getAllTickets,
  updateTicket,
  getTicketStats,
  userOwnsTicket
};
