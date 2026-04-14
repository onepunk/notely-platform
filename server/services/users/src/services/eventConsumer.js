"use strict";

const shared = require('@notely/shared');
const { recordLoginEvent } = require('../models/loginActivityModel');
const profileModel = require('../models/profileModel');
const notificationService = require('./notificationService');

const SERVICE_NAME = process.env.SERVICE_NAME || 'users';
const logger = shared.logger.child({ module: 'users-event-consumer' });

let messagingContext = null;
let subscriptions = [];

async function initialize() {
  if (messagingContext) {
    return messagingContext;
  }

  messagingContext = await shared.messaging.createContext({
    serviceName: SERVICE_NAME
  });

  const queueName = `${SERVICE_NAME}.events`;
  const subscription = await messagingContext.subscribe({
    queue: queueName,
    bindingKeys: ['global_auth.user.login', 'global_auth.user.registered'],
    onMessage: handleAuthEvent,
    options: {
      validate: validateAuthEvent,
      prefetch: 20,
      requeueOnError: false
    }
  });

  subscriptions.push(subscription);
  logger.info('Users service subscribed to auth events', { queue: queueName });

  return messagingContext;
}

async function handleAuthEvent(payload, envelope) {
  const routingKey = envelope?.routingKey;

  switch (routingKey) {
    case 'global_auth.user.login':
      await handleAuthLoginEvent(payload);
      break;
    case 'global_auth.user.registered':
      await handleAuthUserRegistered(payload);
      break;
    default:
      logger.warn('Received unsupported auth event', { routingKey });
  }
}

async function handleAuthLoginEvent(payload) {
  const actor = payload.actor || {};
  const context = payload.context || {};

  await recordLoginEvent({
    authUserId: actor.userId,
    occurredAt: payload.occurredAt || new Date().toISOString(),
    ip: context.ip || null,
    userAgent: context.userAgent || null
  });
}

async function handleAuthUserRegistered(payload) {
  const user = payload.user || {};

  if (!user.authUserId) {
    throw new Error('Registration event requires user.authUserId');
  }

  await profileModel.createProfileForAuthUser({
    authUserId: user.authUserId,
    email: user.email || null,
    firstName: user.firstName || null,
    lastName: user.lastName || null
  });

  logger.info('Created profile from registration event', {
    authUserId: user.authUserId,
    email: user.email || null,
    viaBeta: user.viaBeta || false
  });

  // Skip admin notification for beta users - admins already received "New Beta Signup" notification
  // when the user first signed up for beta, so sending another admin email is redundant
  if (user.viaBeta) {
    logger.debug('Skipping admin registration notification for beta user (already notified at signup)', {
      authUserId: user.authUserId
    });
    return;
  }

  try {
    await notificationService.sendRegistrationNotification({
      id: user.authUserId,
      email: user.email || null,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      role: user.role || 'user',
      createdAt: user.createdAt || payload.occurredAt || new Date().toISOString(),
      ipAddress: user.ipAddress || null
    });
  } catch (error) {
    logger.warn('Failed to send registration notification email', {
      error: error.message,
      authUserId: user.authUserId
    });
  }
}

function validateAuthEvent(payload, { envelope }) {
  const routingKey = envelope?.routingKey;

  if (routingKey === 'global_auth.user.login') {
    return validateLoginEvent(payload);
  }

  if (routingKey === 'global_auth.user.registered') {
    return validateRegistrationEvent(payload);
  }

  throw new Error(`Unsupported auth routing key: ${routingKey}`);
}

function validateLoginEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Login event payload must be an object');
  }

  const actor = payload.actor || {};
  if (!actor.userId) {
    throw new Error('Login event requires actor.userId');
  }

  return {
    occurredAt: payload.occurredAt || new Date().toISOString(),
    actor: {
      userId: actor.userId,
      email: actor.email || null
    },
    context: payload.context || {}
  };
}

function validateRegistrationEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Registration event payload must be an object');
  }

  const user = payload.user || {};
  if (!user.authUserId) {
    throw new Error('Registration event requires user.authUserId');
  }

  return {
    occurredAt: payload.occurredAt || new Date().toISOString(),
    user: {
      authUserId: user.authUserId,
      email: user.email || null,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      role: user.role || 'user',
      createdAt: user.createdAt || payload.occurredAt || null,
      viaBeta: Boolean(user.viaBeta),
      ipAddress: user.ipAddress || null
    }
  };
}

async function close() {
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await subscription.close();
      } catch (error) {
        logger.error('Error closing subscription', { error: error.message });
      }
    })
  );
  subscriptions = [];

  if (messagingContext) {
    try {
      await messagingContext.close();
      messagingContext = null;
    } catch (error) {
      logger.error('Failed to close messaging context', { error: error.message });
    }
  }
}

module.exports = {
  initialize,
  close
};
