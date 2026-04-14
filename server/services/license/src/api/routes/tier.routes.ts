/**
 * Tier Routes (Public)
 *
 * Public endpoints for retrieving tier and feature information.
 * These endpoints do not require authentication.
 */

import { Router } from 'express';
import {
  listTiers,
  getTier,
  getTierFeatures,
} from '../controllers/tierController';

const router = Router();

/**
 * @route GET /api/license/tiers
 * @desc List all active tiers with their features
 * @access Public
 */
router.get('/', listTiers);

/**
 * @route GET /api/license/tiers/:tierKey
 * @desc Get a specific tier by key with all its features
 * @access Public
 */
router.get('/:tierKey', getTier);

/**
 * @route GET /api/license/tiers/:tierKey/features
 * @desc Get all features for a specific tier (includes inherited features)
 * @access Public
 */
router.get('/:tierKey/features', getTierFeatures);

export default router;
