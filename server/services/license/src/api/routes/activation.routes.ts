/**
 * Activation Routes
 *
 * Public routes for license activation, revalidation, and deactivation.
 * These routes are rate-limited but do not require authentication.
 * Used by Notely AI (na-) licenses for email-bound activation.
 */

import { Router } from 'express';
import { validationRateLimiter } from '../../middleware/rateLimiting.middleware';
import {
  handleActivate,
  handleRevalidate,
  handleDeactivate,
} from '../controllers/activationController';

const router = Router();

/**
 * @route POST /api/license/activate
 * @desc Activate a license with email binding
 * @access Public (rate-limited: 100 req/min per IP)
 */
router.post('/activate', validationRateLimiter, handleActivate);

/**
 * @route POST /api/license/revalidate
 * @desc Revalidate an existing activation (periodic online check)
 * @access Public (rate-limited: 100 req/min per IP)
 */
router.post('/revalidate', validationRateLimiter, handleRevalidate);

/**
 * @route POST /api/license/deactivate
 * @desc Deactivate a license activation to free up a slot
 * @access Public (rate-limited: 100 req/min per IP)
 */
router.post('/deactivate', validationRateLimiter, handleDeactivate);

export default router;
