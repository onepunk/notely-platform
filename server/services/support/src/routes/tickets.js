/**
 * User-facing ticket routes
 * Handles ticket creation and viewing for regular users
 */

const express = require('express');
const router = express.Router();
const ticketService = require('../services/ticketService');
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
 * POST /api/support/tickets
 * Create a new support ticket
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { userId, email } = getUserFromHeaders(req);
    const { subject, description, category, priority } = req.body;

    // Validate required fields
    if (!subject || !description) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Subject and description are required'
      });
    }

    if (subject.length > 255) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Subject must be 255 characters or less'
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

    const ticket = await ticketService.createTicket({
      userId,
      userEmail: email,
      subject,
      description,
      category,
      priority
    });

    res.status(201).json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumberFormatted,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        createdAt: ticket.created_at
      }
    });
  } catch (error) {
    logger.error('Failed to create ticket', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/support/tickets
 * Get current user's tickets
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = getUserFromHeaders(req);
    const { status, limit: rawLimit = 50, offset: rawOffset = 0 } = req.query;
    const { limit, offset } = sanitizePagination(rawLimit, rawOffset, 100);

    const tickets = await ticketService.getUserTickets(userId, {
      status,
      limit,
      offset
    });

    res.json({
      success: true,
      tickets: tickets.map(t => ({
        id: t.id,
        ticketNumber: t.ticketNumberFormatted,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        category: t.category,
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
    logger.error('Failed to get user tickets', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/support/tickets/:id
 * Get a specific ticket with messages
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId, role } = getUserFromHeaders(req);
    const { id } = req.params;

    const isAdminUser = isAdmin(role);
    const ticket = await ticketService.getTicket(id, userId, isAdminUser);

    if (!ticket) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Ticket not found or you do not have permission to view it'
      });
    }

    res.json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumberFormatted,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        source: ticket.source,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        resolvedAt: ticket.resolved_at,
        closedAt: ticket.closed_at,
        messages: ticket.messages.map(m => ({
          id: m.id,
          senderEmail: m.sender_display_email,
          senderName: m.sender_name,
          message: m.message,
          isInternal: m.is_internal,
          createdAt: m.created_at
        }))
      }
    });
  } catch (error) {
    logger.error('Failed to get ticket', { error: error.message, ticketId: req.params.id });
    next(error);
  }
});

/**
 * POST /api/support/tickets/:id/messages
 * Add a reply to a ticket
 */
router.post('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const { userId, email, role } = getUserFromHeaders(req);
    const { id } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Message is required'
      });
    }

    const isAdminUser = isAdmin(role);

    const newMessage = await ticketService.addReply({
      ticketId: id,
      userId,
      userEmail: email,
      userName: null,
      message: message.trim(),
      isAdmin: isAdminUser
    });

    res.status(201).json({
      success: true,
      message: {
        id: newMessage.id,
        senderEmail: newMessage.sender_email,
        message: newMessage.message,
        createdAt: newMessage.created_at
      }
    });
  } catch (error) {
    if (error.message === 'Ticket not found') {
      return res.status(404).json({ error: 'Not Found', message: error.message });
    }
    if (error.message === 'Not authorized to reply to this ticket') {
      return res.status(403).json({ error: 'Forbidden', message: error.message });
    }
    logger.error('Failed to add reply', { error: error.message, ticketId: req.params.id });
    next(error);
  }
});

module.exports = router;
