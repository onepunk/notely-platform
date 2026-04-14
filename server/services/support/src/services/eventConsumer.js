/**
 * Event Consumer - Consumes events from other services
 * Uses shared messaging module for connection management, heartbeat, and error recovery
 */

const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'support-event-consumer' });
const betaSignupModel = require('../models/betaSignupModel');

let messagingContext = null;
let subscription = null;

const QUEUE_NAME = 'support.notifications';

/**
 * Initialize messaging context and subscribe to queue
 * Uses shared module with connection caching, heartbeat (30s), and automatic cache invalidation
 */
async function initialize() {
  if (messagingContext) {
    return messagingContext;
  }

  try {
    messagingContext = await shared.messaging.createContext({
      serviceName: process.env.SERVICE_NAME || 'support'
    });

    // Subscribe to notifications queue
    subscription = await messagingContext.subscribe({
      queue: QUEUE_NAME,
      bindingKeys: ['support.notifications.*', 'users.user.deleted'],
      onMessage: handleMessage,
      options: {
        prefetch: 1,
        requeueOnError: false
      }
    });

    logger.info('Support event consumer initialized', { queue: QUEUE_NAME });
  } catch (error) {
    logger.error('Failed to initialize support consumer', { error: error.message });
    throw error;
  }

  return messagingContext;
}

/**
 * Check if consumer is ready
 */
function isReady() {
  return Boolean(messagingContext && subscription);
}

async function handleMessage(content, envelope) {
  try {
    logger.info('Received event', {
      routingKey: envelope.routingKey,
      messageId: envelope.messageId,
      content
    });

    switch (envelope.routingKey) {
      case 'users.user.deleted': {
        const email = content?.user?.email;
        if (email) {
          const deleted = await betaSignupModel.deleteByEmail(email);
          logger.info('Handled user deletion — cleaned beta signups', { email, deleted });
        } else {
          logger.warn('users.user.deleted event missing user.email', { content });
        }
        break;
      }
      default:
        logger.info('Unhandled routing key', { routingKey: envelope.routingKey });
    }

  } catch (error) {
    logger.error('Error processing message', {
      error: error.message,
      routingKey: envelope.routingKey,
      messageId: envelope.messageId
    });
    throw error; // Let shared module handle nack
  }
}

async function close() {
  try {
    if (subscription) {
      await subscription.close();
      subscription = null;
    }
    if (messagingContext) {
      await messagingContext.close();
      messagingContext = null;
    }
    logger.info('Support event consumer closed');
  } catch (error) {
    logger.error('Error closing event consumer', { error: error.message });
  }
}

module.exports = {
  initialize,
  isReady,
  close
};
