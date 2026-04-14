const express = require('express');

const shared = require('@notely/shared');
const databaseService = require('../services/databaseAdminService');

const router = express.Router();
const logger = shared.logger.child({ service: 'admin-database', scope: 'routes' });
const { asyncHandler } = shared.errors;

router.get(
  '/tables',
  asyncHandler(async (req, res) => {
    const { database } = req.query;
    const tables = await databaseService.listTables({ database });

    res.json({
      success: true,
      data: tables
    });
  })
);

router.get(
  '/tables/:tableName/records',
  asyncHandler(async (req, res) => {
    const { tableName } = req.params;
    const { database, page, limit } = req.query;

    const payload = await databaseService.getTableRecords({
      tableName: decodeURIComponent(tableName),
      page,
      limit,
      database
    });

    res.json({
      success: true,
      data: payload
    });
  })
);

router.patch(
  '/tables/:tableName/records/:recordId',
  asyncHandler(async (req, res) => {
    const { tableName, recordId } = req.params;
    const { database } = req.query;

    const result = await databaseService.updateRecord({
      tableName: decodeURIComponent(tableName),
      recordId: decodeURIComponent(recordId),
      values: req.body?.values ?? req.body ?? {},
      database,
      actor: req.user
    });

    res.json({
      success: true,
      data: result.record
    });
  })
);

router.delete(
  '/tables/:tableName/records/:recordId',
  asyncHandler(async (req, res) => {
    const { tableName, recordId } = req.params;
    const { database } = req.query;

    const result = await databaseService.deleteRecord({
      tableName: decodeURIComponent(tableName),
      recordId: decodeURIComponent(recordId),
      database,
      actor: req.user
    });

    res.json({
      success: true,
      data: result
    });
  })
);

router.delete(
  '/tables/:tableName/records',
  asyncHandler(async (req, res) => {
    const { tableName } = req.params;
    const { database, scope } = req.query;

    if (scope !== 'all') {
      return res.status(400).json({
        success: false,
        error: 'invalid_scope',
        message: 'Bulk deletion requires scope=all confirmation.'
      });
    }

    logger.warn('Bulk delete requested', {
      tableName,
      database: database || null,
      actor: req.user?.email || null
    });

    const result = await databaseService.deleteAllRecords({
      tableName: decodeURIComponent(tableName),
      database,
      actor: req.user
    });

    res.json({
      success: true,
      data: result
    });
  })
);

module.exports = router;
