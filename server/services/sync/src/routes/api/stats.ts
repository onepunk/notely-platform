import { Router, Request, Response } from 'express';
import { getUserEntityCounts } from '../../services/statsService';

export const userStatsRouter = Router();

/**
 * GET /api/sync/stats
 *
 * Returns the authenticated user's entity counts.
 * Used by desktop client to show merge prompt when switching servers.
 */
userStatsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).authContext?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated',
      });
    }

    const counts = await getUserEntityCounts(userId);

    res.status(200).json({
      success: true,
      data: counts,
    });
  } catch (error: any) {
    console.error('Error fetching user entity counts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch entity counts',
      message: error.message,
    });
  }
});
