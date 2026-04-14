/**
 * Internal analysis callback route
 * Receives results from the host-side diagnostics analyzer service
 */

const express = require('express');
const router = express.Router();
const shared = require('@notely/shared');
const logger = shared.logger;
const db = shared.database;

const ANALYSIS_SERVICE_API_KEY = process.env.ANALYSIS_SERVICE_API_KEY;

/**
 * Validate the shared API key from the analyzer service
 */
function requireAnalysisApiKey(req, res, next) {
  if (!ANALYSIS_SERVICE_API_KEY) {
    return res.status(503).json({ error: 'Analysis callback not configured' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  if (token !== ANALYSIS_SERVICE_API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * POST /internal/analysis-callback/:id
 * Receives analysis results from the host-side analyzer
 */
router.post('/:id', requireAnalysisApiKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, result, error: analysisError } = req.body;

    if (!status || !['completed', 'failed'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'Status must be "completed" or "failed"',
      });
    }

    // Verify bundle exists
    const bundleCheck = await db.query(
      'SELECT id FROM support.diagnostics_bundles WHERE id = $1',
      [id]
    );
    if (bundleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    if (status === 'completed') {
      await db.query(
        `UPDATE support.diagnostics_bundles
         SET analysis_status = 'completed',
             analysis_result = $1,
             analysis_completed_at = NOW()
         WHERE id = $2`,
        [result || '', id]
      );
      logger.info('Analysis completed for bundle', { bundleId: id });
    } else {
      await db.query(
        `UPDATE support.diagnostics_bundles
         SET analysis_status = 'failed',
             analysis_error = $1,
             analysis_completed_at = NOW()
         WHERE id = $2`,
        [analysisError || 'Unknown error', id]
      );
      logger.warn('Analysis failed for bundle', { bundleId: id, error: analysisError });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to process analysis callback', {
      error: err.message,
      bundleId: req.params.id,
    });
    next(err);
  }
});

module.exports = router;
