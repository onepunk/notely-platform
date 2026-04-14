/**
 * Notely V3 Auth Service
 *
 * Handles authentication, JWT token generation, and session management.
 * Port: 3201
 */

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');

// Import shared infrastructure (Phase 0)
const shared = require('@notely/shared');
const logger = shared.logger;
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const { initialize: initializeRateLimiter } = shared.middleware.rateLimiter;
const { initialize: initializeBodySizeLimit, createMiddleware: createBodySizeLimitMiddleware } = shared.middleware.bodySizeLimit;
const { errorHandler } = shared.errors;
const db = shared.database;
const cache = shared.cache;

// Import auth-specific code
const authRoutes = require('./src/routes/auth');
const oauth2Routes = require('./src/routes/oauth2');
const desktopAuthRoutes = require('./src/routes/desktopAuth');
const internalRoutes = require('./src/routes/internal');
const wellKnownRoutes = require('./src/routes/wellKnown');
const adminAccessRoutes = require('./src/routes/adminAccess');
const authMiddleware = require('./src/middleware/auth');
const metrics = require('./src/utils/metrics');
const eventPublisher = require('./src/services/eventPublisher');
const eventConsumer = require('./src/services/eventConsumer');
const signupPolicy = require('./src/services/signupPolicy');
const authEmailClient = require('./src/services/emailClient');

const app = express();
const PORT = process.env.AUTH_PORT || 3201;
const DESKTOP_OAUTH_ENABLED = String(process.env.AUTH_ENABLE_DESKTOP_OAUTH || 'false').toLowerCase() === 'true';

// Middleware
// Body size limit to prevent DoS attacks - dynamically loaded from admin-config
app.use(createBodySizeLimitMiddleware('auth'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Required for reading HTTP-only cookies
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);
securityMiddleware.createSecurityStack().forEach((middlewareFn) => {
  app.use(middlewareFn);
});

metrics.initMetrics(process.env.SERVICE_NAME || 'auth');

app.get('/metrics', metrics.handleMetricsRequest);

// Health check
app.get('/health', async (req, res) => {
  try {
    // Check database
    const dbHealth = await db.healthCheck();
    if (dbHealth.status !== 'healthy') {
      throw new Error('Database connection unhealthy');
    }

    // Check Redis
    const redisHealth = await cache.healthCheck();
    if (redisHealth.status !== 'healthy') {
      throw new Error('Redis connection unhealthy');
    }

    res.json({
      status: 'healthy',
      service: 'auth',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      dependencies: {
        database: 'connected',
        redis: 'connected'
      }
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'auth',
      error: error.message
    });
  }
});

// Public JWKS discovery
app.use('/.well-known', wellKnownRoutes);

// Internal service endpoints
app.use('/internal', internalRoutes);

// Auth routes
app.use('/api/auth', authRoutes);

// OAuth2 routes (direct Microsoft OAuth without OIDC provider)
// Note: Redis client will be injected during initialize()
app.use('/api/auth', oauth2Routes);

if (DESKTOP_OAUTH_ENABLED) {
  app.use('/api/desktop-auth', desktopAuthRoutes);
} else {
  logger.info('Legacy desktop OAuth routes disabled via configuration');
}

app.use('/api/admin/access-control', authMiddleware, adminAccessRoutes);

// Protected route example (requires valid JWT)
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    userId: req.userId,
    email: req.userEmail
  });
});

// Graceful shutdown
let server;

const shutdown = async () => {
  logger.info('Auth service shutting down...');

  const tidyUp = async () => {
    try {
      await eventConsumer.close();
      await eventPublisher.close();
      await authEmailClient.close();
      await db.close();
      await cache.close();
      logger.info('Auth service shut down gracefully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  };

  if (server) {
    server.close(async () => {
      await tidyUp();
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    await tidyUp();
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function initialize() {
  try {
    logger.info('Initializing Auth service...');
    await db.initialize(logger);
    logger.info('Database pool ready');

    await cache.initialize();
    logger.info('Redis connections ready');

    // Initialize rate limiter and body size limits with Redis client and admin-config URL
    const adminConfigUrl = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';
    await initializeRateLimiter(cache.getClient(), { adminConfigUrl });
    logger.info('Rate limiter initialized with Redis and admin-config');

    await initializeBodySizeLimit({ adminConfigUrl, serviceName: 'auth' });
    logger.info('Body size limit initialized from admin-config');

    // Inject Redis client into OAuth2 router (after cache initialization)
    oauth2Routes.setRedis(cache.getClient());
    logger.info('OAuth2 routes configured with Redis client');

    await eventPublisher.initialize();
    logger.info('Auth messaging publisher ready');
    await eventConsumer.initialize();
    logger.info('Auth messaging consumer ready');

    await authEmailClient.initialize();
    logger.info('Auth email client ready');

    try {
      await signupPolicy.refresh();
      logger.info('Admin configuration cache primed');
    } catch (error) {
      logger.warn('Unable to prime admin configuration cache', { error: error.message });
    }

    // 404 handler - must be registered AFTER all routes
    app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        availableRoutes: [
          'GET /health',
          'GET /metrics',
          'GET /.well-known/jwks.json',
          'POST /api/auth/login',
          'POST /api/auth/logout',
          'POST /api/auth/refresh',
          'POST /api/auth/validate',
          'GET /api/auth/me',
          'GET /api/auth/microsoft/login',
          'GET /api/auth/microsoft/callback',
          'GET /api/auth/session',
          'POST /api/auth/desktop/exchange',
          ...(DESKTOP_OAUTH_ENABLED
            ? [
                'GET /api/desktop-auth/login',
                'POST /api/desktop-auth/authorize',
                'POST /api/desktop-auth/token',
                'POST /api/desktop-auth/refresh',
                'POST /api/desktop-auth/logout',
                'POST /api/desktop-auth/validate-session'
              ]
            : []),
          'POST /internal/service-tokens',
          'POST /internal/tokens/introspect',
          'GET /internal/api-keys',
          'GET /internal/api-keys/:serviceName',
          'GET /internal/admin/access-control/*'
        ]
      });
    });

    // Error handler - must be last
    app.use(errorHandler);

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Auth service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to initialize Auth service', { error: error.message });
    process.exit(1);
  }
}

initialize();

module.exports = app; // For testing
