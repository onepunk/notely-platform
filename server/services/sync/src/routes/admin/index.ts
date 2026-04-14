import { Router } from 'express';
import { adminStatsRouter } from './stats';
import { adminUsersRouter } from './users';
import { adminDevicesRouter } from './devices';
import { adminConflictsRouter } from './conflicts';
import { adminCorruptionRouter } from './corruption';
import { adminPruningRouter } from './pruning';

export const adminRouter = Router();

adminRouter.use('/stats', adminStatsRouter);
adminRouter.use('/users', adminUsersRouter);
adminRouter.use('/devices', adminDevicesRouter);
adminRouter.use('/conflicts', adminConflictsRouter);
adminRouter.use('/corruption', adminCorruptionRouter);
adminRouter.use('/pruning', adminPruningRouter);
