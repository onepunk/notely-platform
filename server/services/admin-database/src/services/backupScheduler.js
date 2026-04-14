const cron = require('node-cron');

const shared = require('@notely/shared');
const backupService = require('./backupService');

const baseLogger = shared.logger.child({ service: 'admin-database', scope: 'backup-scheduler' });

// Admin-config service URL for fetching backup configuration
const ADMIN_CONFIG_URL = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';

let scheduledTask = null;
let currentSchedule = null;

/**
 * Fetch backup scheduler configuration from admin-config service
 */
async function getSchedulerConfig() {
  try {
    const response = await fetch(`${ADMIN_CONFIG_URL}/api/admin/config/backup`);
    if (!response.ok) {
      throw new Error(`Failed to fetch backup config: ${response.status}`);
    }
    const data = await response.json();
    return data.config?.scheduler || {
      enabled: false,
      cronExpression: '0 2 * * *', // Default: 2 AM daily
      timezone: 'UTC'
    };
  } catch (error) {
    baseLogger.warn('Failed to fetch scheduler config, using defaults', {
      error: error.message
    });
    return {
      enabled: false,
      cronExpression: '0 2 * * *',
      timezone: 'UTC'
    };
  }
}

/**
 * Execute scheduled backup
 */
async function executeScheduledBackup() {
  const startTime = Date.now();

  baseLogger.info('Starting scheduled backup');

  try {
    // Fetch current backup options from config
    const response = await fetch(`${ADMIN_CONFIG_URL}/api/admin/config/backup`);
    if (!response.ok) {
      throw new Error(`Failed to fetch backup config: ${response.status}`);
    }
    const data = await response.json();
    const options = data.config?.options || {
      includeUserData: true,
      includeMerkleState: true,
      includeMetrics: false,
      compressionEnabled: true,
      maxUsers: null
    };

    // Create backup with 'scheduled' type
    const result = await backupService.createBackup(
      options,
      { email: 'system', userId: null }, // System actor
      'scheduled' // Backup type
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    baseLogger.info('Scheduled backup completed successfully', {
      backupId: result.backupId,
      duration,
      fileSize: result.statistics.totalSize,
      totalRecords: result.statistics.totalRecords
    });

    return result;
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    baseLogger.error('Scheduled backup failed', {
      error: error.message,
      stack: error.stack,
      duration
    });

    throw error;
  }
}

/**
 * Start the backup scheduler
 */
async function startScheduler() {
  try {
    const config = await getSchedulerConfig();

    if (!config.enabled) {
      baseLogger.info('Backup scheduler is disabled');
      stopScheduler();
      return;
    }

    // If schedule hasn't changed and task is already running, do nothing
    if (scheduledTask && currentSchedule === config.cronExpression) {
      baseLogger.debug('Scheduler already running with same schedule', {
        cronExpression: config.cronExpression
      });
      return;
    }

    // Stop existing scheduler if running
    stopScheduler();

    // Validate cron expression
    if (!cron.validate(config.cronExpression)) {
      baseLogger.error('Invalid cron expression', {
        cronExpression: config.cronExpression
      });
      return;
    }

    // Start new scheduler
    scheduledTask = cron.schedule(
      config.cronExpression,
      async () => {
        try {
          await executeScheduledBackup();
        } catch (error) {
          baseLogger.error('Scheduled backup execution failed', {
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

    baseLogger.info('Backup scheduler started', {
      cronExpression: config.cronExpression,
      timezone: config.timezone,
      nextRun: getNextScheduledRun(config.cronExpression, config.timezone)
    });
  } catch (error) {
    baseLogger.error('Failed to start backup scheduler', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Stop the backup scheduler
 */
function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    currentSchedule = null;
    baseLogger.info('Backup scheduler stopped');
  }
}

/**
 * Restart scheduler (reload config and restart)
 */
async function restartScheduler() {
  baseLogger.info('Restarting backup scheduler');
  stopScheduler();
  await startScheduler();
}

/**
 * Get next scheduled run time
 */
function getNextScheduledRun(cronExpression, timezone = 'UTC') {
  try {
    // This is a simplified version - in production you'd use a library like cron-parser
    // For now, just return a descriptive message
    return `Next run scheduled according to: ${cronExpression} (${timezone})`;
  } catch (error) {
    return 'Unknown';
  }
}

/**
 * Get scheduler status
 */
async function getSchedulerStatus() {
  const config = await getSchedulerConfig();

  return {
    enabled: config.enabled,
    running: scheduledTask !== null,
    cronExpression: config.cronExpression,
    timezone: config.timezone,
    currentSchedule,
    nextRun: config.enabled ? getNextScheduledRun(config.cronExpression, config.timezone) : null
  };
}

module.exports = {
  startScheduler,
  stopScheduler,
  restartScheduler,
  getSchedulerStatus,
  executeScheduledBackup
};
