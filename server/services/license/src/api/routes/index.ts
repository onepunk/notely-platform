/**
 * Route aggregator
 *
 * Combines all route modules into a single router.
 * This provides a central place to mount all API routes.
 */

import { Router } from 'express';
import validationRoutes from './validation.routes';
import adminRoutes from './admin.routes';
import tierRoutes from './tier.routes';
import activationRoutes from './activation.routes';

const router = Router();

/**
 * Mount all route modules
 *
 * Route structure:
 * - /health - Health check endpoint (root level in app.ts, no auth)
 * - /ready - Readiness check endpoint (root level in app.ts, no auth)
 * - /api/license - Public validation endpoints (rate-limited, no auth for validate/public-key)
 * - /api/license/admin - Admin management endpoints (auth + admin role required)
 * - /api/license/tiers - Public tier and feature listing
 * - /api/license/ (activation) - License activation endpoints
 */

// Validation and public routes
// Note: Some routes require auth (current, heartbeat), applied in route file
router.use('/', validationRoutes);

// Admin routes (authentication and admin role required)
router.use('/admin', adminRoutes);

// Tier routes (public - for listing tiers and features)
router.use('/tiers', tierRoutes);

// Activation routes (license activation with email binding for na- licenses)
router.use('/', activationRoutes);

export default router;
