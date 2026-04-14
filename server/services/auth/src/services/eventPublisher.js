"use strict";

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const shared = require('@notely/shared');

const logger = shared.logger.child({ module: 'auth-event-publisher' });

let messagingContext = null;

async function initialize() {
  if (messagingContext) {
    return messagingContext;
  }

  try {
    messagingContext = await shared.messaging.createContext({
      serviceName: process.env.SERVICE_NAME || 'auth'
    });
    logger.info('Auth event publisher initialized');
  } catch (error) {
    logger.error('Failed to initialize messaging for Auth', { error: error.message });
    throw error;
  }

  return messagingContext;
}

async function publishLoginSuccess({ userId, email, sessionToken, ip, userAgent }) {
  if (!messagingContext) {
    logger.warn('Skipping login success publish because messaging is not initialized');
    return;
  }

  const payload = {
    eventId: uuidv4(),
    occurredAt: new Date().toISOString(),
    service: process.env.SERVICE_NAME || 'auth',
    version: 1,
    actor: {
      userId,
      email
    },
    context: {
      ip: ip || null,
      userAgent: userAgent || null,
      sessionHash: sessionToken ? hashToken(sessionToken) : null
    }
  };

  try {
    await messagingContext.publish('global_auth.user.login', payload);
  } catch (error) {
    logger.error('Failed to publish global_auth.user.login event', {
      error: error.message,
      userId,
      email
    });
  }
}

async function publishLoginFailure({ email, ip, userAgent, reason = 'invalid_credentials' }) {
  if (!messagingContext) {
    logger.warn('Skipping login failure publish because messaging is not initialized');
    return;
  }

  const payload = {
    eventId: uuidv4(),
    occurredAt: new Date().toISOString(),
    service: process.env.SERVICE_NAME || 'auth',
    version: 1,
    actor: {
      email
    },
    context: {
      ip: ip || null,
      userAgent: userAgent || null,
      reason
    }
  };

  try {
    await messagingContext.publish('global_auth.user.login_failed', payload, {
      headers: { 'x-failure-reason': reason }
    });
  } catch (error) {
    logger.error('Failed to publish global_auth.user.login_failed event', {
      error: error.message,
      email
    });
  }
}

async function publishLogoutSuccess({ userId, email, reason = 'user_initiated', revokedSessions = false }) {
  if (!messagingContext) {
    logger.warn('Skipping logout success publish because messaging is not initialized');
    return;
  }

  const payload = {
    eventId: uuidv4(),
    occurredAt: new Date().toISOString(),
    service: process.env.SERVICE_NAME || 'auth',
    version: 1,
    actor: {
      userId,
      email
    },
    context: {
      reason,
      revokedSessions: Boolean(revokedSessions)
    }
  };

  try {
    await messagingContext.publish('global_auth.user.logout', payload, {
      headers: { 'x-logout-reason': reason }
    });
  } catch (error) {
    logger.error('Failed to publish global_auth.user.logout event', {
      error: error.message,
      userId,
      email
    });
  }
}

async function publishUserRegistered({ authUserId, email, firstName, lastName, role, createdAt, viaBeta = false, ipAddress = null }) {
  if (!messagingContext) {
    logger.warn('Skipping user registered publish because messaging is not initialized');
    return;
  }

  const payload = {
    eventId: uuidv4(),
    occurredAt: new Date().toISOString(),
    service: process.env.SERVICE_NAME || 'auth',
    version: 1,
    user: {
      authUserId,
      email,
      firstName: firstName || null,
      lastName: lastName || null,
      role: role || 'user',
      createdAt: createdAt || null,
      viaBeta: Boolean(viaBeta),
      ipAddress: ipAddress || null
    }
  };

  try {
    await messagingContext.publish('global_auth.user.registered', payload);
  } catch (error) {
    logger.error('Failed to publish global_auth.user.registered event', {
      error: error.message,
      authUserId,
      email
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
    logger.error('Error closing Auth messaging context', { error: error.message });
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  initialize,
  publishLoginSuccess,
  publishLoginFailure,
  publishLogoutSuccess,
  publishUserRegistered,
  close
};
