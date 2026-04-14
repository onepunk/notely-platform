/**
 * Admin ticket management routes
 * Handles ticket queue, assignment, and internal notes for admins
 */

const express = require('express');
const router = express.Router();
const ticketService = require('../services/ticketService');
const shared = require('@notely/shared');
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
 * Check if user has admin or support role
 * Both admins and support staff can manage support tickets
 */
function requireAdminOrSupport(req, res, next) {
  const { userId, role } = getUserFromHeaders(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }
  if (!['admin', 'super_admin', 'support'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin or support access required' });
  }
  next();
}

/**
 * Validate and sanitize pagination parameters to prevent DoS
 * @param {string|number} limit - Requested limit
 * @param {string|number} offset - Requested offset
 * @param {number} maxLimit - Maximum allowed limit (default 100)
 * @returns {object} Sanitized { limit, offset }
 */
function sanitizePagination(limit, offset, maxLimit = 100) {
  let sanitizedLimit = parseInt(limit, 10);
  let sanitizedOffset = parseInt(offset, 10);

  // Handle NaN or invalid values
  if (isNaN(sanitizedLimit) || sanitizedLimit < 1) {
    sanitizedLimit = 50; // default
  }
  if (isNaN(sanitizedOffset) || sanitizedOffset < 0) {
    sanitizedOffset = 0; // default
  }

  // Cap limit to prevent DoS
  sanitizedLimit = Math.min(sanitizedLimit, maxLimit);

  return { limit: sanitizedLimit, offset: sanitizedOffset };
}

/**
 * GET /api/support/admin/tickets
 * Get all tickets with filters (admin queue view)
 */
router.get('/tickets', requireAdminOrSupport, async (req, res, next) => {
  try {
    const { status, priority, assigned_to, search, created_since, limit: rawLimit = 50, offset: rawOffset = 0 } = req.query;
    const { limit, offset } = sanitizePagination(rawLimit, rawOffset, 100);

    const tickets = await ticketService.getAllTickets({
      status,
      priority,
      assignedTo: assigned_to,
      search,
      createdSince: created_since,
      limit,
      offset
    });

    res.json({
      success: true,
      tickets: tickets.map(t => ({
        id: t.id,
        ticketNumber: t.ticketNumberFormatted,
        userEmail: t.user_email,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        category: t.category,
        source: t.source,
        assignedTo: t.assigned_to,
        assignedToEmail: t.assigned_to_email,
        messageCount: parseInt(t.message_count, 10),
        createdAt: t.created_at,
        updatedAt: t.updated_at
      })),
      pagination: {
        limit,
        offset
      }
    });
  } catch (error) {
    logger.error('Failed to get admin tickets', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/support/admin/tickets/stats
 * Get ticket statistics for dashboard
 */
router.get('/tickets/stats', requireAdminOrSupport, async (req, res, next) => {
  try {
    const stats = await ticketService.getStats();

    res.json({
      success: true,
      stats: {
        byStatus: {
          open: parseInt(stats.open_count, 10),
          inProgress: parseInt(stats.in_progress_count, 10),
          waiting: parseInt(stats.waiting_count, 10),
          resolved: parseInt(stats.resolved_count, 10),
          closed: parseInt(stats.closed_count, 10)
        },
        priority: {
          urgent: parseInt(stats.urgent_count, 10),
          high: parseInt(stats.high_priority_count, 10)
        },
        activity: {
          createdLast24h: parseInt(stats.created_last_24h, 10),
          resolvedLast24h: parseInt(stats.resolved_last_24h, 10)
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get ticket stats', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/support/admin/tickets/:id
 * Get a specific ticket with all messages including internal notes
 */
router.get('/tickets/:id', requireAdminOrSupport, async (req, res, next) => {
  try {
    const { userId } = getUserFromHeaders(req);
    const { id } = req.params;

    const ticket = await ticketService.getTicket(id, userId, true); // isAdmin = true

    if (!ticket) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Ticket not found'
      });
    }

    res.json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumberFormatted,
        userId: ticket.user_id,
        userEmail: ticket.user_email,
        userFirstName: ticket.user_first_name,
        userLastName: ticket.user_last_name,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        source: ticket.source,
        assignedTo: ticket.assigned_to,
        assignedToEmail: ticket.assigned_to_email,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        resolvedAt: ticket.resolved_at,
        closedAt: ticket.closed_at,
        messages: ticket.messages.map(m => ({
          id: m.id,
          userId: m.user_id,
          senderEmail: m.sender_display_email,
          senderName: m.sender_name,
          message: m.message,
          isInternal: m.is_internal,
          source: m.source,
          createdAt: m.created_at
        }))
      }
    });
  } catch (error) {
    logger.error('Failed to get admin ticket', { error: error.message, ticketId: req.params.id });
    next(error);
  }
});

/**
 * PATCH /api/support/admin/tickets/:id
 * Update ticket status, priority, or assignment
 */
router.patch('/tickets/:id', requireAdminOrSupport, async (req, res, next) => {
  try {
    const { userId } = getUserFromHeaders(req);
    const { id } = req.params;
    const { status, priority, category, assigned_to } = req.body;

    // Validate status if provided
    const validStatuses = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Validate priority if provided
    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid priority. Must be one of: ${validPriorities.join(', ')}`
      });
    }

    const updates = {};
    if (status) updates.status = status;
    if (priority) updates.priority = priority;
    if (category) updates.category = category;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'No valid updates provided'
      });
    }

    const ticket = await ticketService.updateTicket(id, updates, userId);

    res.json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumberFormatted,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        assignedTo: ticket.assigned_to,
        updatedAt: ticket.updated_at
      }
    });
  } catch (error) {
    if (error.message === 'Ticket not found') {
      return res.status(404).json({ error: 'Not Found', message: error.message });
    }
    logger.error('Failed to update ticket', { error: error.message, ticketId: req.params.id });
    next(error);
  }
});

/**
 * POST /api/support/admin/tickets/:id/notes
 * Add an internal note to a ticket (admin only, not visible to users)
 */
router.post('/tickets/:id/notes', requireAdminOrSupport, async (req, res, next) => {
  try {
    const { userId, email } = getUserFromHeaders(req);
    const { id } = req.params;
    const { note } = req.body;

    if (!note || note.trim().length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Note is required'
      });
    }

    const message = await ticketService.addInternalNote({
      ticketId: id,
      adminId: userId,
      adminEmail: email,
      adminName: null,
      note: note.trim()
    });

    res.status(201).json({
      success: true,
      note: {
        id: message.id,
        message: message.message,
        isInternal: message.is_internal,
        createdAt: message.created_at
      }
    });
  } catch (error) {
    if (error.message === 'Ticket not found') {
      return res.status(404).json({ error: 'Not Found', message: error.message });
    }
    logger.error('Failed to add internal note', { error: error.message, ticketId: req.params.id });
    next(error);
  }
});

module.exports = router;
