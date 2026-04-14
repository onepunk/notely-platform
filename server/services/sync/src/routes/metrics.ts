import { Router } from 'express';
import { getMetrics } from '../services/metricsService';

export const metricsRouter = Router();

metricsRouter.get('/', async (_req, res, next) => {
  try {
    const data = await getMetrics();
    res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof Error && error.message === 'getMetrics not implemented') {
      return res.status(501).json({
        success: false,
        error: 'not_implemented',
        message: 'Sync metrics endpoint is not yet implemented.',
      });
    }
    next(error);
  }
});
