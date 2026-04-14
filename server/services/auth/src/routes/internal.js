const express = require('express');
const router = express.Router();

const shared = require('@notely/shared');
const logger = shared.logger;
const apiKeyModel = require('../models/apiKeyModel');
const aclModel = require('../models/aclModel');
const authModel = require('../models/authModel');
const authService = require('../services/authService');
const eventPublisher = require('../services/eventPublisher');
const requireServiceAuth = require('../middleware/serviceAuth');

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function presentApiKey(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    serviceName: record.service_name,
    isService: record.is_service,
    isActive: record.is_active,
    scopes: record.scopes || [],
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at
  };
}

router.post('/service-tokens', async (req, res, next) => {
  try {
    const serviceName = req.header('x-service-name');
    const apiKey = req.header('x-service-key');

    if (!serviceName || !apiKey) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing X-Service-Name or X-Service-Key header'
      });
    }

    const verification = await apiKeyModel.verifyServiceApiKey(serviceName, apiKey);

    if (!verification.valid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Service API key invalid'
      });
    }

    const requestedScopes = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
    const tokenResult = await authService.generateServiceToken(
      serviceName,
      verification.scopes,
      requestedScopes
    );

    res.json(tokenResult);
  } catch (error) {
    logger.error('Failed to mint service token', {
      error: error.message,
      serviceName: req.header('x-service-name')
    });

    next(error);
  }
});

router.post('/tokens/introspect', requireServiceAuth(['auth:introspect']), async (req, res, next) => {
  try {
    const { token } = req.body || {};

    if (!token) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Token is required'
      });
    }

    const introspection = await authService.introspectToken(token);
    res.json(introspection);
  } catch (error) {
    next(error);
  }
});

router.get('/api-keys', requireServiceAuth(['auth:service-tokens']), async (req, res, next) => {
  try {
    const keys = await apiKeyModel.listApiKeys();
    res.json({ keys: keys.map(presentApiKey) });
  } catch (error) {
    next(error);
  }
});

router.get('/api-keys/:serviceName', requireServiceAuth(['auth:service-tokens']), async (req, res, next) => {
  try {
    const key = await apiKeyModel.getApiKeyByService(req.params.serviceName);

    if (!key) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'API key not found'
      });
    }

    res.json({ key: presentApiKey(key) });
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/verify', requireServiceAuth(['auth:api-keys:verify']), async (req, res, next) => {
  try {
    const { apiKey } = req.body || {};

    if (!apiKey) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'apiKey is required'
      });
    }

    const verification = await apiKeyModel.verifyClientApiKey(apiKey);

    if (!verification.valid) {
      return res.json({
        valid: false,
        reason: verification.reason || 'unknown'
      });
    }

    res.json({
      valid: true,
      key: {
        id: verification.id,
        name: verification.name,
        scopes: verification.scopes || []
      }
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// ACL (Access Control List) Endpoints
// ===========================================================================

/**
 * POST /internal/acl/check
 * Check if user roles have access to a route
 */
router.post('/acl/check', requireServiceAuth(['auth:acl:check']), async (req, res, next) => {
  try {
    const { userRoles, routePattern, httpMethod, serviceName } = req.body || {};

    if (!userRoles || !Array.isArray(userRoles)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'userRoles array is required'
      });
    }

    if (!routePattern) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'routePattern is required'
      });
    }

    const result = await aclModel.checkAccess(
      userRoles,
      routePattern,
      httpMethod || 'GET',
      serviceName || 'portal'
    );

    res.json(result);
  } catch (error) {
    logger.error('ACL check failed', {
      error: error.message,
      body: req.body
    });
    next(error);
  }
});

/**
 * GET /internal/acl/routes
 * Get routes accessible by a role
 */
