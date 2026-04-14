import { createServer } from 'http';
import { createApp } from './app';
import { config } from './config/env';
import { initializeRedis, closeRedis } from './lib/redis';
import { closePool } from './lib/database';
import { logger } from './utils/logger';
import { initialize as initializeKeyManager } from './services/keyManager';

async function start() {
  try {
    // Initialize Redis connection
    logger.info('Initializing Redis connection...');
    await initializeRedis();
    logger.info('Redis connection established');

    // Initialize key manager
    logger.info('Initializing key manager...');
    initializeKeyManager();
    logger.info('Key manager initialized successfully');

    // Create Express app
    const app = createApp();
    const server = createServer(app);

    // Setup graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          // Close database connections
          logger.info('Closing database connections...');
          await closePool();
          logger.info('Database connections closed');

          // Close Redis connection
          logger.info('Closing Redis connection...');
          await closeRedis();
          logger.info('Redis connection closed');

          logger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown', { error });
          process.exit(1);
        }
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      process.exit(1);
    });

    // Start server
    server.listen(config.port, () => {
      logger.info(`License service listening on port ${config.port}`);
      logger.info(`Health check: http://localhost:${config.port}/health`);
      logger.info(`Ready check: http://localhost:${config.port}/ready`);
      logger.info(`API docs: http://localhost:${config.port}/api/license/docs`);
    });
  } catch (error) {
    logger.error('Failed to start license service', { error });
    process.exit(1);
  }
}

void start();
