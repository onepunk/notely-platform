require('dotenv').config();

const express = require('express');
const shared = require('@notely/shared');

const logger = shared.logger;
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const { initialize: initializeBodySizeLimit, createMiddleware: createBodySizeLimitMiddleware } = shared.middleware.bodySizeLimit;
const { errorHandler } = shared.errors;
const db = shared.database;

const metrics = require('./src/utils/metrics');
const ticketsRoutes = require('./src/routes/tickets');
const adminRoutes = require('./src/routes/admin');
const messagesRoutes = require('./src/routes/messages');
const betaRoutes = require('./src/routes/beta');
const betaAdminRoutes = require('./src/routes/betaAdmin');
const contactRoutes = require('./src/routes/contact');
const diagnosticsRoutes = require('./src/routes/diagnostics');
const diagnosticsAdminRoutes = require('./src/routes/diagnosticsAdmin');
const analysisInternalRoutes = require('./src/routes/analysisInternal');
const eventPublisher = require('./src/services/eventPublisher');
const eventConsumer = require('./src/services/eventConsumer');
const emailClient = require('./src/services/emailClient');
const analysisWatchdog = require('./src/services/analysisWatchdog');

const app = express();
const PORT = process.env.SUPPORT_PORT || 3209;
const SERVICE_NAME = process.env.SERVICE_NAME || 'support';

// Body size limit to prevent DoS attacks - dynamically loaded from admin-config
app.use(createBodySizeLimitMiddleware('support'));
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
    logger.error('Support service health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: SERVICE_NAME,
      error: error.message
    });
  }
});

// User-facing ticket routes
app.use('/api/support/tickets', ticketsRoutes);

// Admin ticket management routes
app.use('/api/support/admin', adminRoutes);

// Message routes (used by both users and admins)
app.use('/api/support/messages', messagesRoutes);

// Beta signup routes (public, no auth required)
app.use('/api/support/beta', betaRoutes);

// Contact form routes (public, no auth required)
app.use('/api/support/contact', contactRoutes);

// Diagnostics bundle routes (user upload + listing)
app.use('/api/support/diagnostics', diagnosticsRoutes);

// Diagnostics admin management routes
app.use('/api/support/admin/diagnostics', diagnosticsAdminRoutes);

// Internal analysis callback (host-side analyzer → support service)
app.use('/internal/analysis-callback', analysisInternalRoutes);

// Beta signups admin management routes
app.use('/api/support/admin/beta-signups', betaAdminRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableRoutes: [
      '/health',
      '/metrics',
      'POST /api/support/tickets',
      'GET /api/support/tickets',
      'GET /api/support/tickets/:id',
      'POST /api/support/tickets/:id/messages',
      'GET /api/support/admin/tickets',
      'PATCH /api/support/admin/tickets/:id',
      'POST /api/support/admin/tickets/:id/notes',
      'POST /api/support/diagnostics/upload',
      'GET /api/support/diagnostics',
      'GET /api/support/admin/diagnostics',
      'GET /api/support/admin/diagnostics/:id',
      'GET /api/support/admin/diagnostics/:id/download',
      'PATCH /api/support/admin/diagnostics/:id',
      'POST /api/support/admin/diagnostics/:id/analyze',
      'POST /internal/analysis-callback/:id',
      'POST /api/support/contact',
      'POST /api/support/beta/signup',
      'GET /api/support/beta/status',
      'POST /api/support/beta/redeem',
      'GET /api/support/admin/beta-signups',
      'POST /api/support/admin/beta-signups',
      'GET /api/support/admin/beta-signups/:id',
      'POST /api/support/admin/beta-signups/:id/send-invitation',
      'POST /api/support/admin/beta-signups/:id/resend-invitation',
      'DELETE /api/support/admin/beta-signups/:id',
      'POST /api/support/admin/beta-signups/internal/mark-converted'
    ]
  });
});

app.use(errorHandler);

let server;

async function bootstrap() {
  try {
    logger.info('Support service initializing...');
    await db.initialize(logger);

    // Initialize body size limit from admin-config
    const adminConfigUrl = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';
    await initializeBodySizeLimit({ adminConfigUrl, serviceName: 'support' });
    logger.info('Body size limit initialized from admin-config');

    await emailClient.initialize();
    await eventPublisher.initialize();
    await eventConsumer.initialize();
    analysisWatchdog.start();

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Support service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Support service', { error: error.message });
    process.exit(1);
  }
}

bootstrap();

async function shutdown() {
  logger.info('Support service shutting down...');

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await emailClient.close();
    await eventConsumer.close();
    await eventPublisher.close();
    logger.info('Support service shut down cleanly');
    process.exit(0);
  } catch (error) {
    logger.error('Error during Support service shutdown', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
