const express = require('express');
const shared = require('@notely/shared');
const accessControlService = require('../services/accessControlService');

const { isAdmin } = shared.constants.roles;
const router = express.Router();
const logger = shared.logger.child({ route: 'admin-access-control' });

function requireAdminRole(req, res, next) {
  const role = (req.userRole || '').toLowerCase();

  if (!isAdmin(role)) {
    logger.warn('Access control request rejected - insufficient role', {
      email: req.userEmail,
      role
    });

    return res.status(403).json({
      success: false,
      error: 'Admin privileges required'
    });
  }

  return next();
}

router.use(requireAdminRole);

router.get('/roles', (req, res) => {
  const roles = accessControlService.getAvailableRoles();
  res.json({ success: true, data: roles });
});

router.get('/routes', async (req, res) => {
  try {
    const routes = await accessControlService.listRoutes();
    res.json({ success: true, data: routes });
  } catch (error) {
    logger.error('Failed to fetch access control routes', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch access control routes'
    });
  }
});

router.patch('/routes/:routeId/roles', async (req, res) => {
  const routeId = Number.parseInt(req.params.routeId, 10);

  if (Number.isNaN(routeId) || routeId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'routeId must be a positive integer'
    });
  }

  const { allowedRoles } = req.body || {};

  if (!Array.isArray(allowedRoles)) {
    return res.status(400).json({
      success: false,
      error: 'allowedRoles must be an array'
    });
  }

  try {
    const result = await accessControlService.updateRouteRoles(routeId, allowedRoles, {
      changedBy: req.userId
    });

    if (!result || !result.route) {
      return res.status(404).json({
        success: false,
        error: 'Route not found'
      });
    }

    res.json({
      success: true,
      data: result.route
    });
  } catch (error) {
    if (error.code === 'INVALID_ROLES') {
      return res.status(400).json({
        success: false,
        error: error.message,
        details: error.details || {}
      });
    }

    if (error.code === 'ROUTE_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Route not found'
      });
    }

    logger.error('Failed to update access control roles', {
      error: error.message,
      routeId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update access control roles'
    });
  }
});

module.exports = router;
