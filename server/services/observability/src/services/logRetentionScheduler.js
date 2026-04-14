"use strict";

const cron = require('node-cron');

const shared = require('@notely/shared');
const configStore = require('./configStore');
const lokiClient = require('./lokiClient');
const metrics = require('../utils/metrics');

const logger = shared.logger.child({ module: 'logs-retention-scheduler' });

let cronJob = null;
let initialized = false;

const schedulerState = {
  enabled: true,
  running: false,
  last_trigger: null,
  last_run_started_at: null,
  last_run_completed_at: null,
  last_result: null,
  last_error: null,
  cron_expression: null,
  timezone: null
};

async function runEnforcement(trigger = 'scheduled', options = {}) {
  if (schedulerState.running) {
    logger.warn('Log retention check skipped because another run is in progress', { trigger });
    return {
      status: 'skipped',
      reason: 'already_running',
      trigger
    };
  }

  schedulerState.running = true;
  schedulerState.last_trigger = trigger;
  schedulerState.last_run_started_at = new Date().toISOString();

  try {
    const config = configStore.getConfig();
    const retentionDays = options.retentionDays || config.retention.retention_days;

    // For manual triggers, use manual enforcement (still calls delete API)
    // For scheduled triggers, use monitoring check (no delete API call)
    const result = trigger === 'api-manual'
      ? await lokiClient.manualEnforceRetention(retentionDays, {
          dryRun: options.dryRun,
          service: options.service
        })
      : await lokiClient.enforceRetention(retentionDays, {
          dryRun: options.dryRun,
          service: options.service
        });

    schedulerState.last_run_completed_at = new Date().toISOString();
    schedulerState.last_result = {
      ...result,
      trigger,
      retention_days: retentionDays
    };
    schedulerState.last_error = null;

    metrics.incrementRetention(trigger, result.status || 'success');
    logger.info('Log retention check completed', schedulerState.last_result);
    return schedulerState.last_result;
  } catch (error) {
    schedulerState.last_run_completed_at = new Date().toISOString();
    schedulerState.last_error = {
      message: error.message,
      stack: error.stack,
      trigger,
      occurredAt: schedulerState.last_run_completed_at
    };

    metrics.incrementRetention(trigger, 'error');
    logger.error('Log retention check failed', schedulerState.last_error);
    throw error;
  } finally {
    schedulerState.running = false;
  }
}

function configureCronJob(config) {
  const { scheduler } = config;

  schedulerState.enabled = scheduler.enabled;
  schedulerState.cron_expression = scheduler.cron_expression;
  schedulerState.timezone = scheduler.timezone;

  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }

  if (!scheduler.enabled) {
    logger.warn('Log retention scheduler disabled via configuration');
    return;
  }

  try {
    cronJob = cron.schedule(
      scheduler.cron_expression,
      () => {
        runEnforcement('scheduled').catch((error) => {
          logger.error('Scheduled log retention check failed', { error: error.message });
        });
      },
      {
        scheduled: true,
        timezone: scheduler.timezone || 'UTC'
      }
    );

    logger.info('Log retention scheduler configured', {
      cron: scheduler.cron_expression,
      timezone: scheduler.timezone
    });
  } catch (error) {
    logger.error('Failed to configure log retention scheduler', {
      error: error.message,
      cron: scheduler.cron_expression,
      timezone: scheduler.timezone
    });
  }
}

async function initialize() {
  if (initialized) {
    return;
  }

  const config = configStore.getConfig();
  configureCronJob(config);

  configStore.on('update', (updatedConfig) => {
    logger.info('Logging configuration updated, reconfiguring scheduler');
    configureCronJob(updatedConfig);
  });

  // Trigger startup retention check after initial delay if scheduler enabled
  if (config.scheduler.enabled) {
    setTimeout(() => {
      runEnforcement('startup').catch((error) => {
        logger.error('Startup log retention check failed', { error: error.message });
      });
    }, parseInt(process.env.LOG_RETENTION_STARTUP_DELAY_MS || '15000', 10));
  }

  initialized = true;
}

async function shutdown() {
  if (cronJob) {
    try {
      cronJob.stop();
    } catch (error) {
      logger.warn('Failed to stop log retention cron job cleanly', { error: error.message });
    }
    cronJob = null;
  }
}

function getSchedulerState() {
  return {
    running: schedulerState.running,
    last_trigger: schedulerState.last_trigger,
    last_run_started_at: schedulerState.last_run_started_at,
    last_run_completed_at: schedulerState.last_run_completed_at,
    last_result: schedulerState.last_result,
    last_error: schedulerState.last_error,
    cron_expression: schedulerState.cron_expression,
    timezone: schedulerState.timezone,
    enabled: schedulerState.enabled,
    enforcement: lokiClient.getEnforcementState()
  };
}

module.exports = {
  initialize,
  shutdown,
  runEnforcement,
  getSchedulerState
};
