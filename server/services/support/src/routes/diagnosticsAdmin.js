/**
 * Admin diagnostics routes
 * Handles viewing, downloading, and reviewing diagnostics bundles
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const shared = require('@notely/shared');
const logger = shared.logger;
const db = shared.database;
const { triggerAnalysis } = require('../services/analysisService');

/**
 * Extract user info from gateway-injected headers
 */
function getUserFromHeaders(req) {
  return {
    userId: req.headers['x-auth-subject'],
    email: req.headers['x-auth-email'],
    role: req.headers['x-auth-role'],
  };
}

/**
 * Check if user has admin or support role
 */
function requireAdminOrSupport(req, res, next) {
  const { userId, role } = getUserFromHeaders(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }
  if (!['admin', 'super_admin', 'support'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }
  next();
}

/**
 * GET /api/support/admin/diagnostics
 * List all diagnostics bundles with optional status filter
 */
router.get('/', requireAdminOrSupport, async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const sanitizedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const sanitizedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    let query = `
      SELECT id, user_id, user_email, filename, size_bytes, app_version, platform,
             os_version, arch, cpu_model, cpu_cores, total_memory_gb, gpu_name,
             status, scan_result, scan_details, admin_notes, created_at, reviewed_at, reviewed_by,
             analysis_status, analysis_started_at, analysis_completed_at
      FROM support.diagnostics_bundles
    `;
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(sanitizedLimit, sanitizedOffset);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM support.diagnostics_bundles';
    const countParams = [];
    if (status) {
      countQuery += ' WHERE status = $1';
      countParams.push(status);
    }
    const countResult = await db.query(countQuery, countParams);

    res.json({
      bundles: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
    });
  } catch (error) {
    logger.error('Failed to list admin diagnostics bundles', { error: error.message });
    next(error);
  }
});

/**
 * GET /api/support/admin/diagnostics/:id
 * Get bundle details
 */
router.get('/:id', requireAdminOrSupport, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, user_id, user_email, filename, storage_path, size_bytes, app_version, platform,
              os_version, arch, cpu_model, cpu_cores, total_memory_gb, gpu_name,
              status, scan_result, scan_details, admin_notes, created_at, reviewed_at, reviewed_by,
              analysis_status, analysis_result, analysis_error, analysis_started_at,
              analysis_completed_at, analysis_requested_by
       FROM support.diagnostics_bundles
       WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Failed to get diagnostics bundle', { error: error.message, id: req.params.id });
    next(error);
  }
});

/**
 * POST /api/support/admin/diagnostics/:id/analyze
 * Trigger AI analysis of a diagnostics bundle
 */
router.post('/:id/analyze', requireAdminOrSupport, async (req, res, next) => {
  const { userId } = getUserFromHeaders(req);

  try {
    const result = await db.query(
      `SELECT id, storage_path, scan_result, analysis_status, app_version, platform, user_email
       FROM support.diagnostics_bundles
       WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const bundle = result.rows[0];

    if (bundle.scan_result !== 'clean') {
      return res.status(400).json({
        error: 'Bundle not eligible for analysis',
        message: 'Only bundles that passed AV scan can be analyzed',
      });
    }

    if (bundle.analysis_status === 'in_progress') {
      return res.status(409).json({
        error: 'Analysis already in progress',
        message: 'Wait for the current analysis to complete before re-analyzing',
      });
    }

    // Mark as in_progress
    await db.query(
      `UPDATE support.diagnostics_bundles
       SET analysis_status = 'in_progress',
           analysis_started_at = NOW(),
           analysis_requested_by = $1,
           analysis_result = NULL,
           analysis_error = NULL,
           analysis_completed_at = NULL
       WHERE id = $2`,
      [userId, req.params.id]
    );

    // Fire-and-forget trigger to host-side analyzer
    triggerAnalysis({
      bundleId: bundle.id,
      storagePath: bundle.storage_path,
      appVersion: bundle.app_version,
      platform: bundle.platform,
      userEmail: bundle.user_email,
    });

    logger.info('Analysis triggered for diagnostics bundle', {
      bundleId: req.params.id,
      requestedBy: userId,
    });

    res.status(202).json({ status: 'in_progress', bundleId: req.params.id });
  } catch (error) {
    logger.error('Failed to trigger analysis', {
      error: error.message,
      id: req.params.id,
    });
    next(error);
  }
});

/**
 * GET /api/support/admin/diagnostics/:id/download
 * Download a diagnostics bundle
 */
router.get('/:id/download', requireAdminOrSupport, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT storage_path, filename FROM support.diagnostics_bundles WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { storage_path, filename } = result.rows[0];

    if (!fs.existsSync(storage_path)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.download(storage_path, filename);
  } catch (error) {
    logger.error('Failed to download diagnostics bundle', {
      error: error.message,
      id: req.params.id,
    });
    next(error);
  }
});

/**
 * PATCH /api/support/admin/diagnostics/:id
 * Update bundle status and admin notes
 */
router.patch('/:id', requireAdminOrSupport, async (req, res, next) => {
  const { userId } = getUserFromHeaders(req);

  try {
    const { status, admin_notes } = req.body;

    const validStatuses = ['pending_review', 'reviewed', 'dismissed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: `Status must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
      if (status === 'reviewed' || status === 'dismissed') {
        updates.push(`reviewed_at = NOW()`);
        updates.push(`reviewed_by = $${paramIndex++}`);
        params.push(userId);
      }
    }

    if (admin_notes !== undefined) {
      updates.push(`admin_notes = $${paramIndex++}`);
      params.push(admin_notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(req.params.id);
    const result = await db.query(
      `UPDATE support.diagnostics_bundles
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, status, admin_notes, reviewed_at, reviewed_by`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    logger.info('Diagnostics bundle updated', { id: req.params.id, status, adminUserId: userId });

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Failed to update diagnostics bundle', {
      error: error.message,
      id: req.params.id,
    });
    next(error);
  }
});

/**
 * DELETE /api/support/admin/diagnostics/:id
 * Delete a diagnostics bundle (removes file from disk and DB record)
 */
router.delete('/:id', requireAdminOrSupport, async (req, res, next) => {
  const { userId } = getUserFromHeaders(req);

  try {
    // Get storage path before deleting
    const result = await db.query(
      'SELECT storage_path, filename FROM support.diagnostics_bundles WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { storage_path, filename } = result.rows[0];

    // Delete the DB record
    await db.query('DELETE FROM support.diagnostics_bundles WHERE id = $1', [req.params.id]);

    // Delete the file from disk if it exists
    if (storage_path && fs.existsSync(storage_path)) {
      fs.unlinkSync(storage_path);
    }

    logger.info('Diagnostics bundle deleted', {
      id: req.params.id,
      filename,
      adminUserId: userId,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete diagnostics bundle', {
      error: error.message,
      id: req.params.id,
    });
    next(error);
  }
});

module.exports = router;
