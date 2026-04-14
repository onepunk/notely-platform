import { Router } from 'express';
import { getStats } from '../../services/statsService';

export const adminStatsRouter = Router();

adminStatsRouter.get('/', async (_req, res, next) => {
  try {
    const data = await getStats();
    res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof Error && error.message === 'getStats not implemented') {
      return res.status(501).json({
        success: false,
        error: 'not_implemented',
        message: 'Sync admin statistics endpoint is not yet implemented.',
      });
    }
    next(error);
  }
});
