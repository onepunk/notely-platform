/**
 * Validation Routes
 *
 * Public routes for license validation and public key distribution.
 * These routes are rate-limited but do not require authentication.
 */

import { Router } from 'express';
import { validationRateLimiter, heartbeatRateLimiter } from '../../middleware/rateLimiting.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validateLicense, getPublicKey, getCurrentLicense, getAllCurrentLicenses, handleHeartbeat } from '../controllers/validationController';

const router = Router();

/**
 * @route POST /api/license/validate
 * @desc Validate a license key
 * @access Public (rate-limited: 100 req/min per IP)
 */
router.post('/validate', validationRateLimiter, validateLicense);

/**
 * @route GET /api/license/public-key
 * @desc Get the public key for offline license validation
 * @access Public (rate-limited: 100 req/min per IP)
 */
router.get('/public-key', validationRateLimiter, getPublicKey);

/**
 * @route GET /api/license/current
 * @desc Get current authenticated user's license status
 * @access Authenticated users (rate-limited: 100 req/min per IP)
 */
router.get('/current', validationRateLimiter, authMiddleware, getCurrentLicense);

/**
 * @route GET /api/license/current/all
 * @desc Get all current licenses (cloud + notely-ai) for authenticated user
 * @access Authenticated users (rate-limited: 100 req/min per IP)
 */
router.get('/current/all', validationRateLimiter, authMiddleware, getAllCurrentLicenses);

/**
 * @route POST /api/license/heartbeat
 * @desc Handle client heartbeat for concurrent usage tracking
 * @access Authenticated users (rate-limited: 20 req/min per client)
 */
router.post('/heartbeat', heartbeatRateLimiter, authMiddleware, handleHeartbeat);

export default router;
