import { Router } from 'express';
import { syncRouter } from './sync';
import { userStatsRouter } from './stats';

export const syncApiRouter = Router();

// Mount the unified sync endpoint at root (POST /api/sync)
// Reference: notely-platform/docs/SYNC_JOPLIN.md
syncApiRouter.use('/', syncRouter);

// Mount stats endpoint for debugging
syncApiRouter.use('/stats', userStatsRouter);
