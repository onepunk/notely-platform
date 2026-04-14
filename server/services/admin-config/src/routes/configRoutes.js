const express = require('express');
const shared = require('@notely/shared');
const configModel = require('../models/configModel');
const configEvents = require('../events/configPublisher');
const nginxRoutes = require('./nginxRoutes');

const router = express.Router();
const logger = shared.logger.child({ module: 'admin-config-routes' });
const { asyncHandler } = shared.errors;

function eventContext(req) {
  return {
    actor: req.user
      ? {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role
        }
      : null,
    requestId: req.requestId
  };
}

router.get(
  '/general',
  asyncHandler(async (req, res) => {
    logger.info('Fetching general config', { user: req.user?.email });
    const config = await configModel.getGeneralConfig();
    res.json(config);
  })
);

router.post(
  '/general',
  asyncHandler(async (req, res) => {
    logger.info('Updating general config', { user: req.user?.email });
    const updated = await configModel.updateGeneralConfig(req.body || {});
    await configEvents.publishConfigUpdated('general', updated, eventContext(req));
    res.json(updated);
  })
);

router.get(
  '/security',
  asyncHandler(async (req, res) => {
    logger.info('Fetching security config', { user: req.user?.email });
    const config = await configModel.getSecurityConfig();
    res.json({
      config,
      certificates: [] // Placeholder until certificate store is integrated
    });
  })
);

router.post(
  '/security',
  asyncHandler(async (req, res) => {
    logger.info('Updating security config', { user: req.user?.email });

    const payload = req.body || {};

    // Safeguard: Prevent disabling local login unless there's at least one OAuth admin user
    if (payload.localLoginEnabled === false) {
      const oauthAdminCount = await configModel.countOAuthAdminUsers();
      if (oauthAdminCount === 0) {
        logger.warn('Attempted to disable local login without OAuth admin users', {
          user: req.user?.email,
          oauthAdminCount
        });
        return res.status(400).json({
          error: 'Cannot disable local login',
          message: 'You must grant admin permissions to at least one user who has logged in via Microsoft OAuth before disabling local login. This prevents lockout.',
          code: 'NO_OAUTH_ADMIN'
        });
      }
    }

    const updatedConfig = await configModel.updateSecurityConfig(payload);
    await configEvents.publishConfigUpdated('security', updatedConfig, eventContext(req));

    res.json({
      config: updatedConfig,
      certificates: []
    });
  })
);

// Check if there are OAuth admin users (used by frontend to conditionally enable the toggle)
router.get(
  '/security/oauth-admin-count',
  asyncHandler(async (req, res) => {
    logger.info('Checking OAuth admin count', { user: req.user?.email });
    const count = await configModel.countOAuthAdminUsers();
    res.json({ count });
  })
);

router.get(
  '/ai',
  asyncHandler(async (req, res) => {
    logger.info('Fetching AI config', { user: req.user?.email });
    const config = await configModel.getAiConfig();
    res.json({ config });
  })
);

router.post(
  '/ai',
  asyncHandler(async (req, res) => {
    logger.info('Updating AI config', { user: req.user?.email });
    const updated = await configModel.updateAiConfig(req.body || {});
    await configEvents.publishConfigUpdated('ai', updated, eventContext(req));
    res.json({ config: updated });
  })
);

router.get(
  '/teams',
  asyncHandler(async (req, res) => {
    logger.info('Fetching Teams config', { user: req.user?.email });
    const config = await configModel.getTeamsConfig();
    res.json({ config });
  })
);

router.post(
  '/teams',
  asyncHandler(async (req, res) => {
    logger.info('Updating Teams config', { user: req.user?.email });
    const updated = await configModel.updateTeamsConfig(req.body || {});
    await configEvents.publishConfigUpdated('teams', updated, eventContext(req));
    res.json({ config: updated });
  })
);

router.get(
  '/sync',
  asyncHandler(async (req, res) => {
    logger.info('Fetching sync config', { user: req.user?.email });
    const config = await configModel.getSyncConfig();
    res.json({ success: true, data: config });
  })
);

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    logger.info('Replacing sync config', { user: req.user?.email });
    const updated = await configModel.replaceSyncConfig(req.body || []);
    await configEvents.publishConfigUpdated('sync', updated, eventContext(req));
    res.json({ success: true, data: updated });
  })
);

router.post(
  '/sync/bulk-update',
  asyncHandler(async (req, res) => {
    logger.info('Bulk updating sync config', { user: req.user?.email });
    const { updates } = req.body || {};
    const results = await configModel.bulkUpdateSyncConfig(updates || []);
    await configEvents.publishConfigUpdated('sync', results.items, eventContext(req));
    res.json({
      success: results.failed === 0,
      data: results
    });
  })
);

router.get(
  '/logging',
  asyncHandler(async (req, res) => {
    logger.info('Fetching logging config', { user: req.user?.email });
    const config = await configModel.getLoggingConfig();
    res.json({ config });
  })
);

