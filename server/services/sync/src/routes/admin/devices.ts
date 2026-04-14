import { Router } from 'express';
import { getDevices } from '../../services/devicesService';

export const adminDevicesRouter = Router();

adminDevicesRouter.get('/', async (req, res, next) => {
  try {
    const data = await getDevices(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof Error && error.message === 'getDevices not implemented') {
      return res.status(501).json({
        success: false,
        error: 'not_implemented',
        message: 'Sync admin devices endpoint is not yet implemented.',
      });
    }
    next(error);
  }
});
