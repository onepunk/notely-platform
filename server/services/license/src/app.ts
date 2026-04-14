import express from 'express';
import 'express-async-errors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import fs from 'fs';
import path from 'path';
import { config } from './config/env';
import apiRoutes from './api/routes';
import { getPool } from './lib/database';
import { redisHealthCheck } from './lib/redis';
import { logger } from './utils/logger';
import { initMetrics, metricsMiddleware, getMetricsHandler } from './utils/metrics';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

  // Initialize metrics
  initMetrics('license');

  // Body parsing middleware
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Metrics middleware - record all HTTP requests
  app.use(metricsMiddleware);

  // Load and serve OpenAPI documentation
  try {
    const openApiPath = path.join(__dirname, '../docs/openapi.yaml');
    const openApiFile = fs.readFileSync(openApiPath, 'utf8');
    const openApiDocument = YAML.parse(openApiFile);

    // Serve Swagger UI at /api/license/docs
    app.use(
      '/api/license/docs',
      swaggerUi.serve,
      swaggerUi.setup(openApiDocument, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Notely License Service API',
      })
    );

    logger.info('Swagger UI enabled at /api/license/docs');
  } catch (error) {
    logger.error('Failed to load OpenAPI specification', { error });
  }

  // Basic health endpoint - liveness probe
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Readiness endpoint - checks all dependencies
  app.get('/ready', async (_req, res) => {
    const checks = {
      database_connected: false,
      redis_connected: false,
      keys_loaded: false,
    };

    try {
      // Check 1: Database connectivity
      const pool = getPool();
      await pool.query('SELECT 1');
      checks.database_connected = true;

      // Check 2: Redis connectivity
      const redisHealth = await redisHealthCheck();
      checks.redis_connected = redisHealth.status === 'healthy';

      // Check 3: Verify license keys directory is accessible
      const fs = await import('fs/promises');
      try {
        await fs.access(config.keys.directory);
        checks.keys_loaded = true;
      } catch {
        checks.keys_loaded = false;
      }

      // Determine overall status
      const allChecksPass = Object.values(checks).every((check) => check === true);
      const status = allChecksPass ? 'ready' : 'unhealthy';
      const statusCode = allChecksPass ? 200 : 503;

      res.status(statusCode).json({
        status,
        checks,
      });
    } catch (error) {
      // Handle errors gracefully - don't crash the endpoint
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      res.status(503).json({
        status: 'unhealthy',
        checks,
        error: errorMessage,
      });
    }
  });

  // Metrics endpoint
  app.get('/metrics', getMetricsHandler);

  // API routes - mount all routes under /api/license
  app.use('/api/license', apiRoutes);

  // 404 handler - must come after all route definitions
  app.use(notFoundHandler);

  // Error handling middleware - must be last
  app.use(errorHandler);

  return app;
}
