"use strict";

const express = require('express');

const shared = require('@notely/shared');
const lokiClient = require('../services/lokiClient');
const scheduler = require('../services/logRetentionScheduler');
const configStore = require('../services/configStore');

const router = express.Router();
const logger = shared.logger.child({ module: 'logs-routes' });
const { asyncHandler, ForbiddenError } = shared.errors;

const REQUIRED_SCOPE = 'logs:read';

function hasScope(req, scope) {
  return Array.isArray(req.user?.scopes) && req.user.scopes.includes(scope);
}

function ensureLogsRead(req) {
  if (!hasScope(req, REQUIRED_SCOPE) && !['admin', 'super_admin'].includes(req.user?.role)) {
    throw new ForbiddenError('logs:read scope or admin privileges required');
  }
}

function ensureAdmin(req) {
  if (!['admin', 'super_admin'].includes(req.user?.role)) {
    throw new ForbiddenError('Admin privileges required');
  }
}

router.get(
  '/services',
  asyncHandler(async (req, res) => {
    ensureLogsRead(req);
    const services = await lokiClient.listServices();
    res.json({ success: true, data: services });
  })
);

router.get(
  '/levels',
  asyncHandler(async (req, res) => {
    ensureLogsRead(req);
    res.json({ success: true, data: lokiClient.LOG_LEVELS });
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    ensureLogsRead(req);

    const [lokiStatus, schedulerState, config] = await Promise.all([
      lokiClient.getStatus(),
      Promise.resolve(scheduler.getSchedulerState()),
      Promise.resolve(configStore.getConfig())
    ]);

    lokiStatus.retention = {
      ...config.retention,
      last_checked_at: lokiStatus.retention?.last_checked_at,
      last_check_result: lokiStatus.retention?.last_check_result,
      last_check_error: lokiStatus.retention?.last_check_error,
      compactor_note: lokiStatus.retention?.compactor_note
    };

    res.json({
      success: true,
      data: {
        loki: lokiStatus,
        scheduler: schedulerState,
        config
      }
    });
  })
);

router.get(
  '/query',
  asyncHandler(async (req, res) => {
    ensureLogsRead(req);

    const data = await lokiClient.queryLogs({
      service: req.query.service && req.query.service !== 'all' ? req.query.service : undefined,
      level: req.query.level && req.query.level !== 'all' ? req.query.level : undefined,
      search: req.query.search,
      limit: req.query.limit,
      start: req.query.start,
      end: req.query.end,
      direction: req.query.direction
    });

    res.json({ success: true, data });
  })
);

router.get(
  '/retention',
  asyncHandler(async (req, res) => {
    ensureLogsRead(req);
    res.json({
      success: true,
      data: configStore.getRetentionSettings()
    });
  })
);

router.post(
  '/cleanup',
  asyncHandler(async (req, res) => {
    ensureAdmin(req);

    const { retention_days: retentionDays, dryRun = false, service } = req.body || {};

    const result = await scheduler.runEnforcement('api-manual', {
      retentionDays,
      dryRun,
      service
    });

    res.json({ success: true, data: result });
  })
);

router.post(
  '/refresh-config',
  asyncHandler(async (req, res) => {
    ensureAdmin(req);
    await configStore.refresh();
    logger.info('Logging configuration refreshed via API');
    res.json({ success: true, data: configStore.getConfig() });
  })
);

module.exports = router;
