"use strict";

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const shared = require('@notely/shared');
const logRoutes = require('./src/routes/logRoutes');
const authenticate = require('./src/middleware/authenticate');
const metrics = require('./src/utils/metrics');
const configStore = require('./src/services/configStore');
const scheduler = require('./src/services/logRetentionScheduler');
const lokiClient = require('./src/services/lokiClient');

const SERVICE_NAME = process.env.SERVICE_NAME || 'logs';
const PORT = process.env.LOGS_PORT || 3210;

const logger = shared.logger.child({ service: SERVICE_NAME });
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const { errorHandler } = shared.errors;
const db = shared.database;

const app = express();

app.use(helmet());
// CORS is handled by nginx at the edge layer - no application-level CORS needed

app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);
securityMiddleware.createSecurityStack().forEach((middlewareFn) => {
  app.use(middlewareFn);
});

metrics.initMetrics(SERVICE_NAME);

app.get('/metrics', metrics.handleMetricsRequest);

app.get('/health', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();
    const lokiHealth = await lokiClient.healthCheck();

    const healthy = dbHealth.status === 'healthy' && lokiHealth.healthy;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      dependencies: {
        database: dbHealth.status,
        loki: lokiHealth.status
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

app.use('/api/admin/logs', authenticate, logRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

app.use(errorHandler);

let server;

async function bootstrap() {
  try {
    logger.info('Logs service initializing...');

    await db.initialize(logger);
    logger.info('Database connection ready');

    await configStore.initialize();
    logger.info('Logging configuration cache initialized');

    await scheduler.initialize();
    logger.info('Log retention scheduler initialized');

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`${SERVICE_NAME} service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize logs service', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

bootstrap();

async function shutdown() {
  logger.info('Logs service shutting down...');

  try {
    await scheduler.shutdown();
    await configStore.shutdown();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    await db.close();
    logger.info('Logs service shut down cleanly');
    process.exit(0);
  } catch (error) {
    logger.error('Error during logs service shutdown', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
