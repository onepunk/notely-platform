/**
 * Message routes
 * Handles message-specific operations (attachments will be added later)
 */

const express = require('express');
const router = express.Router();
const messageModel = require('../models/messageModel');
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
 * GET /api/support/messages/:id
 * Get a specific message
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { userId, role } = getUserFromHeaders(req);
    const { id } = req.params;

    const message = await messageModel.getMessageById(id);

    if (!message) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Message not found'
      });
    }

    // Internal messages are only visible to admins
    if (message.is_internal && !isAdmin(role)) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: {
        id: message.id,
        ticketId: message.ticket_id,
        senderEmail: message.sender_display_email,
        senderName: message.sender_name,
        message: message.message,
        isInternal: message.is_internal,
        source: message.source,
        createdAt: message.created_at
      }
    });
  } catch (error) {
    logger.error('Failed to get message', { error: error.message, messageId: req.params.id });
    next(error);
  }
});

module.exports = router;
