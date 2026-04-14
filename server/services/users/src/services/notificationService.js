"use strict";

const shared = require('@notely/shared');
const emailClient = require('./emailClient');

const logger = shared.logger.child({ module: 'users-notification-service' });

const ADMIN_CONFIG_URL = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';
const CONFIG_CACHE_TTL_MS = parseInt(process.env.NOTIFICATION_CONFIG_CACHE_TTL_MS || '15000', 10);
const CONFIG_FETCH_TIMEOUT_MS = parseInt(process.env.NOTIFICATION_CONFIG_FETCH_TIMEOUT_MS || '4000', 10);

let cachedConfig = null;
let cacheExpiresAt = 0;

function now() {
  return Date.now();
}

async function fetchNotificationsConfig(force = false) {
  if (!ADMIN_CONFIG_URL) {
    logger.warn('ADMIN_CONFIG_SERVICE_URL is not configured; skipping notification fetch');
    return null;
  }

  if (!force && cachedConfig && now() < cacheExpiresAt) {
    return cachedConfig;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${ADMIN_CONFIG_URL}/api/public/config/notifications`, {
      headers: {
        'x-service-name': 'users'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    const data = await response.json();
    const normalized = {
      registration: {
        enabled: Boolean(data?.registration?.enabled),
        recipientEmail: (data?.registration?.recipientEmail || '').trim()
      }
    };

    cachedConfig = normalized;
    cacheExpiresAt = now() + CONFIG_CACHE_TTL_MS;
    return normalized;
  } catch (error) {
    logger.warn('Failed to fetch notifications config', { error: error.message });
    return cachedConfig;
  } finally {
    clearTimeout(timeout);
  }
}

function formatTimestamp(value) {
  if (!value) {
    return new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString('en-GB', { timeZone: 'Europe/London' });
}

async function sendRegistrationNotification(user) {
  const config = await fetchNotificationsConfig();
  if (!config?.registration?.enabled) {
    logger.debug('Registration notifications disabled; skipping email');
    return;
  }

  const recipient = config.registration.recipientEmail;
  if (!recipient) {
    logger.warn('Registration notifications enabled but recipient email is not set');
    return;
  }

  const subject = `New Notely user registered: ${user.email || 'unknown email'}`;

  const queued = await emailClient.queueTemplateEmail({
    to: recipient,
    subject,
    template: 'admin-notification',
    templateData: {
      firstName: user.firstName || 'N/A',
      lastName: user.lastName || 'N/A',
      email: user.email || 'N/A',
      role: user.role || 'user',
      ipAddress: user.ipAddress || 'N/A',
      timestamp: formatTimestamp(user.createdAt),
      isBeta: false
    }
  });

  if (queued) {
    logger.info('Registration notification queued for email service', {
      recipient,
      userId: user.id
    });
  } else {
    logger.error('Failed to queue registration notification email', {
      recipient,
      userId: user.id
    });
  }
}

module.exports = {
  sendRegistrationNotification,
  fetchNotificationsConfig
};
