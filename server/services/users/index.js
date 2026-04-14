require('dotenv').config();

const express = require('express');
const shared = require('@notely/shared');

const logger = shared.logger;
const cache = shared.cache;
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const { initialize: initializeBodySizeLimit, createMiddleware: createBodySizeLimitMiddleware } = shared.middleware.bodySizeLimit;
const { errorHandler } = shared.errors;
const db = shared.database;

const metrics = require('./src/utils/metrics');
const usersRoutes = require('./src/routes/users');

const eventPublisher = require('./src/services/eventPublisher');
const eventConsumer = require('./src/services/eventConsumer');
const emailClient = require('./src/services/emailClient');

const app = express();
const PORT = process.env.USERS_PORT || 3202;
const SERVICE_NAME = process.env.SERVICE_NAME || 'users';

// Body size limit to prevent DoS attacks - dynamically loaded from admin-config
app.use(createBodySizeLimitMiddleware('users'));
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);
securityMiddleware.createSecurityStack().forEach((middlewareFn) => app.use(middlewareFn));

metrics.initMetrics(SERVICE_NAME);

app.get('/metrics', metrics.handleMetricsRequest);

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({
      status: 'healthy',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      dependencies: {
        database: 'connected'
      }
    });
  } catch (error) {
    logger.error('Users service health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: SERVICE_NAME,
      error: error.message
    });
  }
});

app.use('/api/users', usersRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableRoutes: [
      '/health',
      '/metrics',
      'GET /api/users (admin only)',
      'GET /api/users/me',
      'PATCH /api/users/me'
    ]
  });
});

app.use(errorHandler);

let server;

async function bootstrap() {
  try {
    logger.info('Users service initializing...');
    await db.initialize(logger);
    await cache.initialize();

    // Initialize body size limit from admin-config
    const adminConfigUrl = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';
    await initializeBodySizeLimit({ adminConfigUrl, serviceName: 'users' });
    logger.info('Body size limit initialized from admin-config');

    await eventPublisher.initialize();
    await eventConsumer.initialize();
    await emailClient.initialize();

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Users service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Users service', { error: error.message });
    process.exit(1);
  }
}

bootstrap();

async function shutdown() {
  logger.info('Users service shutting down...');

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await eventConsumer.close();
    await eventPublisher.close();
    await emailClient.close();
    await cache.close();
    logger.info('Users service shut down cleanly');
    process.exit(0);
  } catch (error) {
    logger.error('Error during Users service shutdown', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
