import { Router } from 'express';
import { getUsers } from '../../services/usersService';

export const adminUsersRouter = Router();

adminUsersRouter.get('/', async (req, res, next) => {
  try {
    const data = await getUsers(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof Error && error.message === 'getUsers not implemented') {
      return res.status(501).json({
        success: false,
        error: 'not_implemented',
        message: 'Sync admin users endpoint is not yet implemented.',
      });
    }
    next(error);
  }
});
