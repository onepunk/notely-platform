/**
 * Event Consumer - Consumes events from other services that require email notifications
 * Uses shared messaging module for connection management, heartbeat, and error recovery
 */

const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'email-event-consumer' });
const emailService = require('./emailService');

let messagingContext = null;
let subscriptions = [];

const QUEUE_NAME = 'email.requests';

/**
 * Initialize messaging context and subscribe to queues
 * Uses shared module with connection caching, heartbeat (30s), and automatic cache invalidation
 */
async function initialize() {
  if (messagingContext) {
    return messagingContext;
  }

  try {
    messagingContext = await shared.messaging.createContext({
      serviceName: process.env.SERVICE_NAME || 'email',
      exchange: 'email.requests'
    });

    // Subscribe to email.requests queue with bindings to multiple exchanges
    const emailSubscription = await messagingContext.subscribe({
      queue: QUEUE_NAME,
      bindingKeys: [
        'email.send',
        'support.ticket.created',
        'support.ticket.reply.user',
        'support.ticket.reply.admin'
      ],
      onMessage: handleMessage,
      options: {
        prefetch: 1,
        requeueOnError: false
      }
    });

    subscriptions.push(emailSubscription);

    logger.info('Email event consumer initialized', { queue: QUEUE_NAME });
  } catch (error) {
    logger.error('Failed to initialize email consumer', { error: error.message });
    throw error;
  }

  return messagingContext;
}

/**
 * Check if consumer is ready
 */
function isReady() {
  return Boolean(messagingContext && subscriptions.length > 0);
}

async function handleMessage(content, envelope) {
  const routingKey = envelope.routingKey;

  try {
    logger.info('Received event', { routingKey, content });

    // Handle different event types
    switch (routingKey) {
      case 'support.ticket.created':
        await handleTicketCreated(content);
        break;
      case 'support.ticket.reply.user':
        await handleUserReply(content);
        break;
      case 'support.ticket.reply.admin':
        await handleAdminReply(content);
        break;
      case 'email.send':
      case 'email.requests':
        await handleEmailSendRequest(content);
        break;
      default:
        logger.debug('Unhandled routing key', { routingKey });
    }
  } catch (error) {
    logger.error('Error processing message', {
      error: error.message,
      routingKey,
      messageId: envelope.messageId
    });
    throw error; // Let shared module handle nack
  }
}

async function handleTicketCreated(data) {
  try {
    await emailService.sendTemplate('support-ticket-created', {
      to: data.userEmail,
      subject: `Support Ticket Created: ${data.ticketNumber}`,
      templateData: {
        ticketNumber: data.ticketNumber,
        subject: data.subject,
        category: data.category,
        priority: data.priority
      }
    });
  } catch (error) {
    logger.error('Failed to send ticket created email', { error: error.message, data });
  }
}

async function handleUserReply(data) {
  try {
    // Notify admin of user reply
    const adminEmail = process.env.SUPPORT_ADMIN_EMAIL;
    if (adminEmail) {
      await emailService.sendTemplate('support-user-reply', {
        to: adminEmail,
        subject: `User Reply on Ticket ${data.ticketNumber}`,
        templateData: {
          ticketNumber: data.ticketNumber,
          userEmail: data.userEmail
        }
      });
    }
  } catch (error) {
    logger.error('Failed to send user reply notification', { error: error.message, data });
  }
}

async function handleAdminReply(data) {
  try {
    // Notify user of admin reply
    await emailService.sendTemplate('support-admin-reply', {
      to: data.userEmail,
      subject: `Response to your ticket ${data.ticketNumber}`,
      templateData: {
        ticketNumber: data.ticketNumber
      }
    });
  } catch (error) {
    logger.error('Failed to send admin reply notification', { error: error.message, data });
  }
}

async function handleEmailSendRequest(data) {
  try {
    // Support both 'recipient' (new format) and 'to' (old format)
    const recipient = data.recipient || data.to;
    // Extract CC and BCC arrays
    const cc = Array.isArray(data.cc) ? data.cc : [];
    const bcc = Array.isArray(data.bcc) ? data.bcc : [];

    if (data.template || data.templateName) {
      // Templated email - support both 'template' and 'templateName'
      const templateName = data.template || data.templateName;
      const templateData = data.templateData || data.variables || {};

      await emailService.sendTemplate(templateName, {
        to: recipient,
        subject: data.subject,
        templateData,
        cc,
        bcc,
        replyTo: data.replyTo,
        from: data.from,
        fromName: data.fromName,
        correlationId: data.correlationId
      });
    } else {
      // Raw HTML email
      await emailService.sendEmail({
        to: recipient,
        subject: data.subject,
        html: data.html,
        text: data.text,
        cc,
        bcc,
        replyTo: data.replyTo,
        from: data.from,
        fromName: data.fromName,
        correlationId: data.correlationId
      });
    }

    logger.info('Email sent from queue', {
      correlationId: data.correlationId,
      recipient,
      subject: data.subject,
      template: data.template || data.templateName || 'raw',
      ccCount: cc.length,
      bccCount: bcc.length
    });
  } catch (error) {
    logger.error('Failed to send email from queue', {
      error: error.message,
      correlationId: data.correlationId,
      recipient: data.recipient || data.to,
      subject: data.subject
    });
  }
}

async function close() {
  try {
    for (const sub of subscriptions) {
      await sub.close();
    }
    subscriptions = [];

    if (messagingContext) {
      await messagingContext.close();
      messagingContext = null;
    }
    logger.info('Email event consumer closed');
  } catch (error) {
    logger.error('Error closing event consumer', { error: error.message });
  }
}

module.exports = {
  initialize,
  isReady,
  close
};
