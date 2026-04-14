import express from 'express';
import { config } from './config/env';
import { authMiddleware } from './middleware/auth';
import { adminAuthMiddleware } from './middleware/adminAuth';
import { adminRouter } from './routes/admin';
import { metricsRouter } from './routes/metrics';
import { syncRouter } from './routes/v1';
import { getPool } from './lib/database';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/ready', async (_req, res) => {
    const checks = {
      database_connected: false,
      schema_exists: false,
      migrations_applied: false,
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

      // Check 3: Required tables exist (Joplin-style sync tables from V64 migration)
      // Reference: notely-platform/docs/SYNC_JOPLIN_IMPLEMENTATION_PLAN.md
      if (checks.schema_exists) {
        const tablesResult = await pool.query(
          `SELECT COUNT(*) AS count
           FROM information_schema.tables
           WHERE table_schema = 'client_sync'
           AND table_name IN (
             'sync_changes',
             'sync_mutations',
             'device_cursors',
             'sync_operations',
             'binder_content',
             'note_content',
             'transcription_content',
             'summary_content',
             'tag_content',
             'note_tag_content'
           )`
        );
        const tableCount = parseInt(tablesResult.rows[0]?.count || '0', 10);
        // Expect all 10 tables to exist for the new sync protocol
        checks.migrations_applied = tableCount === 10;
      }

      // Check 4: Auth configuration
      checks.auth_configured = Boolean(config.auth.jwtPublicKey);

      // Determine overall status
      const allChecksPass = Object.values(checks).every((check) => check === true);
      const status = allChecksPass ? 'ready' : 'unhealthy';
      const statusCode = allChecksPass ? 200 : 503;

      res.status(statusCode).json({
        status,
        checks,
        deviceQuota: config.auth.deviceQuota,
      });
    } catch (error) {
      // Handle errors gracefully - don't crash the endpoint
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      res.status(503).json({
        status: 'unhealthy',
        checks,
        deviceQuota: config.auth.deviceQuota,
        error: errorMessage,
      });
    }
  });

  // Sync API routes (Joplin-style cursor-based) + device link endpoint
  // Reference: notely-platform/docs/SYNC_JOPLIN.md
  app.use('/api/sync', authMiddleware, syncRouter);

  // Admin routes
  app.use('/admin', adminAuthMiddleware, adminRouter);

  // Metrics
  app.use('/metrics', metricsRouter);

  return app;
}
