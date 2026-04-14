const express = require('express');
const shared = require('@notely/shared');
const configModel = require('../models/configModel');

const router = express.Router();
const logger = shared.logger.child({ module: 'public-config-routes' });
const { asyncHandler } = shared.errors;

router.get(
  '/signup-policy',
  asyncHandler(async (req, res) => {
    logger.info('Fetching public signup policy');

    const generalConfig = await configModel.getGeneralConfig();

    // Fail closed - if config is missing critical fields, deny signups
    if (typeof generalConfig.signupsEnabled !== 'boolean') {
      logger.error('signupsEnabled not configured, denying signups');
      return res.json({
        signupsEnabled: false,
        requireBetaToken: true,
        requireEmailVerification: false
      });
    }

    res.json({
      signupsEnabled: generalConfig.signupsEnabled,
      requireBetaToken: generalConfig.requireBetaToken ?? true,
      requireEmailVerification: generalConfig.requireEmailVerification ?? false
    });
  })
);

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    logger.info('Fetching public notifications config');

    const notificationsConfig = await configModel.getNotificationsConfig();
    res.json({
      registration: {
        enabled: Boolean(notificationsConfig?.registration?.enabled),
        recipientEmail: notificationsConfig?.registration?.recipientEmail || ''
      }
    });
  })
);

/**
 * GET /api/public/config/security
 * Returns only the IP whitelist for admin access control
 * Used by portal-bff to check if client IP is whitelisted
 */
router.get(
  '/security',
  asyncHandler(async (req, res) => {
    logger.debug('Fetching public security config (IP whitelist only)');

    const securityConfig = await configModel.getSecurityConfig();

    // Only expose IP whitelist - other security settings are sensitive
    res.json({
      ipWhitelist: securityConfig.ipWhitelist || []
    });
  })
);

module.exports = router;
