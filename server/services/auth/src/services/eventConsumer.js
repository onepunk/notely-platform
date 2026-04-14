"use strict";

const shared = require('@notely/shared');
const authModel = require('../models/authModel');
const signupPolicy = require('./signupPolicy');

const SERVICE_NAME = process.env.SERVICE_NAME || 'auth';
const logger = shared.logger.child({ module: 'auth-event-consumer' });

let messagingContext = null;
let subscriptions = [];

async function initialize() {
  if (messagingContext) {
    return messagingContext;
  }

  messagingContext = await shared.messaging.createContext({
    serviceName: SERVICE_NAME
  });

  const profileQueue = `${SERVICE_NAME}.profile-sync`;
  const profileSubscription = await messagingContext.subscribe({
    queue: profileQueue,
    bindingKeys: ['user_profiles.profile.updated'],
    onMessage: handleUserProfileUpdated,
    options: {
      validate: validateProfileUpdatedEvent,
      prefetch: 20,
      requeueOnError: false
    }
  });

  subscriptions.push(profileSubscription);
  logger.info('Auth service subscribed to user_profiles.profile.updated events', { queue: profileQueue });

  const configQueue = `${SERVICE_NAME}.config-updates`;
  const configSubscription = await messagingContext.subscribe({
    queue: configQueue,
    bindingKeys: ['admin.config.general.updated'],
    onMessage: handleConfigUpdated,
    options: {
      prefetch: 5,
      requeueOnError: false
    }
  });

  subscriptions.push(configSubscription);
  logger.info('Auth service subscribed to admin config updates', { queue: configQueue });

  return messagingContext;
}

function validateProfileUpdatedEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('user_profiles.profile.updated payload must be an object');
  }

  const user = payload.user || {};
  if (!user.userId) {
    throw new Error('user_profiles.profile.updated payload requires user.userId');
  }

  return {
    occurredAt: payload.occurredAt || new Date().toISOString(),
    user: {
      userId: user.userId,
      email: user.email || null,
      firstName: user.firstName || null,
      lastName: user.lastName || null
    },
    changes: payload.changes || {}
  };
}

async function handleUserProfileUpdated(event) {
  const { user, changes } = event;

  await authModel.updateUserProfileFromEvent(user.userId, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName
  }, changes);
}

async function handleConfigUpdated(event) {
  const namespace = event?.namespace || '';
  const key = event?.key || '';

  if (namespace === 'general' || key === 'general_config') {
    logger.info('Received general config update event, refreshing signup policy cache');
    try {
      await signupPolicy.refresh();
      logger.info('Signup policy cache refreshed after config update');
    } catch (error) {
      logger.error('Failed to refresh signup policy cache after config update', { error: error.message });
    }
  }
}

async function close() {
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await subscription.close();
      } catch (error) {
        logger.error('Error closing auth event subscription', { error: error.message });
      }
    })
  );
  subscriptions = [];

  if (messagingContext) {
    try {
      await messagingContext.close();
      messagingContext = null;
    } catch (error) {
      logger.error('Failed to close auth messaging context', { error: error.message });
    }
  }
}

module.exports = {
  initialize,
  close
};
