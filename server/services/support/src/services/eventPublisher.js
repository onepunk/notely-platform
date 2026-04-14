/**
 * Event Publisher - Publishes support ticket events to RabbitMQ
 * Uses shared messaging module for connection management, heartbeat, and error recovery
 */

const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'support-event-publisher' });

let messagingContext = null;

const EXCHANGE_NAME = 'support.events';

/**
 * Initialize messaging context using shared module
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
    logger.info('Support event publisher initialized', { exchange: EXCHANGE_NAME });
  } catch (error) {
    logger.error('Failed to initialize support messaging', { error: error.message });
    throw error;
  }

  return messagingContext;
}

/**
 * Check if messaging is ready
 */
function isReady() {
  return Boolean(messagingContext);
}

async function publishEvent(routingKey, payload) {
  if (!messagingContext) {
    logger.warn('Event not published - messaging context not initialized', { routingKey });
    return false;
  }

  try {
    await messagingContext.publish(routingKey, {
      ...payload,
      timestamp: new Date().toISOString()
    });

    logger.info('Support event published', { routingKey, ticketId: payload.ticketId });
    return true;
  } catch (error) {
    logger.error('Failed to publish support event', { routingKey, error: error.message });
    return false;
  }
}

// Event types
async function publishTicketCreated(ticket) {
  return publishEvent('support.ticket.created', {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumberFormatted,
    userId: ticket.user_id,
    userEmail: ticket.user_email,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    source: ticket.source
  });
}

async function publishTicketUpdated(ticket, changes) {
  return publishEvent('support.ticket.updated', {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumberFormatted,
    userId: ticket.user_id,
    userEmail: ticket.user_email,
    changes,
    assignedTo: ticket.assigned_to
  });
}

async function publishUserReply(ticket, message) {
  return publishEvent('support.ticket.reply.user', {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumberFormatted,
    messageId: message.id,
    userId: ticket.user_id,
    userEmail: ticket.user_email,
    assignedTo: ticket.assigned_to
  });
}

async function publishAdminReply(ticket, message) {
  return publishEvent('support.ticket.reply.admin', {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumberFormatted,
    messageId: message.id,
    userId: ticket.user_id,
    userEmail: ticket.user_email,
    adminId: message.user_id
  });
}

async function publishTicketResolved(ticket) {
  return publishEvent('support.ticket.resolved', {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumberFormatted,
    userId: ticket.user_id,
    userEmail: ticket.user_email,
    resolvedAt: ticket.resolved_at
  });
}

async function close() {
  if (!messagingContext) {
    return;
  }

  try {
    await messagingContext.close();
    messagingContext = null;
    logger.info('Support event publisher closed');
  } catch (error) {
    logger.error('Error closing event publisher', { error: error.message });
  }
}

module.exports = {
  initialize,
  isReady,
  publishTicketCreated,
  publishTicketUpdated,
  publishUserReply,
  publishAdminReply,
  publishTicketResolved,
  close
};
