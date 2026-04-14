/**
 * Analysis Service
 * Sends diagnostic bundles to the host-side analysis service for AI-powered investigation
 */

const http = require('http');
const https = require('https');
const shared = require('@notely/shared');
const logger = shared.logger;

const ANALYSIS_SERVICE_URL = process.env.ANALYSIS_SERVICE_URL;
const ANALYSIS_SERVICE_API_KEY = process.env.ANALYSIS_SERVICE_API_KEY;

// Base path for uploads inside the container
const UPLOADS_BASE_DIR = '/workspace/services/support/uploads';

/**
 * Trigger analysis of a diagnostics bundle on the host-side analyzer.
 * Fire-and-forget — does not await the response.
 */
function triggerAnalysis({ bundleId, storagePath, appVersion, platform, userEmail }) {
  if (!ANALYSIS_SERVICE_URL) {
    logger.warn('ANALYSIS_SERVICE_URL not configured — skipping analysis trigger');
    return;
  }
  if (!ANALYSIS_SERVICE_API_KEY) {
    logger.warn('ANALYSIS_SERVICE_API_KEY not configured — skipping analysis trigger');
    return;
  }

  // Derive relative path from the container-internal storage_path
  const relativePath = storagePath.replace(UPLOADS_BASE_DIR, '').replace(/^\//, '');

  const payload = JSON.stringify({
    bundleId,
    relativePath,
    appVersion: appVersion || 'unknown',
    platform: platform || 'unknown',
    userEmail: userEmail || 'unknown',
  });

  const url = new URL('/analyze', ANALYSIS_SERVICE_URL);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': `Bearer ${ANALYSIS_SERVICE_API_KEY}`,
    },
    timeout: 10000,
  };

  const req = transport.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode === 202) {
        logger.info('Analysis triggered successfully', { bundleId });
      } else {
        logger.error('Analysis service returned unexpected status', {
          bundleId,
          statusCode: res.statusCode,
          body: body.substring(0, 500),
        });
      }
    });
  });

  req.on('error', (err) => {
    logger.error('Failed to contact analysis service', {
      bundleId,
      error: err.message,
    });
  });

  req.on('timeout', () => {
    req.destroy();
    logger.error('Analysis service request timed out', { bundleId });
  });

  req.write(payload);
  req.end();
}

module.exports = { triggerAnalysis };
