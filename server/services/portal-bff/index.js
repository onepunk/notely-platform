require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const promClient = require('prom-client');

const shared = require('@notely/shared');
const portalRouter = require('./src/routes');
const internalReleasesRouter = require('./src/routes/internalReleases');
const { internalOnly } = require('./src/middleware/internalAuth');

const SERVICE_NAME = process.env.SERVICE_NAME || 'portal-bff';
const PORT = process.env.PORTAL_BFF_PORT || process.env.PORT || 3215;

const logger = shared.logger.child({ service: SERVICE_NAME });
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const rateLimiter = shared.middleware.rateLimiter;
const { errorHandler } = shared.errors;
const db = shared.database;

const ADMIN_CONFIG_URL = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';

const app = express();
const metricsRegistry = new promClient.Registry();

metricsRegistry.setDefaultLabels({ service: SERVICE_NAME });
promClient.collectDefaultMetrics({
  register: metricsRegistry,
  prefix: `${SERVICE_NAME.replace(/-/g, '_')}_`
});

// Core middleware stack
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

securityMiddleware.createSecurityStack().forEach((fn) => app.use(fn));

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString()
  });
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  } catch (error) {
    logger.error('Failed to collect metrics', { error: error.message });
    res.status(500).send('metrics_unavailable');
  }
});

app.use('/portal', portalRouter);

// Internal API routes (protected by API key)
// Used by CI/CD pipelines and service-to-service communication
app.use('/internal/releases', internalOnly, internalReleasesRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found in ${SERVICE_NAME}`
  });
});

// Error handler
app.use(errorHandler);

let server;

async function start() {
  try {
    logger.info(`Starting ${SERVICE_NAME} service...`);
    await db.initialize(logger);

    // Initialize rate limiter with admin-config (uses memory fallback, no Redis)
    await rateLimiter.initialize(null, { adminConfigUrl: ADMIN_CONFIG_URL });

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start ${SERVICE_NAME}`, { error: error.message });
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

const shutdown = async () => {
  logger.info(`${SERVICE_NAME} shutting down`);
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.close();
    logger.info(`${SERVICE_NAME} exited gracefully`);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
