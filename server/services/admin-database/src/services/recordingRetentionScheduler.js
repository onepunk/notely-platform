/**
 * Recording Retention Scheduler
 * Schedules automatic cleanup of expired recording files
 */

const cron = require('node-cron');

const shared = require('@notely/shared');
const recordingRetentionService = require('./recordingRetentionService');

const logger = shared.logger.child({ service: 'admin-database', scope: 'recording-retention-scheduler' });

// Admin-config service URL for fetching configuration
const ADMIN_CONFIG_URL = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';

let scheduledTask = null;
let currentSchedule = null;

/**
 * Fetch recording retention configuration from admin-config service
 */
async function getRetentionConfig() {
  try {
    const response = await fetch(`${ADMIN_CONFIG_URL}/api/admin/config/recording-quotas`);
    if (!response.ok) {
      throw new Error(`Failed to fetch recording quotas config: ${response.status}`);
    }
    const data = await response.json();
    return data.config?.retentionCleanup || {
      enabled: true,
      cronExpression: '0 2 * * *', // Default: 2 AM daily
      timezone: 'UTC',
      batchSize: 100
    };
  } catch (error) {
    logger.warn('Failed to fetch retention config, using defaults', {
      error: error.message
    });
    return {
      enabled: true,
      cronExpression: '0 2 * * *',
      timezone: 'UTC',
      batchSize: 100
    };
  }
}

/**
 * Execute scheduled retention cleanup
 */
async function executeScheduledCleanup() {
  const startTime = Date.now();

  logger.info('Starting scheduled recording retention cleanup');

  try {
    // Fetch current config to get batch size
    const config = await getRetentionConfig();
    const batchSize = config.batchSize || 100;

    // Run the cleanup
    const result = await recordingRetentionService.runRetentionCleanup(batchSize);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('Scheduled recording retention cleanup completed', {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      transcriptsPreserved: result.transcriptsPreserved,
      duration
    });

    return result;
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.error('Scheduled recording retention cleanup failed', {
      error: error.message,
      stack: error.stack,
      duration
    });

    throw error;
  }
}

/**
 * Start the retention scheduler
 */
async function startScheduler() {
  try {
    const config = await getRetentionConfig();

    if (!config.enabled) {
      logger.info('Recording retention scheduler is disabled');
      stopScheduler();
      return;
    }

    // If schedule hasn't changed and task is already running, do nothing
    if (scheduledTask && currentSchedule === config.cronExpression) {
      logger.debug('Retention scheduler already running with same schedule', {
        cronExpression: config.cronExpression
      });
      return;
    }

    // Stop existing scheduler if running
    stopScheduler();

    // Validate cron expression
    if (!cron.validate(config.cronExpression)) {
      logger.error('Invalid cron expression for retention cleanup', {
        cronExpression: config.cronExpression
      });
      return;
    }

    // Start new scheduler
    scheduledTask = cron.schedule(
      config.cronExpression,
      async () => {
        try {
          await executeScheduledCleanup();
        } catch (error) {
          logger.error('Scheduled retention cleanup execution failed', {
            error: error.message
          });
        }
      },
      {
        scheduled: true,
        timezone: config.timezone || 'UTC'
      }
    );

    currentSchedule = config.cronExpression;

    logger.info('Recording retention scheduler started', {
      cronExpression: config.cronExpression,
      timezone: config.timezone,
      batchSize: config.batchSize
    });
  } catch (error) {
    logger.error('Failed to start recording retention scheduler', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Stop the retention scheduler
 */
function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    currentSchedule = null;
    logger.info('Recording retention scheduler stopped');
  }
}

/**
 * Restart scheduler (reload config and restart)
 */
async function restartScheduler() {
  logger.info('Restarting recording retention scheduler');
  stopScheduler();
  await startScheduler();
}

/**
 * Get scheduler status
 */
async function getSchedulerStatus() {
  const config = await getRetentionConfig();

  // Get retention stats
  let stats = null;
  try {
    stats = await recordingRetentionService.getRetentionStats();
  } catch (error) {
    logger.warn('Failed to get retention stats', { error: error.message });
  }

  return {
    enabled: config.enabled,
    running: scheduledTask !== null,
    cronExpression: config.cronExpression,
    timezone: config.timezone,
    batchSize: config.batchSize,
    currentSchedule,
    stats
  };
}

module.exports = {
  startScheduler,
  stopScheduler,
  restartScheduler,
  getSchedulerStatus,
  executeScheduledCleanup
};