router.get('/acl/routes', requireServiceAuth(['auth:acl:read']), async (req, res, next) => {
  try {
    const { role, serviceName } = req.query;

    if (role) {
      // Get routes for a specific role
      const routes = await aclModel.getRoutesByRole(role, serviceName || null);
      return res.json({ routes });
    }

    // Get all routes with role assignments
    const routes = await aclModel.getAllRoutes(serviceName || null);
    res.json({ routes });
  } catch (error) {
    logger.error('Failed to get ACL routes', {
      error: error.message,
      query: req.query
    });
    next(error);
  }
});

/**
 * POST /internal/acl/routes
 * Create or update route permissions (admin only)
 */
router.post('/acl/routes', requireServiceAuth(['auth:acl:write']), async (req, res, next) => {
  try {
    const {
      routeKey,
      pathPattern,
      httpMethod,
      description,
      serviceName,
      allowedRoles
    } = req.body || {};

    if (!routeKey || !pathPattern) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'routeKey and pathPattern are required'
      });
    }

    const changedBy = req.serviceAuth?.userId || null;

    const route = await aclModel.createRoute({
      routeKey,
      pathPattern,
      httpMethod: httpMethod || 'GET',
      description,
      serviceName: serviceName || 'portal',
      allowedRoles: allowedRoles || []
    }, changedBy);

    res.status(201).json({ route });
  } catch (error) {
    logger.error('Failed to create ACL route', {
      error: error.message,
      body: req.body
    });

    // Handle unique constraint violations
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Route already exists'
      });
    }

    next(error);
  }
});

/**
 * PATCH /internal/acl/routes/:routeId/roles
 * Update role assignments for a route
 */
router.patch('/acl/routes/:routeId/roles', requireServiceAuth(['auth:acl:write']), async (req, res, next) => {
  try {
    const { routeId } = req.params;
    const { roles } = req.body || {};

    if (!roles || !Array.isArray(roles)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'roles array is required'
      });
    }

    const changedBy = req.serviceAuth?.userId || null;
    const route = await aclModel.updateRouteRoles(
      parseInt(routeId, 10),
      roles,
      changedBy
    );

    res.json({ route });
  } catch (error) {
    logger.error('Failed to update route roles', {
      error: error.message,
      routeId: req.params.routeId,
      body: req.body
    });

    if (error.message === 'Route not found') {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message
      });
    }

    next(error);
  }
});

// ===========================================================================
// Admin User Creation (Internal Service-to-Service)
// ===========================================================================

/**
 * POST /internal/admin-create-user
 * Create a user account on behalf of an admin (used by the support service
 * during beta signup conversion). Protected by x-internal-service header.
 */
router.post('/admin-create-user', async (req, res, next) => {
  try {
    const internalService = req.headers['x-internal-service'];
    if (!internalService) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This endpoint is for internal service use only'
      });
    }

    const { email, firstName, lastName } = req.body || {};

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'A valid email address is required'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existing = await authModel.getUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A user with this email already exists',
        user: {
          id: existing.id,
          email: existing.email,
          firstName: existing.first_name,
          lastName: existing.last_name
        }
      });
    }

    // Create user with external credential (random password hash, email pre-verified)
    const createdUser = await authModel.createExternalUserCredential({
      email: normalizedEmail,
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      role: 'user',
      emailVerified: true
    });

    logger.info('Admin-created user account', {
      authUserId: createdUser.id,
      email: createdUser.email,
      createdBy: internalService
    });

    // Publish user.registered event so the users service creates a profile
    await eventPublisher.publishUserRegistered({
      authUserId: createdUser.id,
      email: createdUser.email,
      firstName: createdUser.first_name,
      lastName: createdUser.last_name,
      role: createdUser.role,
      createdAt: createdUser.created_at
    });

    res.status(201).json({
      success: true,
      user: {
        id: createdUser.id,
        email: createdUser.email,
        firstName: createdUser.first_name,
        lastName: createdUser.last_name
      }
    });
  } catch (error) {
    logger.error('Failed to create admin user', {
      error: error.message,
      email: req.body?.email
    });
    next(error);
  }
});

module.exports = router;
