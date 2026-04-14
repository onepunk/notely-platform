/**
 * Admin Routes
 *
 * Protected routes for license management operations.
 * - Read operations (GET): Admin or Support role
 * - Write operations (POST/PUT/DELETE): Admin role only
 */

import { Router } from 'express';
import { authMiddleware, adminAuthMiddleware, adminOnlyMiddleware } from '../../middleware/auth.middleware';
import { adminRateLimiter } from '../../middleware/rateLimiting.middleware';
import {
  generateLicense,
  revokeLicense,
  getLicenseInfo,
  listLicenses,
  getLicenseDetails,
  listFeatures,
  getValidationLog,
} from '../controllers/licenseController';
import {
  adminListTiers,
  adminCreateTier,
  adminUpdateTier,
  adminSetTierFeatures,
  adminAddFeatureToTier,
  adminRemoveFeatureFromTier,
  adminUpdateFeatureImplementation,
  adminDeactivateTier,
  adminCreateFeature,
  adminUpdateFeature,
  adminDeleteFeature,
} from '../controllers/tierController';
import {
  enableBeta,
  disableBeta,
  getUserLicenseStatus,
  getUserLicenses,
  revokeAllUserLicenses,
  reissueBetaLicense,
  resetLicenseActivations,
} from '../controllers/betaController';

const router = Router();

// Apply authentication and rate limiting to all admin routes
router.use(authMiddleware);
router.use(adminRateLimiter);

// ============================================================================
// License Management Routes
// ============================================================================

/**
 * @route POST /api/license/admin/generate
 * @desc Generate a new license key
 * @access Admin only (not support)
 */
router.post('/generate', adminOnlyMiddleware, generateLicense);

/**
 * @route GET /api/license/admin/licenses
 * @desc List licenses with pagination and filtering
 * @access Admin or Support (read-only)
 */
router.get('/licenses', adminAuthMiddleware, listLicenses);

/**
 * @route GET /api/license/admin/licenses/:id
 * @desc Get detailed license information by ID
 * @access Admin or Support (read-only)
 */
router.get('/licenses/:id', adminAuthMiddleware, getLicenseDetails);

/**
 * @route POST /api/license/admin/revoke/:id
 * @desc Revoke an existing license by ID
 * @access Admin only (not support)
 */
router.post('/revoke/:id', adminOnlyMiddleware, revokeLicense);

/**
 * @route POST /api/license/admin/licenses/:id/reset-activations
 * @desc Reset all activations for a license (deactivate all, reset count to 0)
 * @access Admin only (not support)
 */
router.post('/licenses/:id/reset-activations', adminOnlyMiddleware, resetLicenseActivations);

/**
 * @route GET /api/license/admin/info/:licenseKey
 * @desc Get detailed information about a license
 * @access Admin or Support (read-only)
 */
router.get('/info/:licenseKey', adminAuthMiddleware, getLicenseInfo);

/**
 * @route GET /api/license/admin/features
 * @desc List all active feature definitions
 * @access Admin or Support (read-only)
 */
router.get('/features', adminAuthMiddleware, listFeatures);

/**
 * @route GET /api/license/admin/validations
 * @desc Get validation log with filtering and pagination
 * @access Admin or Support (read-only)
 */
router.get('/validations', adminAuthMiddleware, getValidationLog);

// ============================================================================
// Tier Management Routes
// ============================================================================

/**
 * @route GET /api/license/admin/tiers
 * @desc List all tiers (including inactive)
 * @access Admin or Support (read-only)
 */
router.get('/tiers', adminAuthMiddleware, adminListTiers);

/**
 * @route POST /api/license/admin/tiers
 * @desc Create a new tier
 * @access Admin only (not support)
 */
router.post('/tiers', adminOnlyMiddleware, adminCreateTier);

/**
 * @route PUT /api/license/admin/tiers/:id
 * @desc Update a tier's metadata
 * @access Admin only (not support)
 */
router.put('/tiers/:id', adminOnlyMiddleware, adminUpdateTier);

/**
 * @route DELETE /api/license/admin/tiers/:id
 * @desc Deactivate (soft delete) a tier
 * @access Admin only (not support)
 */
router.delete('/tiers/:id', adminOnlyMiddleware, adminDeactivateTier);

/**
 * @route PUT /api/license/admin/tiers/:id/features
 * @desc Set all features for a tier (replaces existing)
 * @access Admin only (not support)
 */
router.put('/tiers/:id/features', adminOnlyMiddleware, adminSetTierFeatures);

/**
 * @route POST /api/license/admin/tiers/:id/features/:featureKey
 * @desc Add a single feature to a tier
 * @access Admin only (not support)
 */
router.post('/tiers/:id/features/:featureKey', adminOnlyMiddleware, adminAddFeatureToTier);

/**
 * @route DELETE /api/license/admin/tiers/:id/features/:featureKey
 * @desc Remove a feature from a tier
 * @access Admin only (not support)
 */
router.delete('/tiers/:id/features/:featureKey', adminOnlyMiddleware, adminRemoveFeatureFromTier);

/**
 * @route PUT /api/license/admin/features/:featureKey/implementation
 * @desc Set the implementation status of a feature
 * @access Admin only (not support)
 */
router.put('/features/:featureKey/implementation', adminOnlyMiddleware, adminUpdateFeatureImplementation);

// ============================================================================
// Feature CRUD Routes
// ============================================================================

/**
 * @route POST /api/license/admin/features
 * @desc Create a new feature definition
 * @access Admin only (not support)
 */
router.post('/features', adminOnlyMiddleware, adminCreateFeature);

/**
 * @route PUT /api/license/admin/features/:featureKey
 * @desc Update a feature definition
 * @access Admin only (not support)
 */
router.put('/features/:featureKey', adminOnlyMiddleware, adminUpdateFeature);

/**
 * @route DELETE /api/license/admin/features/:featureKey
 * @desc Deactivate (soft delete) a feature
 * @access Admin only (not support)
 */
router.delete('/features/:featureKey', adminOnlyMiddleware, adminDeleteFeature);

// ============================================================================
// Beta Program Routes
// ============================================================================

/**
 * @route POST /api/license/admin/beta/enable
 * @desc Enable beta access for a user (grants Professional tier license)
 * @access Admin only (not support)
 */
router.post('/beta/enable', adminOnlyMiddleware, enableBeta);

/**
 * @route POST /api/license/admin/beta/disable
 * @desc Disable beta access for a user (revokes beta license)
 * @access Admin only (not support)
 */
router.post('/beta/disable', adminOnlyMiddleware, disableBeta);

/**
 * @route GET /api/license/admin/user/:userId/status
 * @desc Get license status for a user (any license type)
 * @access Admin or Support (read-only)
 */
router.get('/user/:userId/status', adminAuthMiddleware, getUserLicenseStatus);

/**
 * @route GET /api/license/admin/user/:userId/licenses
 * @desc Get ALL licenses for a user (active, revoked, expired)
 * @access Admin or Support (read-only)
 */
router.get('/user/:userId/licenses', adminAuthMiddleware, getUserLicenses);

/**
 * @route POST /api/license/admin/user/:userId/revoke-all
 * @desc Revoke all active licenses for a user
 * @access Admin only (not support)
 */
router.post('/user/:userId/revoke-all', adminOnlyMiddleware, revokeAllUserLicenses);

/**
 * @route POST /api/license/admin/user/:userId/reissue-beta
 * @desc Reissue a beta license (revokes all existing, creates fresh beta)
 * @access Admin only (not support)
 */
router.post('/user/:userId/reissue-beta', adminOnlyMiddleware, reissueBetaLicense);

export default router;
