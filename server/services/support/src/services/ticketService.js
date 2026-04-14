/**
 * Ticket Service - Business logic for support tickets
 */

const ticketModel = require('../models/ticketModel');
const messageModel = require('../models/messageModel');
const eventPublisher = require('./eventPublisher');
const metrics = require('../utils/metrics');
const shared = require('@notely/shared');
const logger = shared.logger;

/**
 * Create a new support ticket
 */
async function createTicket({ userId, userEmail, subject, description, category, priority, source = 'portal' }) {
  // Create the ticket
  const ticket = await ticketModel.createTicket({
    userId,
    userEmail,
    subject,
    description,
    category: category || 'general',
    priority: priority || 'normal',
    source
  });

  // Create initial message from the description
  await messageModel.createMessage({
    ticketId: ticket.id,
    userId,
    senderEmail: userEmail,
    senderName: null,
    message: description,
    isInternal: false,
    source
  });

  // Publish event
  await eventPublisher.publishTicketCreated(ticket);

  // Record metrics
  metrics.recordTicketCreated(source, ticket.category, ticket.priority);

  logger.info('Support ticket created', {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumberFormatted,
    userId,
    category: ticket.category,
    priority: ticket.priority
  });

  return ticket;
}

/**
 * Get a ticket with authorization check
 */
async function getTicket(ticketId, requestingUserId, isAdmin = false) {
  const ticket = await ticketModel.getTicketById(ticketId);

  if (!ticket) {
    return null;
  }

  // Non-admins can only view their own tickets
  if (!isAdmin && ticket.user_id !== requestingUserId) {
    return null;
  }

  // Get messages (admins see internal notes too)
  const messages = await messageModel.getMessagesByTicketId(ticketId, {
    includeInternal: isAdmin
  });

  return {
    ...ticket,
    messages
  };
}

/**
 * Get tickets for a user
 */
async function getUserTickets(userId, options = {}) {
  return ticketModel.getTicketsByUserId(userId, options);
}

/**
 * Get all tickets (admin)
 */
async function getAllTickets(options = {}) {
  return ticketModel.getAllTickets(options);
}

/**
 * Add a reply to a ticket
 */
async function addReply({ ticketId, userId, userEmail, userName, message, isAdmin = false, source = 'portal' }) {
  // Get the ticket first
  const ticket = await ticketModel.getTicketById(ticketId);
  if (!ticket) {
    throw new Error('Ticket not found');
  }

  // Check authorization for non-admins
  if (!isAdmin && ticket.user_id !== userId) {
    throw new Error('Not authorized to reply to this ticket');
  }

  // Create the message
  const newMessage = await messageModel.createMessage({
    ticketId,
    userId,
    senderEmail: userEmail,
    senderName: userName,
    message,
    isInternal: false,
    source
  });

  // Publish appropriate event
  if (isAdmin) {
    await eventPublisher.publishAdminReply(ticket, newMessage);
  } else {
    await eventPublisher.publishUserReply(ticket, newMessage);
  }

  // Record metrics
  metrics.recordMessageAdded(source, false);

  logger.info('Reply added to ticket', {
    ticketId,
    ticketNumber: ticket.ticketNumberFormatted,
    messageId: newMessage.id,
    isAdmin
  });

  return newMessage;
}

/**
 * Add an internal note (admin only)
 */
async function addInternalNote({ ticketId, adminId, adminEmail, adminName, note }) {
  const ticket = await ticketModel.getTicketById(ticketId);
  if (!ticket) {
    throw new Error('Ticket not found');
  }

  const message = await messageModel.createMessage({
    ticketId,
    userId: adminId,
    senderEmail: adminEmail,
    senderName: adminName,
    message: note,
    isInternal: true,
    source: 'portal'
  });

  // Record metrics
  metrics.recordMessageAdded('portal', true);

  logger.info('Internal note added to ticket', {
    ticketId,
    ticketNumber: ticket.ticketNumberFormatted,
    messageId: message.id,
    adminId
  });

  return message;
}

/**
 * Update ticket status/assignment (admin only)
 */
async function updateTicket(ticketId, updates, adminId) {
  const oldTicket = await ticketModel.getTicketById(ticketId);
  if (!oldTicket) {
    throw new Error('Ticket not found');
  }

  const updatedTicket = await ticketModel.updateTicket(ticketId, updates);

  // Track changes for event
  const changes = {};
  if (updates.status && updates.status !== oldTicket.status) {
    changes.status = { from: oldTicket.status, to: updates.status };
    metrics.recordStatusChange(oldTicket.status, updates.status);
  }
  if (updates.priority && updates.priority !== oldTicket.priority) {
    changes.priority = { from: oldTicket.priority, to: updates.priority };
  }
  if (updates.assigned_to !== undefined && updates.assigned_to !== oldTicket.assigned_to) {
    changes.assigned_to = { from: oldTicket.assigned_to, to: updates.assigned_to };
  }

  // Publish event if there were changes
  if (Object.keys(changes).length > 0) {
    await eventPublisher.publishTicketUpdated(updatedTicket, changes);

    // Publish resolved event if status changed to resolved
    if (updates.status === 'resolved') {
      await eventPublisher.publishTicketResolved(updatedTicket);
    }
  }

  logger.info('Ticket updated', {
    ticketId,
    ticketNumber: updatedTicket.ticketNumberFormatted,
    changes,
    adminId
  });

  return updatedTicket;
}

/**
 * Get ticket statistics
 */
async function getStats() {
  return ticketModel.getTicketStats();
}

module.exports = {
  createTicket,
  getTicket,
  getUserTickets,
  getAllTickets,
  addReply,
  addInternalNote,
  updateTicket,
  getStats
};
