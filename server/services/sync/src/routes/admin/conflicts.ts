import { Router } from 'express';
import { getConflicts } from '../../services/conflictsService';

export const adminConflictsRouter = Router();

adminConflictsRouter.get('/', async (req, res, next) => {
  try {
    const data = await getConflicts(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof Error && error.message === 'getConflicts not implemented') {
      return res.status(501).json({
        success: false,
        error: 'not_implemented',
        message: 'Sync admin conflicts endpoint is not yet implemented.',
      });
    }
    next(error);
  }
});
