"use strict";

const { v4: uuidv4 } = require('uuid');
const shared = require('@notely/shared');

const SERVICE_NAME = process.env.SERVICE_NAME || 'users';
const logger = shared.logger.child({ module: 'users-event-publisher' });

let messagingContext = null;

async function initialize() {
  if (messagingContext) {
    return messagingContext;
  }

  messagingContext = await shared.messaging.createContext({
    serviceName: SERVICE_NAME
  });

  logger.info('Users messaging publisher ready');
  return messagingContext;
}

async function publishProfileUpdated({ user, changes }) {
  if (!messagingContext) {
    logger.warn('Messaging context not initialized before publish; skipping users.profile.updated');
    return;
  }

  if (!user?.userId) {
    logger.warn('Cannot publish profile update event without userId', { user });
    return;
  }

  const payload = {
    eventId: uuidv4(),
    occurredAt: new Date().toISOString(),
    service: SERVICE_NAME,
    version: 1,
    user: {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      locale: user.locale,
      timeZone: user.timeZone,
      preferences: user.preferences ?? {}
    },
    changes: changes || {}
  };

  try {
    await messagingContext.publish('users.profile.updated', payload);
  } catch (error) {
    logger.error('Failed to publish users.profile.updated event', {
      error: error.message,
      userId: user.userId
    });
  }
}

async function publishUserDeleted({ userId, email }) {
  if (!messagingContext) {
    logger.warn('Messaging context not initialized before publish; skipping users.user.deleted');
    return;
  }

  if (!userId) {
    logger.warn('Cannot publish user deleted event without userId');
    return;
  }

  const payload = {
    eventId: uuidv4(),
    occurredAt: new Date().toISOString(),
    service: SERVICE_NAME,
    version: 1,
    user: { userId, email }
  };

  try {
    await messagingContext.publish('users.user.deleted', payload);
    logger.info('Published users.user.deleted event', { userId, email });
  } catch (error) {
    logger.error('Failed to publish users.user.deleted event', {
      error: error.message,
      userId
    });
  }
}

async function close() {
  if (!messagingContext) {
    return;
  }

  try {
    await messagingContext.close();
    messagingContext = null;
  } catch (error) {
    logger.error('Failed to close users messaging context', { error: error.message });
  }
}

module.exports = {
  initialize,
  publishProfileUpdated,
  publishUserDeleted,
  close
};
