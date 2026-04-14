require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const shared = require('@notely/shared');
const configRoutes = require('./src/routes/configRoutes');
const publicConfigRoutes = require('./src/routes/publicConfigRoutes');
const configModel = require('./src/models/configModel');
const configEvents = require('./src/events/configPublisher');

const SERVICE_NAME = process.env.SERVICE_NAME || 'admin-config';
const PORT = process.env.ADMIN_CONFIG_PORT || 3206;

const logger = shared.logger.child({ service: SERVICE_NAME });
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const { DEFAULT_LIMITS } = shared.middleware.bodySizeLimit;
const { errorHandler } = shared.errors;
const db = shared.database;

const app = express();

// Middleware
app.use(helmet());
// CORS is handled by nginx at the edge layer - no application-level CORS needed
// Body size limit to prevent DoS attacks - uses default from shared middleware
// Admin-config can't fetch from itself, so it uses the built-in default
app.use(express.json({ limit: `${DEFAULT_LIMITS.adminConfig}kb` }));
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

// Security middleware
securityMiddleware.createSecurityStack().forEach((middlewareFn) => {
  app.use(middlewareFn);
});

// Auth middleware - trusts gateway auth headers
const authenticate = (req, res, next) => {
  const authType = req.headers['x-auth-type'];
  const authEmail = req.headers['x-auth-email'];
  const authRole = req.headers['x-auth-role'];
  const authSubject = req.headers['x-auth-subject'];
  const internalService = req.headers['x-internal-service'];

  // Allow internal service calls for specific read-only endpoints
  if (internalService && req.method === 'GET') {
    const allowedInternalPaths = ['/rate-limit', '/body-size-limit'];
    if (allowedInternalPaths.some(path => req.path === path || req.path.startsWith(path))) {
      logger.debug('Internal service request allowed', { service: internalService, path: req.path });
      req.user = { id: 'internal', email: `${internalService}@internal`, role: 'service', is_admin: false };
      return next();
    }
  }

  if (!authType || !authEmail || !authRole) {
    logger.warn('Request missing gateway auth headers');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Only admins can access config endpoints
  if (!['admin', 'super_admin'].includes(authRole)) {
    logger.warn('Non-admin user attempted access', { email: authEmail, role: authRole });
    return res.status(403).json({ error: 'Admin privileges required' });
  }

  req.user = {
    id: authSubject,
    email: authEmail,
    role: authRole,
    is_admin: true
  };

  next();
};

// Health check
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();
    const isHealthy = dbHealth.status === 'healthy';

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      dependencies: {
        database: dbHealth.status
      }
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: SERVICE_NAME,
      error: error.message
    });
  }
});

// Routes
app.use('/api/public/config', publicConfigRoutes);
app.use('/api/admin/config', authenticate, configRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handler
app.use(errorHandler);

let server;

async function initialize() {
  try {
    logger.info('Initializing admin-config service...');
    await db.initialize(logger);
    logger.info('Database connection ready');

    await configModel.ensureDefaultConfigs();
    logger.info('Default admin configuration ensured');

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`${SERVICE_NAME} service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize admin-config service', { error: error.message });
    process.exit(1);
  }
}

initialize();

// Graceful shutdown
const shutdown = async () => {
  logger.info(`${SERVICE_NAME} service shutting down`);

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    await configEvents.shutdown();
    await db.close();
    logger.info(`${SERVICE_NAME} service shut down gracefully`);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
