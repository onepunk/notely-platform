const shared = require('@notely/shared');

const logger = shared.logger.child({ module: 'admin-config-events' });

let messagingContextPromise = null;

const ROUTING_KEYS = {
  general: 'admin.config.general.updated',
  security: 'admin.config.security.updated',
  ai: 'admin.config.ai.updated',
  teams: 'admin.config.teams.updated',
  sync: 'admin.config.sync.updated',
  logging: 'admin.config.logging.updated',
  backup: 'admin.config.backup.updated',
  notifications: 'admin.config.notifications.updated'
};

async function ensureMessagingContext() {
  if (!process.env.RABBITMQ_URL) {
    logger.warn('RABBITMQ_URL not set, skipping config publish');
    return null;
  }

  if (!messagingContextPromise) {
    messagingContextPromise = shared.messaging
      .createContext({
        url: process.env.RABBITMQ_URL,
        serviceName: process.env.SERVICE_NAME || 'admin-config',
        logger: shared.logger.child({ module: 'admin-config-messaging' })
      })
      .catch((error) => {
        messagingContextPromise = null;
        logger.error('Failed to create messaging context', { error: error.message });
        throw error;
      });
  }

  try {
    return await messagingContextPromise;
  } catch (error) {
    logger.error('Messaging context unavailable', { error: error.message });
    return null;
  }
}

async function publishConfigUpdated(namespace, payload = {}, { actor, requestId } = {}) {
  const routingKey = ROUTING_KEYS[namespace];

  if (!routingKey) {
    logger.warn('Attempted to publish config update for unknown namespace', { namespace });
    return;
  }

  const context = await ensureMessagingContext();
  if (!context) {
    logger.warn('Messaging context unavailable, skipping config update publish', { namespace });
    return;
  }

  try {
    await context.publish(routingKey, {
      namespace,
      key: `${namespace}_config`,
      updatedAt: new Date().toISOString(),
      payload,
      actor: actor
        ? {
            id: actor.id,
            email: actor.email,
            role: actor.role
          }
        : null,
      requestId: requestId || null
    });
  } catch (error) {
    logger.error('Failed to publish config update event', {
      namespace,
      routingKey,
      error: error.message
    });
  }
}

async function shutdown() {
  if (!messagingContextPromise) {
    return;
  }

  try {
    const context = await messagingContextPromise;
    if (context) {
      await context.close();
    }
  } catch (error) {
    logger.warn('Failed to close messaging context cleanly', { error: error.message });
  } finally {
    messagingContextPromise = null;
  }
}

module.exports = {
  publishConfigUpdated,
  shutdown
};
