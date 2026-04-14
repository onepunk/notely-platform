/**
 * Sync Pruning Scheduler
 * Schedules automatic cleanup of expired sync_changes and sync_mutations
 * Follows the same pattern as recordingRetentionScheduler.js
 */

import cron, { ScheduledTask } from 'node-cron';
import { runSyncPruning, getSyncPruningStats, PruningResult, PruningStats } from './syncPruningService';

// Configuration defaults
const DEFAULT_CRON_EXPRESSION = '0 3 * * *'; // 3 AM daily (offset from backup at 2 AM)
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_RETENTION_DAYS = 30;

// Environment variable overrides
const SYNC_PRUNING_ENABLED = process.env.SYNC_PRUNING_ENABLED !== 'false';
const SYNC_PRUNING_CRON = process.env.SYNC_PRUNING_CRON || DEFAULT_CRON_EXPRESSION;
const SYNC_PRUNING_TIMEZONE = process.env.SYNC_PRUNING_TIMEZONE || DEFAULT_TIMEZONE;
const SYNC_PRUNING_RETENTION_DAYS = parseInt(process.env.SYNC_PRUNING_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10);

// Scheduler state
let scheduledTask: ScheduledTask | null = null;
let currentSchedule: string | null = null;
let lastRunResult: PruningResult | null = null;
let lastRunError: string | null = null;
let isRunning = false;

/**
 * Get current scheduler configuration
 */
function getConfig() {
  return {
    enabled: SYNC_PRUNING_ENABLED,
    cronExpression: SYNC_PRUNING_CRON,
    timezone: SYNC_PRUNING_TIMEZONE,
    retentionDays: SYNC_PRUNING_RETENTION_DAYS,
  };
}

/**
 * Execute scheduled pruning cleanup
 */
async function executeScheduledPruning(): Promise<PruningResult> {
  if (isRunning) {
    console.log('[sync-pruning] Pruning already in progress, skipping');
    throw new Error('Pruning already in progress');
  }

  isRunning = true;
  lastRunError = null;

  console.log('[sync-pruning] Starting scheduled sync data pruning');

  try {
    const config = getConfig();
    const result = await runSyncPruning(config.retentionDays);

    lastRunResult = result;

    console.log('[sync-pruning] Scheduled pruning completed', {
      syncChangesDeleted: result.syncChangesDeleted,
      syncMutationsDeleted: result.syncMutationsDeleted,
      durationMs: result.durationMs,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    lastRunError = errorMessage;

    console.error('[sync-pruning] Scheduled pruning failed', {
      error: errorMessage,
    });

    throw error;
  } finally {
    isRunning = false;
  }
}

/**
 * Start the pruning scheduler
 */
export async function startScheduler(): Promise<void> {
  const config = getConfig();

  if (!config.enabled) {
    console.log('[sync-pruning] Sync pruning scheduler is disabled');
    stopScheduler();
    return;
  }

  // If schedule hasn't changed and task is already running, do nothing
  if (scheduledTask && currentSchedule === config.cronExpression) {
    console.log('[sync-pruning] Scheduler already running with same schedule', {
      cronExpression: config.cronExpression,
    });
    return;
  }

  // Stop existing scheduler if running
  stopScheduler();

  // Validate cron expression
  if (!cron.validate(config.cronExpression)) {
    console.error('[sync-pruning] Invalid cron expression', {
      cronExpression: config.cronExpression,
    });
    return;
  }

  // Start new scheduler
  scheduledTask = cron.schedule(
    config.cronExpression,
    async () => {
      try {
        await executeScheduledPruning();
      } catch (error) {
        // Error already logged in executeScheduledPruning
      }
    },
    {
      scheduled: true,
      timezone: config.timezone,
    }
  );

  currentSchedule = config.cronExpression;

  console.log('[sync-pruning] Sync pruning scheduler started', {
    cronExpression: config.cronExpression,
    timezone: config.timezone,
    retentionDays: config.retentionDays,
  });
}

/**
 * Stop the pruning scheduler
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    currentSchedule = null;
    console.log('[sync-pruning] Sync pruning scheduler stopped');
  }
}

/**
 * Restart scheduler (reload config and restart)
 */
export async function restartScheduler(): Promise<void> {
  console.log('[sync-pruning] Restarting sync pruning scheduler');
  stopScheduler();
  await startScheduler();
}

/**
 * Manually trigger pruning (for admin API)
 */
export async function triggerManualPruning(): Promise<PruningResult> {
  console.log('[sync-pruning] Manual pruning triggered');
  return executeScheduledPruning();
}

/**
 * Get scheduler status
 */
export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  cronExpression: string;
  timezone: string;
  retentionDays: number;
  currentSchedule: string | null;
  isExecuting: boolean;
  lastRun: PruningResult | null;
  lastError: string | null;
  stats: PruningStats | null;
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const config = getConfig();

  let stats: PruningStats | null = null;
  try {
    stats = await getSyncPruningStats();
  } catch (error) {
    console.warn('[sync-pruning] Failed to get pruning stats', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    enabled: config.enabled,
    running: scheduledTask !== null,
    cronExpression: config.cronExpression,
    timezone: config.timezone,
    retentionDays: config.retentionDays,
    currentSchedule,
    isExecuting: isRunning,
    lastRun: lastRunResult,
    lastError: lastRunError,
    stats,
  };
}
