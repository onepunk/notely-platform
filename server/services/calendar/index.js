require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');

// Import shared infrastructure
const shared = require('@notely/shared');
const logger = shared.logger;
const db = shared.database;
const { initialize: initializeBodySizeLimit, createMiddleware: createBodySizeLimitMiddleware } = shared.middleware.bodySizeLimit;

// Import routes
const outlookRoutes = require('./src/routes/outlook');
const internalRoutes = require('./src/routes/internal');

// Import services
const microsoftGraphService = require('./src/services/microsoftGraphService');

const app = express();
const PORT = process.env.CALENDAR_PORT || 3203;

// Middleware stack
// Body size limit to prevent DoS attacks - dynamically loaded from admin-config
app.use(createBodySizeLimitMiddleware('calendar'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS is handled by nginx at the edge layer - no application-level CORS needed

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent')?.substring(0, 50),
    });
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();

    if (dbHealth.status !== 'healthy') {
      throw new Error('Database unhealthy');
    }

    res.json({
      status: 'healthy',
      service: 'calendar',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: 'connected',
      },
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'calendar',
      error: error.message,
    });
  }
});

// Routes
app.use('/internal', internalRoutes);
app.use('/api/outlook', outlookRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableRoutes: [
      '/health',
      '/api/outlook/status',
      '/api/outlook/auth',
      '/api/outlook/callback',
      '/api/outlook/events',
      '/api/outlook/disconnect',
    ],
  });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
  });
});

// Graceful shutdown
let server;

const shutdown = async () => {
  logger.info('Calendar service shutting down...');
  try {
    if (server) {
      server.close();
    }
    await db.close();
    logger.info('Calendar service shut down gracefully');
    process.exit(0);
  } catch (error) {
    logger.error('Shutdown error', { error: error.message });
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Initialize and start
async function initialize() {
  try {
    logger.info('Initializing Calendar service...');

    // Initialize database pool
    await db.initialize(logger);
    logger.info('Database pool ready');

    // Initialize body size limit from admin-config
    const adminConfigUrl = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';
    await initializeBodySizeLimit({ adminConfigUrl, serviceName: 'calendar' });
    logger.info('Body size limit initialized from admin-config');

    // Initialize Microsoft Graph service
    microsoftGraphService.initialize();
    logger.info('Microsoft Graph service initialized');

    // Start server
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Calendar service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Calendar service', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

initialize();

module.exports = app;
