/**
 * Event Publisher - Publishes email events to RabbitMQ
 * Uses shared messaging module for connection management, heartbeat, and error recovery
 */

const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'email-event-publisher' });

let messagingContext = null;

const EXCHANGE_NAME = 'email.events';

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
      serviceName: process.env.SERVICE_NAME || 'email',
      exchange: EXCHANGE_NAME
    });
    logger.info('Email event publisher initialized', { exchange: EXCHANGE_NAME });
  } catch (error) {
    logger.error('Failed to initialize email messaging', { error: error.message });
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
    logger.debug('Event not published - messaging context not initialized', { routingKey });
    return false;
  }

  try {
    await messagingContext.publish(routingKey, {
      ...payload,
      timestamp: new Date().toISOString()
    });

    logger.info('Email event published', { routingKey, recipient: payload.recipient });
    return true;
  } catch (error) {
    logger.error('Failed to publish email event', { routingKey, error: error.message });
    return false;
  }
}

// Event types
async function publishEmailSent(emailData) {
  return publishEvent('email.sent', {
    messageId: emailData.messageId,
    recipient: emailData.to,
    subject: emailData.subject,
    template: emailData.template || 'custom',
    cc: emailData.cc || [],
    bcc: emailData.bcc || []
  });
}

async function publishEmailFailed(emailData, error) {
  return publishEvent('email.failed', {
    recipient: emailData.to,
    subject: emailData.subject,
    template: emailData.template || 'custom',
    error: error.message,
    cc: emailData.cc || [],
    bcc: emailData.bcc || []
  });
}

async function publishEmailQueued(emailData) {
  return publishEvent('email.queued', {
    recipient: emailData.to,
    subject: emailData.subject,
    template: emailData.template || 'custom',
    cc: emailData.cc || [],
    bcc: emailData.bcc || []
  });
}

async function close() {
  if (!messagingContext) {
    return;
  }

  try {
    await messagingContext.close();
    messagingContext = null;
    logger.info('Email event publisher closed');
  } catch (error) {
    logger.error('Error closing event publisher', { error: error.message });
  }
}

module.exports = {
  initialize,
  isReady,
  publishEmailSent,
  publishEmailFailed,
  publishEmailQueued,
  close
};
