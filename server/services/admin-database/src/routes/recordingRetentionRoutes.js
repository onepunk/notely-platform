/**
 * Recording Retention Routes
 * API endpoints for managing recording file retention and cleanup
 */

const express = require('express');

const shared = require('@notely/shared');
const recordingRetentionService = require('../services/recordingRetentionService');
const recordingRetentionScheduler = require('../services/recordingRetentionScheduler');

const router = express.Router();
const logger = shared.logger.child({ service: 'admin-database', scope: 'recording-retention-routes' });
const { asyncHandler } = shared.errors;

/**
 * GET /status
 * Get the current status of the recording retention scheduler and statistics
 */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    logger.info('Fetching recording retention status', { user: req.user?.email });

    const status = await recordingRetentionScheduler.getSchedulerStatus();

    res.json({
      success: true,
      data: status
    });
  })
);

/**
 * GET /stats
 * Get detailed retention statistics
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    logger.info('Fetching recording retention statistics', { user: req.user?.email });

    const stats = await recordingRetentionService.getRetentionStats();

    res.json({
      success: true,
      data: stats
    });
  })
);

/**
 * POST /run
 * Manually trigger a retention cleanup run
 */
router.post(
  '/run',
  asyncHandler(async (req, res) => {
    const batchSize = parseInt(req.body.batchSize) || 100;

    logger.info('Manually triggering recording retention cleanup', {
      user: req.user?.email,
      batchSize
    });

    const result = await recordingRetentionService.runRetentionCleanup(batchSize);

    res.json({
      success: true,
      message: `Processed ${result.processed} recordings (${result.succeeded} succeeded, ${result.failed} failed)`,
      data: result
    });
  })
);

/**
 * GET /pending
 * Get a list of recordings pending cleanup
 */
router.get(
  '/pending',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);

    logger.info('Fetching pending recordings for cleanup', {
      user: req.user?.email,
      limit
    });

    const pendingRecordings = await recordingRetentionService.getExpiredRecordings(limit);

    res.json({
      success: true,
      count: pendingRecordings.length,
      data: pendingRecordings
    });
  })
);

/**
 * POST /scheduler/restart
 * Restart the retention scheduler (reload configuration)
 */
router.post(
  '/scheduler/restart',
  asyncHandler(async (req, res) => {
    logger.info('Restarting recording retention scheduler', { user: req.user?.email });

    await recordingRetentionScheduler.restartScheduler();

    const status = await recordingRetentionScheduler.getSchedulerStatus();

    res.json({
      success: true,
      message: 'Recording retention scheduler restarted',
      data: status
    });
  })
);

/**
 * POST /scheduler/stop
 * Stop the retention scheduler
 */
router.post(
  '/scheduler/stop',
  asyncHandler(async (req, res) => {
    logger.info('Stopping recording retention scheduler', { user: req.user?.email });

    recordingRetentionScheduler.stopScheduler();

    res.json({
      success: true,
      message: 'Recording retention scheduler stopped'
    });
  })
);

/**
 * POST /scheduler/start
 * Start the retention scheduler
 */
router.post(
  '/scheduler/start',
  asyncHandler(async (req, res) => {
    logger.info('Starting recording retention scheduler', { user: req.user?.email });

    await recordingRetentionScheduler.startScheduler();

    const status = await recordingRetentionScheduler.getSchedulerStatus();

    res.json({
      success: true,
      message: 'Recording retention scheduler started',
      data: status
    });
  })
);

module.exports = router;
