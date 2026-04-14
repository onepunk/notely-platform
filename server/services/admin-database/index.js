require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const shared = require('@notely/shared');
const databaseRoutes = require('./src/routes/databaseRoutes');
const backupRoutes = require('./src/routes/backupRoutes');
const backupScheduler = require('./src/services/backupScheduler');
const recordingRetentionRoutes = require('./src/routes/recordingRetentionRoutes');
const recordingRetentionScheduler = require('./src/services/recordingRetentionScheduler');

const SERVICE_NAME = process.env.SERVICE_NAME || 'admin-database';
const PORT = Number(process.env.ADMIN_DATABASE_PORT || process.env.PORT || 3208);

const logger = shared.logger.child({ service: SERVICE_NAME });
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const { errorHandler } = shared.errors;
const db = shared.database;

const app = express();

// Middleware
app.use(helmet());
// CORS is handled by nginx at the edge layer - no application-level CORS needed
app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

// Security middleware stack
securityMiddleware.createSecurityStack().forEach((middlewareFn) => {
  app.use(middlewareFn);
});

/**
 * Gateway-authenticated requests include user context headers. Enforce admin-only access.
 */
const authenticate = (req, res, next) => {
  const authType = req.headers['x-auth-type'];
  const authEmail = req.headers['x-auth-email'];
  const authRole = req.headers['x-auth-role'];
  const authSubject = req.headers['x-auth-subject'];
  const authScopes = req.headers['x-auth-scopes'] || '';

  if (!authType || !authEmail || !authRole) {
    logger.warn('Request missing gateway auth headers', { path: req.path });
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!['admin', 'super_admin'].includes(authRole)) {
    logger.warn('Non-admin user attempted database access', {
      email: authEmail,
      role: authRole,
      path: req.path
    });
    return res.status(403).json({ error: 'Admin privileges required' });
  }

  req.user = {
    id: authSubject,
    email: authEmail,
    role: authRole,
    scopes: authScopes.split(',').map((scope) => scope.trim()).filter(Boolean)
  };

  next();
};

// Health check
app.get('/health', async (_req, res) => {
  try {
    const dbHealth = await db.healthCheck();
    const healthy = dbHealth.status === 'healthy';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
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
app.use('/api/admin/database', authenticate, databaseRoutes);
app.use('/api/admin/database/backups', authenticate, backupRoutes);
app.use('/api/admin/database/recording-retention', authenticate, recordingRetentionRoutes);

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
    logger.info('Initializing admin-database service...');
    await db.initialize(logger);
    logger.info('Database connection ready');

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`${SERVICE_NAME} service listening on port ${PORT}`);
    });

    // Start backup scheduler
    await backupScheduler.startScheduler();
    logger.info('Backup scheduler initialized');

    // Start recording retention scheduler
    await recordingRetentionScheduler.startScheduler();
    logger.info('Recording retention scheduler initialized');
  } catch (error) {
    logger.error('Failed to initialize admin-database service', { error: error.message });
    process.exit(1);
  }
}

initialize();

// Graceful shutdown
const shutdown = async () => {
  logger.info(`${SERVICE_NAME} service shutting down`);

  try {
    // Stop backup scheduler
    backupScheduler.stopScheduler();
    logger.info('Backup scheduler stopped');

    // Stop recording retention scheduler
    recordingRetentionScheduler.stopScheduler();
    logger.info('Recording retention scheduler stopped');

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

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
