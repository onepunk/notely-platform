import { Router } from 'express';
import { getCorruptionAlerts } from '../../services/corruptionService';

export const adminCorruptionRouter = Router();

adminCorruptionRouter.get('/', async (req, res, next) => {
  try {
    const data = await getCorruptionAlerts(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof Error && error.message === 'getCorruptionAlerts not implemented') {
      return res.status(501).json({
        success: false,
        error: 'not_implemented',
        message: 'Sync admin corruption endpoint is not yet implemented.',
      });
    }
    next(error);
  }
});
