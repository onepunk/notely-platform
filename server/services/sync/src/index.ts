import { createServer } from 'http';
import { createApp } from './app';
import { config } from './config/env';
import { startScheduler, stopScheduler } from './services/syncPruningScheduler';
import { closePool } from './lib/database';

async function start() {
  const app = createApp();
  const server = createServer(app);

  // Start the sync pruning scheduler
  await startScheduler();

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Sync service listening on port ${config.port}`);
  });

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // Stop the pruning scheduler
    stopScheduler();

    // Close database connections
    await closePool();

    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('Sync service shut down complete');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void start();
