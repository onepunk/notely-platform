import express from 'express';
import { config } from './config/env';
import { authMiddleware } from './middleware/auth';
import { summariesRouter } from './routes/summaries';
import { promptsRouter } from './routes/prompts';
import { metricsRouter } from './routes/metrics';
import { getPool } from './lib/database';
import { checkLLMHealth } from './services/llmClient';
import { checkRedisHealth } from './services/syncNotifier';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Health check - basic liveness
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Ready check - full dependency check
  app.get('/ready', async (_req, res) => {
    const checks = {
      database_connected: false,
      schema_exists: false,
      llm_gateway_available: false,
      redis_connected: false,
      auth_configured: false,
    };

    try {
      // Check 1: Database connectivity
      const pool = getPool();
      await pool.query('SELECT 1');
      checks.database_connected = true;

      // Check 2: Schema existence
      const schemaResult = await pool.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.schemata
          WHERE schema_name = 'client_sync'
        ) AS exists`
      );
      checks.schema_exists = schemaResult.rows[0]?.exists === true;

      // Check 3: LLM Gateway
      checks.llm_gateway_available = await checkLLMHealth();

      // Check 4: Redis
      checks.redis_connected = await checkRedisHealth();

      // Check 5: Auth configuration
      checks.auth_configured = Boolean(config.auth.jwtPublicKey);

      // Determine overall status
      const allChecksPass = Object.values(checks).every((check) => check === true);
      const status = allChecksPass ? 'ready' : 'unhealthy';
      const statusCode = allChecksPass ? 200 : 503;

      res.status(statusCode).json({
        status,
        checks,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      res.status(503).json({
        status: 'unhealthy',
        checks,
        error: errorMessage,
      });
    }
  });

  // Summaries API routes (auth required)
  app.use('/api/summaries', authMiddleware, summariesRouter);

  // Admin prompt template routes (gateway enforces admin role)
  app.use('/api/admin/prompts', authMiddleware, promptsRouter);

  // Metrics
  app.use('/metrics', metricsRouter);

  return app;
}
