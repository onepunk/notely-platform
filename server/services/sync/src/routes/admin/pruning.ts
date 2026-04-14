/**
 * Admin routes for sync data pruning
 */

import { Router, Request, Response } from 'express';
import {
  getSchedulerStatus,
  triggerManualPruning,
  restartScheduler,
} from '../../services/syncPruningScheduler';

export const adminPruningRouter = Router();

/**
 * GET /admin/pruning/status
 * Get the current status of the sync pruning scheduler
 */
adminPruningRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await getSchedulerStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('[admin-pruning] Failed to get scheduler status', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get scheduler status',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /admin/pruning/run
 * Manually trigger a pruning run
 */
adminPruningRouter.post('/run', async (_req: Request, res: Response) => {
  try {
    const result = await triggerManualPruning();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[admin-pruning] Manual pruning failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: 'Failed to run pruning',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /admin/pruning/restart
 * Restart the pruning scheduler (reload config)
 */
adminPruningRouter.post('/restart', async (_req: Request, res: Response) => {
  try {
    await restartScheduler();
    const status = await getSchedulerStatus();
    res.json({
      success: true,
      message: 'Scheduler restarted',
      data: status,
    });
  } catch (error) {
    console.error('[admin-pruning] Failed to restart scheduler', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: 'Failed to restart scheduler',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
