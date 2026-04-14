const express = require('express');

const shared = require('@notely/shared');
const backupService = require('../services/backupService');

const router = express.Router();
const logger = shared.logger.child({ service: 'admin-database', scope: 'backup-routes' });
const { asyncHandler } = shared.errors;

/**
 * GET /api/admin/database/backups
 * List all available backups
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const backups = await backupService.listBackups();

    res.json({
      success: true,
      data: backups,
      count: backups.length
    });
  })
);

/**
 * POST /api/admin/database/backup
 * Create a new backup
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const options = {
      includeUserData: req.body?.includeUserData ?? true,
      includeMerkleState: req.body?.includeMerkleState ?? true,
      includeMetrics: req.body?.includeMetrics ?? false,
      compressionEnabled: req.body?.compressionEnabled ?? true,
      maxUsers: req.body?.maxUsers || null
    };

    const backup = await backupService.createBackup(options, req.user);

    res.json({
      success: true,
      data: backup
    });
  })
);

/**
 * POST /api/admin/database/restore/:backupId
 * Restore from a specific backup
 */
router.post(
  '/restore/:backupId',
  asyncHandler(async (req, res) => {
    const { backupId } = req.params;
    const options = {
      validateIntegrity: req.body?.validateIntegrity ?? true,
      skipExistingUsers: req.body?.skipExistingUsers ?? false,
      dryRun: req.body?.dryRun ?? false,
      restoreUserData: req.body?.restoreUserData ?? true,
      restoreMerkleState: req.body?.restoreMerkleState ?? true,
      restoreMetrics: req.body?.restoreMetrics ?? false
    };

    const result = await backupService.restoreFromBackup(backupId, options, req.user);

    res.json({
      success: true,
      data: result
    });
  })
);

/**
 * DELETE /api/admin/database/backups/cleanup
 * Clean up old backups
 */
router.delete(
  '/cleanup',
  asyncHandler(async (req, res) => {
    const maxAgeDays = parseInt(req.body?.maxAgeDays || req.query?.maxAgeDays || 30, 10);

    const result = await backupService.cleanupOldBackups(maxAgeDays, req.user);

    res.json({
      success: true,
      data: result
    });
  })
);

/**
 * DELETE /api/admin/database/backups/:backupId
 * Delete a specific backup and its files
 */
router.delete(
  '/:backupId',
  asyncHandler(async (req, res) => {
    const { backupId } = req.params;
    const result = await backupService.deleteBackup(backupId, req.user);

    res.json({
      success: true,
      data: result
    });
  })
);

/**
 * GET /api/admin/database/backups/:backupId
 * Get details about a specific backup
 */
router.get(
  '/:backupId',
  asyncHandler(async (req, res) => {
    const { backupId } = req.params;
    const backup = await backupService.getBackupDetails(backupId);

    res.json({
      success: true,
      data: backup
    });
  })
);

module.exports = router;