router.post(
  '/logging',
  asyncHandler(async (req, res) => {
    logger.info('Updating logging config', { user: req.user?.email });
    const payload = req.body || {};

    // If retention configuration is being updated, sync with docker-manager first
    if (payload.retention && payload.retention.retention_days !== undefined) {
      const dockerManagerUrl = process.env.DOCKER_MANAGER_SERVICE_URL || 'http://docker-manager:8005';
      const retentionDays = payload.retention.retention_days;

      logger.info('Syncing Loki retention with docker-manager', {
        retention_days: retentionDays,
        docker_manager_url: dockerManagerUrl
      });

      try {
        // Create HTTP client for docker-manager
        const dockerManagerClient = shared.httpClient.createClient({
          baseURL: dockerManagerUrl,
          timeout: 10000
        });

        // Call docker-manager API to update Loki retention
        const response = await dockerManagerClient.post(
          '/api/admin/docker/config/loki/retention',
          { retention_days: retentionDays },
          {
            headers: {
              'x-auth-type': req.headers['x-auth-type'],
              'x-auth-email': req.headers['x-auth-email'],
              'x-auth-role': req.headers['x-auth-role'],
              'x-auth-subject': req.headers['x-auth-subject']
            }
          }
        );

        // Check if docker-manager call was successful
        if (response.status !== 200) {
          const errorMessage = response.data?.error || 'Failed to update Loki retention';
          logger.error('Docker-manager rejected retention update', {
            status: response.status,
            error: errorMessage,
            retention_days: retentionDays
          });
          return res.status(response.status).json({
            error: errorMessage,
            details: response.data
          });
        }

        logger.info('Loki retention updated successfully via docker-manager', {
          retention_days: retentionDays
        });
      } catch (error) {
        logger.error('Failed to sync retention with docker-manager', {
          error: error.message,
          retention_days: retentionDays,
          docker_manager_url: dockerManagerUrl
        });

        // Return error to client - do not proceed with database update
        return res.status(500).json({
          error: 'Failed to update Loki retention configuration',
          message: error.message,
          details: error.response?.data || null
        });
      }
    }

    // Only update database after successful docker-manager sync
    const updated = await configModel.updateLoggingConfig(payload);
    await configEvents.publishConfigUpdated('logging', updated, eventContext(req));
    res.json({ config: updated });
  })
);

router.get(
  '/backup',
  asyncHandler(async (req, res) => {
    logger.info('Fetching backup config', { user: req.user?.email });
    const config = await configModel.getBackupConfig();
    res.json({ config });
  })
);

router.post(
  '/backup',
  asyncHandler(async (req, res) => {
    logger.info('Updating backup config', { user: req.user?.email });
    const updated = await configModel.updateBackupConfig(req.body || {});
    await configEvents.publishConfigUpdated('backup', updated, eventContext(req));
    res.json({ config: updated });
  })
);

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    logger.info('Fetching notifications config', { user: req.user?.email });
    const config = await configModel.getNotificationsConfig();
    res.json({ config });
  })
);

router.post(
  '/notifications',
  asyncHandler(async (req, res) => {
    logger.info('Updating notifications config', { user: req.user?.email });
    const updated = await configModel.updateNotificationsConfig(req.body || {});
    await configEvents.publishConfigUpdated('notifications', updated, eventContext(req));
    res.json({ config: updated });
  })
);

router.get(
  '/recording-quotas',
  asyncHandler(async (req, res) => {
    logger.info('Fetching recording quotas config', { user: req.user?.email });
    const config = await configModel.getRecordingQuotasConfig();
    res.json({ config });
  })
);

router.post(
  '/recording-quotas',
  asyncHandler(async (req, res) => {
    logger.info('Updating recording quotas config', { user: req.user?.email });
    const updated = await configModel.updateRecordingQuotasConfig(req.body || {});
    await configEvents.publishConfigUpdated('recording_quotas', updated, eventContext(req));
    res.json({ config: updated });
  })
);

router.get(
  '/body-size-limit',
  asyncHandler(async (req, res) => {
    logger.info('Fetching body size limit config', { user: req.user?.email });
    const config = await configModel.getBodySizeLimitConfig();
    res.json({ config });
  })
);

router.post(
  '/body-size-limit',
  asyncHandler(async (req, res) => {
    logger.info('Updating body size limit config', { user: req.user?.email });
    const updated = await configModel.updateBodySizeLimitConfig(req.body || {});
    await configEvents.publishConfigUpdated('body_size_limit', updated, eventContext(req));
    res.json({ config: updated });
  })
);

router.get(
  '/rate-limit',
  asyncHandler(async (req, res) => {
    logger.info('Fetching rate limit config', { user: req.user?.email });
    const config = await configModel.getRateLimitConfig();
    res.json({ config });
  })
);

router.post(
  '/rate-limit',
  asyncHandler(async (req, res) => {
    logger.info('Updating rate limit config', { user: req.user?.email });
    const updated = await configModel.updateRateLimitConfig(req.body || {});
    await configEvents.publishConfigUpdated('rate_limit', updated, eventContext(req));
    res.json({ config: updated });
  })
);

// Mount nginx routes under /security/
router.use('/security', nginxRoutes);

module.exports = router;
