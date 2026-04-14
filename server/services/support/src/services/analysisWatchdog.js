/**
 * Analysis Watchdog
 * Periodically checks for stale in-progress analyses and marks them as failed
 */

const shared = require('@notely/shared');
const logger = shared.logger;
const db = shared.database;

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TIMEOUT_MINUTES = 10;

let intervalHandle = null;

async function checkStaleAnalyses() {
  try {
    const result = await db.query(
      `UPDATE support.diagnostics_bundles
       SET analysis_status = 'failed',
           analysis_error = 'Analysis timed out',
           analysis_completed_at = NOW()
       WHERE analysis_status = 'in_progress'
         AND analysis_started_at < NOW() - INTERVAL '10 minutes'
       RETURNING id`
    );

    if (result.rows.length > 0) {
      logger.warn('Timed out stale analyses', {
        count: result.rows.length,
        bundleIds: result.rows.map((r) => r.id),
      });
    }
  } catch (err) {
    logger.error('Analysis watchdog check failed', { error: err.message });
  }
}

function start() {
  if (intervalHandle) return;
  logger.info('Analysis watchdog started', { checkIntervalMs: CHECK_INTERVAL_MS, timeoutMinutes: TIMEOUT_MINUTES });
  intervalHandle = setInterval(checkStaleAnalyses, CHECK_INTERVAL_MS);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { start, stop };
