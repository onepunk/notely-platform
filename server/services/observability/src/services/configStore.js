"use strict";

const EventEmitter = require('events');

const shared = require('@notely/shared');

const logger = shared.logger.child({ module: 'logs-config-store' });
const db = shared.database;

const DEFAULT_RETENTION_DAYS = parseInt(process.env.LOGS_DEFAULT_RETENTION_DAYS || process.env.LOKI_RETENTION_DAYS || '7', 10);
const DEFAULT_CRON = process.env.LOG_RETENTION_CRON || '30 2 * * *';
const DEFAULT_TIMEZONE = process.env.LOG_RETENTION_TZ || 'UTC';

const CONFIG_KEY = 'logging_config';

const emitter = new EventEmitter();

let currentConfig = buildDefaultConfig();
let messagingContext = null;
let subscription = null;

function buildDefaultConfig() {
  return {
    retention: {
      retention_days: DEFAULT_RETENTION_DAYS,
      default_retention_days: DEFAULT_RETENTION_DAYS
    },
    scheduler: {
      enabled: true,
      cron_expression: DEFAULT_CRON,
      timezone: DEFAULT_TIMEZONE
    }
  };
}

function normalizeConfig(raw) {
  const base = buildDefaultConfig();
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const { retention = {}, scheduler = {} } = raw;

  if (retention && typeof retention === 'object') {
    const retentionDays = Number(retention.retention_days);
    if (Number.isFinite(retentionDays)) {
      base.retention.retention_days = Math.max(1, Math.min(365, Math.floor(retentionDays)));
    }

    const defaultRetentionDays = Number(retention.default_retention_days);
    if (Number.isFinite(defaultRetentionDays)) {
      base.retention.default_retention_days = Math.max(1, Math.min(365, Math.floor(defaultRetentionDays)));
    }
  }

  if (scheduler && typeof scheduler === 'object') {
    if (typeof scheduler.enabled === 'boolean') {
      base.scheduler.enabled = scheduler.enabled;
    }
    if (typeof scheduler.cron_expression === 'string' && scheduler.cron_expression.trim()) {
      base.scheduler.cron_expression = scheduler.cron_expression.trim();
    }
    if (typeof scheduler.timezone === 'string' && scheduler.timezone.trim()) {
      base.scheduler.timezone = scheduler.timezone.trim();
    }
  }

  return base;
}

async function loadConfigFromDatabase() {
  try {
    const result = await db.query(
      `SELECT value
         FROM admin_settings.system_settings
        WHERE key = $1`,
      [CONFIG_KEY]
    );

    if (!result.rows[0]) {
      logger.warn('Logging configuration not found in database, using defaults');
      currentConfig = buildDefaultConfig();
      emitter.emit('update', currentConfig);
      return currentConfig;
    }

    const rawValue = result.rows[0].value;
    const parsed =
      typeof rawValue === 'object'
        ? rawValue
        : safeParseJson(rawValue, { namespace: 'database' });

    currentConfig = normalizeConfig(parsed);
    emitter.emit('update', currentConfig);

    logger.info('Loaded logging configuration from database', currentConfig);
    return currentConfig;
  } catch (error) {
    logger.error('Failed to load logging configuration from database', { error: error.message });
    currentConfig = buildDefaultConfig();
    emitter.emit('update', currentConfig);
    return currentConfig;
  }
}

function safeParseJson(value, context = {}) {
  try {
    return JSON.parse(value);
  } catch (error) {
    logger.warn('Failed to parse JSON configuration payload', { ...context, error: error.message });
    return null;
  }
}

async function ensureMessagingContext() {
  if (!process.env.RABBITMQ_URL) {
    return null;
  }

  if (messagingContext) {
    return messagingContext;
  }

  try {
    messagingContext = await shared.messaging.createContext({
      serviceName: process.env.SERVICE_NAME || 'logs'
    });
    return messagingContext;
  } catch (error) {
    logger.error('Failed to create messaging context for config updates', { error: error.message });
    messagingContext = null;
    return null;
  }
}

async function subscribeToConfigUpdates() {
  const context = await ensureMessagingContext();
  if (!context) {
    logger.warn('Messaging context unavailable, skipping logging config subscription');
    return;
  }

  const queueName = `${process.env.SERVICE_NAME || 'logs'}.logging-config`;

  subscription = await context.subscribe({
    queue: queueName,
    bindingKeys: ['admin.config.logging.updated'],
    onMessage: async (event) => {
      const updated = normalizeConfig(event?.payload);
      currentConfig = updated;
      emitter.emit('update', currentConfig);
      logger.info('Logging configuration updated from event', { updatedFromEvent: true });
    },
    options: {
      prefetch: 5,
      requeueOnError: false
    }
  });

  logger.info('Subscribed to logging configuration updates', { queue: queueName });
}

async function initialize() {
  await loadConfigFromDatabase();
  await subscribeToConfigUpdates();
}

async function refresh() {
  await loadConfigFromDatabase();
}

function getConfig() {
  return { ...currentConfig };
}

function getRetentionSettings() {
  return { ...currentConfig.retention };
}

function getSchedulerSettings() {
  return { ...currentConfig.scheduler };
}

async function shutdown() {
  if (subscription) {
    try {
      await subscription.close();
    } catch (error) {
      logger.warn('Failed to close logging config subscription cleanly', { error: error.message });
    }
    subscription = null;
  }

  if (messagingContext) {
    try {
      await messagingContext.close();
    } catch (error) {
      logger.warn('Failed to close messaging context cleanly', { error: error.message });
    }
    messagingContext = null;
  }
}

function on(event, handler) {
  emitter.on(event, handler);
}

module.exports = {
  initialize,
  refresh,
  shutdown,
  getConfig,
  getRetentionSettings,
  getSchedulerSettings,
  on
};
