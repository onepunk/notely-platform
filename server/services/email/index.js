require('dotenv').config();

const express = require('express');
const shared = require('@notely/shared');

const logger = shared.logger;
const db = shared.database;
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const { initialize: initializeBodySizeLimit, createMiddleware: createBodySizeLimitMiddleware } = shared.middleware.bodySizeLimit;
const { errorHandler } = shared.errors;

const metrics = require('./src/utils/metrics');
const emailRoutes = require('./src/routes/email');
const templateAdminRoutes = require('./src/routes/templateAdmin');
const eventPublisher = require('./src/services/eventPublisher');
const eventConsumer = require('./src/services/eventConsumer');
const emailService = require('./src/services/emailService');

const app = express();
const PORT = process.env.EMAIL_PORT || 3214;
const SERVICE_NAME = process.env.SERVICE_NAME || 'email';

// Body size limit to prevent DoS attacks - dynamically loaded from admin-config
app.use(createBodySizeLimitMiddleware('email'));
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);
securityMiddleware.createSecurityStack().forEach((middlewareFn) => app.use(middlewareFn));

metrics.initMetrics(SERVICE_NAME);

app.get('/metrics', metrics.handleMetricsRequest);

app.get('/health', async (req, res) => {
  try {
    // Check email service health
    const emailHealth = await emailService.checkHealth();

    res.json({
      status: 'healthy',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      dependencies: {
        smtp: emailHealth ? 'connected' : 'disconnected'
      }
    });
  } catch (error) {
    logger.error('Email service health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: SERVICE_NAME,
      error: error.message
    });
  }
});

// Admin template management routes (before general email routes for correct matching)
app.use('/api/email/admin/templates', templateAdminRoutes);

// Email routes
app.use('/api/email', emailRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableRoutes: [
      '/health',
      '/metrics',
      'POST /api/email/send',
      'POST /api/email/send-template',
      'GET /api/email/templates',
      'GET /api/email/admin/templates',
      'GET /api/email/admin/templates/:name',
      'PUT /api/email/admin/templates/:name',
      'POST /api/email/admin/templates/:name/reset',
      'POST /api/email/admin/templates/:name/preview'
    ]
  });
});

app.use(errorHandler);

let server;

async function bootstrap() {
  try {
    logger.info('Email service initializing...');

    // Initialize database connection
    await db.initialize(logger);
    logger.info('Database pool ready');

    // Initialize body size limit from admin-config
    const adminConfigUrl = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';
    await initializeBodySizeLimit({ adminConfigUrl, serviceName: 'email' });
    logger.info('Body size limit initialized from admin-config');

    // Initialize email service (includes template seeding)
    await emailService.initialize();

    await eventPublisher.initialize();
    await eventConsumer.initialize();

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Email service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Email service', { error: error.message });
    process.exit(1);
  }
}

bootstrap();

async function shutdown() {
  logger.info('Email service shutting down...');

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await eventConsumer.close();
    await eventPublisher.close();
    await emailService.close();
    await db.close();
    logger.info('Email service shut down cleanly');
    process.exit(0);
  } catch (error) {
    logger.error('Error during Email service shutdown', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
