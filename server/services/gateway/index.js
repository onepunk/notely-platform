require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');

const shared = require('@notely/shared');
const logger = shared.logger;
const requestIdMiddleware = shared.middleware.requestId;
const requestLoggingMiddleware = shared.middleware.requestLogging;
const securityMiddleware = shared.middleware.security;
const { globalRateLimiter, initialize: initializeRateLimiter } = shared.middleware.rateLimiter;
const { initialize: initializeBodySizeLimit, createGatewayMiddleware: createBodySizeLimitMiddleware } = shared.middleware.bodySizeLimit;
const { errorHandler } = shared.errors;
const ApiKeyVerifier = shared.authClient.ApiKeyVerifier;

const TokenValidator = require('./auth/tokenValidator');
const JwksClient = require('./auth/jwksClient');
const ServiceTokenClient = require('./auth/serviceTokenClient');
const IntrospectionClient = require('./auth/introspectionClient');
const createAuthMiddleware = require('./auth/middleware');
const metrics = require('./metrics');
const routeConfigs = require('./config/routes.json');
const definedEndpoints = require('./config/defined-endpoints.json');
const { applyRequestTransforms } = require('./transforms/request');
const responseTransforms = require('./transforms/response');
const CircuitBreakerRegistry = require('./circuit/registry');

const app = express();
const PORT = process.env.GATEWAY_PORT || 3200;
const SERVICE_NAME = process.env.SERVICE_NAME || 'gateway';
const SERVICE_API_KEY = process.env.GATEWAY_SERVICE_API_KEY;
if (!SERVICE_API_KEY) {
  throw new Error('GATEWAY_SERVICE_API_KEY environment variable is required');
}

// CRITICAL: All service URLs must be configured - no fallbacks allowed
const REQUIRED_SERVICE_URLS = [
  'AUTH_SERVICE_URL',
  'USERS_SERVICE_URL',
  'CALENDAR_SERVICE_URL',
  // 'MEETINGS_SERVICE_URL',      // Service not yet implemented
  // 'TRANSCRIPTS_SERVICE_URL',   // Service not yet implemented
  'DOCKER_MANAGER_SERVICE_URL',
  'ADMIN_CONFIG_SERVICE_URL',
  'ADMIN_DATABASE_SERVICE_URL',
  'LOGS_SERVICE_URL',
  'PORTAL_BFF_SERVICE_URL',
  'SYNC_SERVICE_URL',
  'LICENSE_SERVICE_URL',
  'SUMMARIES_SERVICE_URL',
  'SUPPORT_SERVICE_URL',
  'EMAIL_SERVICE_URL'
];

const missingEnvVars = REQUIRED_SERVICE_URLS.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  logger.error('Missing required service URL environment variables', { missing: missingEnvVars });
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const SERVICES = {
  auth: process.env.AUTH_SERVICE_URL,
  users: process.env.USERS_SERVICE_URL,
  calendar: process.env.CALENDAR_SERVICE_URL,
  // meetings: process.env.MEETINGS_SERVICE_URL,      // Service not yet implemented
  // transcripts: process.env.TRANSCRIPTS_SERVICE_URL, // Service not yet implemented
  'docker-manager': process.env.DOCKER_MANAGER_SERVICE_URL,
  'admin-config': process.env.ADMIN_CONFIG_SERVICE_URL,
  'admin-database': process.env.ADMIN_DATABASE_SERVICE_URL,
  logs: process.env.LOGS_SERVICE_URL,
  'portal-bff': process.env.PORTAL_BFF_SERVICE_URL,
  sync: process.env.SYNC_SERVICE_URL,
  license: process.env.LICENSE_SERVICE_URL,
  summaries: process.env.SUMMARIES_SERVICE_URL,
  support: process.env.SUPPORT_SERVICE_URL,
  email: process.env.EMAIL_SERVICE_URL
};

const ENABLE_DESKTOP_OAUTH =
  String(process.env.AUTH_ENABLE_DESKTOP_OAUTH || 'false').toLowerCase() === 'true';
const OIDC_ENABLED =
  String(process.env.AUTH_ENABLE_OIDC_PROVIDER || 'false').toLowerCase() === 'true';

const ANONYMOUS_ROUTES = [
  { method: 'GET', path: '/api/status' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/refresh' },
  { method: 'POST', path: '/api/auth/validate' },
  { method: 'POST', path: '/api/portal/auth/login' },
  { method: 'POST', path: '/api/portal/auth/register' },
  { method: 'POST', path: '/api/portal/auth/refresh' },
  { method: 'POST', path: '/api/portal/auth/validate' },
  { method: 'POST', path: '/api/portal/auth/verify-email' },
  { method: 'POST', path: '/api/portal/auth/resend-verification' },
  { method: 'GET', matcher: /^\/api\/public\/config\/.*$/ },
  // License validation endpoints
  { method: 'POST', path: '/api/license/validate' },
  // Public tier/feature endpoints
  { method: 'GET', matcher: /^\/api\/license\/tiers(\/.*)?$/ },
  // License activation endpoints (authenticates via license key, not user JWT)
  { method: 'POST', path: '/api/license/activate' },
  { method: 'POST', path: '/api/license/deactivate' },
  { method: 'POST', path: '/api/license/revalidate' },
  // Auth public endpoints - explicitly listed for security (no wildcard)
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/register' },
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'POST', path: '/api/auth/refresh' },
  { method: 'POST', path: '/api/auth/password/refresh' },
  { method: 'POST', path: '/api/auth/validate' },
  { method: 'POST', path: '/api/auth/verify-email' },
  { method: 'POST', path: '/api/auth/resend-verification' },
  { method: 'GET', path: '/api/auth/security-settings' },
  // OAuth2 public endpoints
  { method: 'GET', path: '/api/auth/microsoft/login' },
  { method: 'GET', path: '/api/auth/microsoft/callback' },
  { method: 'POST', path: '/api/auth/desktop/exchange' },
  // Role permissions lookup (used by portal-bff for ACL)
  { method: 'GET', matcher: /^\/api\/auth\/roles\/[^/]+\/permissions$/ },
  // Calendar OAuth callback (Microsoft redirects here without credentials)
  { method: 'GET', path: '/api/outlook/callback' },
  // Public releases endpoints (get.yourdomain.com download page)
  { method: 'GET', path: '/api/portal/releases/latest' },
  { method: 'GET', matcher: /^\/api\/portal\/releases\/latest\/[^/]+$/ },
  { method: 'GET', matcher: /^\/api\/portal\/releases\/[^/]+\/download$/ },
  // Download tracking (public - called from download page)
  { method: 'POST', path: '/api/portal/downloads/track' },
  // Desktop client update check (public - works without authentication)
  { method: 'POST', path: '/api/portal/updates/check' },
  // Contact form endpoint (public website)
  { method: 'POST', path: '/api/support/contact' },
  // Beta signup endpoints (public website)
  { method: 'POST', path: '/api/support/beta/signup' },
  { method: 'GET', path: '/api/support/beta/status' },
  // Beta token validation (for registration flow - must be public)
  { method: 'POST', path: '/api/support/beta/validate' },
  // AI beta email verification (public - user verifies email to get license)
  { method: 'POST', path: '/api/support/beta/verify-email' },
  { method: 'POST', path: '/api/support/beta/verify-email-link' },
  { method: 'POST', path: '/api/support/beta/resend-verification' },
  // Internal API endpoints - authenticated via X-Internal-Api-Key header by portal-bff
  { method: '*', matcher: /^\/api\/internal\/.*$/ }
];

if (ENABLE_DESKTOP_OAUTH) {
  ANONYMOUS_ROUTES.push(
    { method: 'GET', path: '/api/desktop-auth/login' },
    { method: 'POST', path: '/api/desktop-auth/authorize' },
    { method: 'POST', path: '/api/desktop-auth/token' },
    { method: 'POST', path: '/api/desktop-auth/refresh' },
    { method: 'POST', path: '/api/desktop-auth/logout' },
    { method: 'POST', path: '/api/desktop-auth/validate-session' }
  );
}

if (OIDC_ENABLED) {
  ANONYMOUS_ROUTES.push({ method: '*', matcher: /^\/api\/oauth\/.*$/ });
}

const circuitRegistry = new CircuitBreakerRegistry({ logger, metrics });

function restreamBody(proxyReq, req) {
  if (!req.body) {
    return;
  }

  const hasBody =
    Buffer.isBuffer(req.body) ||
    typeof req.body === 'string' ||
    (typeof req.body === 'object' && Object.keys(req.body).length > 0);

  if (!hasBody) {
    return;
  }

  const methodAllowsBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!methodAllowsBody) {
    return;
  }

  const contentType = String(proxyReq.getHeader('Content-Type') || req.headers['content-type'] || '');
  let bodyBuffer = null;

  if (Buffer.isBuffer(req.body)) {
    bodyBuffer = req.body;
  } else if (typeof req.body === 'string') {
    bodyBuffer = Buffer.from(req.body);
  } else if (contentType.includes('application/json')) {
    bodyBuffer = Buffer.from(JSON.stringify(req.body));
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    bodyBuffer = Buffer.from(new URLSearchParams(req.body).toString());
  }

  if (!bodyBuffer) {
    return;
  }

  proxyReq.setHeader('Content-Length', bodyBuffer.length);
  proxyReq.write(bodyBuffer);
}

function attachProxyAuthHeaders(proxyReq, req) {
  if (req.requestId) {
    proxyReq.setHeader('X-Request-ID', req.requestId);
  }

  const headersToStrip = [
    'X-Auth-Subject',
    'X-Auth-Email',
    'X-Auth-Role',
    'X-Auth-Scopes',
    'X-Service-Name',
    'X-Service-Scopes',
    'X-Api-Key',
    'X-Api-Key-Name',
    'X-Api-Key-Scopes',
    'X-Auth-Type',
    'X-Auth-Source'
  ];

  headersToStrip.forEach((header) => {
    proxyReq.removeHeader(header);
  });

  if (!req.auth) {
    return;
  }

  proxyReq.setHeader('X-Auth-Type', req.auth.tokenType);
  if (req.auth.source) {
    proxyReq.setHeader('X-Auth-Source', req.auth.source);
  }

  if (req.auth.tokenType === 'user') {
    if (req.auth.userId) {
      proxyReq.setHeader('X-Auth-Subject', req.auth.userId);
    }
    if (req.auth.email) {
      proxyReq.setHeader('X-Auth-Email', req.auth.email);
    }
    if (req.auth.role) {
      proxyReq.setHeader('X-Auth-Role', req.auth.role);
    }
    if (Array.isArray(req.auth.scopes)) {
      proxyReq.setHeader('X-Auth-Scopes', req.auth.scopes.join(','));
    }
  } else if (req.auth.tokenType === 'service') {
    if (req.auth.serviceName) {
      proxyReq.setHeader('X-Service-Name', req.auth.serviceName);
    }
    if (Array.isArray(req.auth.scopes)) {
      proxyReq.setHeader('X-Service-Scopes', req.auth.scopes.join(','));
    }
  } else if (req.auth.tokenType === 'api-key') {
    if (req.auth.keyName) {
      proxyReq.setHeader('X-Api-Key-Name', req.auth.keyName);
    }
    if (Array.isArray(req.auth.scopes)) {
      proxyReq.setHeader('X-Api-Key-Scopes', req.auth.scopes.join(','));
    }
  }
}

// Skip body parsing for multipart uploads (binary data)
// Body size limit is loaded from admin-config via shared middleware
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.startsWith('multipart/form-data')) {
    return next();
  }
  createBodySizeLimitMiddleware()(req, res, next);
});
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);
securityMiddleware.createSecurityStack().forEach((middlewareFn) => {
  app.use(middlewareFn);
});

// Request metrics middleware - tracks endpoint hit counts and response times
app.use((req, res, next) => {
  const startTime = process.hrtime.bigint();

  // Determine request source: external (via nginx/cloudflare) vs internal (prometheus/docker health checks)
  // External requests come through nginx and will have X-Forwarded-For or X-Real-IP headers
  const xForwardedFor = req.headers['x-forwarded-for'];
  const xRealIp = req.headers['x-real-ip'];
  const requestSource = (xForwardedFor || xRealIp) ? 'external' : 'internal';

  // Capture the original end function
  const originalEnd = res.end;

  res.end = function (...args) {
    // Calculate duration in seconds
    const endTime = process.hrtime.bigint();
    const durationNs = Number(endTime - startTime);
    const durationSeconds = durationNs / 1e9;

    // Determine which service this request was routed to
    let targetService = 'gateway'; // Default for local endpoints

    // Match against route configs to determine service
    for (const [route, config] of Object.entries(routeConfigs)) {
      if (req.path.startsWith(route.replace('*', ''))) {
        targetService = config.service || 'gateway';
        break;
      }
    }

    // Record the metric with source label
    metrics.recordHttpRequest(
      req.method,
      req.path,
      targetService,
      res.statusCode,
      durationSeconds,
      requestSource
    );

    // Call the original end function
    return originalEnd.apply(this, args);
  };

  next();
});

// Initialize rate limiting without Redis first (will be re-initialized with Redis in bootstrap if available)
// NOTE: globalRateLimiter is applied per-route AFTER auth middleware (in registerProxies)
// so that req.auth is available for admin bypass
initializeRateLimiter(null);

metrics.initMetrics(SERVICE_NAME);

// Register all defined API endpoints for coverage tracking
metrics.registerDefinedEndpoints(definedEndpoints);
logger.info(`Registered ${definedEndpoints.length} defined API endpoints for coverage tracking`);

app.get('/metrics', metrics.handleMetricsRequest);

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'gateway',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/api/status', async (req, res) => {
  const serviceStatus = {};

  for (const [name, url] of Object.entries(SERVICES)) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      serviceStatus[name] = {
        status: response.ok ? 'healthy' : 'unhealthy'
      };
    } catch (error) {
      serviceStatus[name] = {
        status: 'unreachable'
      };
    }
  }

  const allHealthy = Object.values(serviceStatus).every((service) => service.status === 'healthy');

  res.status(allHealthy ? 200 : 503).json({
    gateway: 'healthy',
    services: serviceStatus,
    timestamp: new Date().toISOString()
  });
});

function createRouteProxy(route, config, breaker, targetService, targetUrl) {
  const transformations = config.transformations || {};
  const shouldTransform = responseTransforms.needsBodyTransform(transformations.response);

  const proxyOptions = {
    target: targetUrl,
    changeOrigin: true,
    pathRewrite: config.pathRewrite,
    timeout: 30000,        // Request timeout: 30s
    proxyTimeout: 30000,   // Proxy timeout: 30s
    logProvider: () => logger,
    onProxyReq: (proxyReq, req, res) => {
      logger.info(`Proxying request to ${targetService}:`, {
        method: req.method,
        path: req.path,
        url: req.url,
        target: targetUrl
      });
      attachProxyAuthHeaders(proxyReq, req);
      applyRequestTransforms({
        proxyReq,
        req,
        serviceName: SERVICE_NAME,
        config: transformations.request || {}
      });
      restreamBody(proxyReq, req);
    },
    onError: (err, req, res) => {
      logger.error(`${targetService} service proxy error`, {
        route,
        service: targetService,
        error: err.message
      });

      if (breaker) {
        breaker.recordFailure('proxy_error');
      }

      res.status(502).json({
        error: `${targetService}_service_unavailable`,
        message: err.message
      });
    }
  };

  proxyOptions.onProxyRes = (proxyRes, req, res) => {
    const upstreamStatus = proxyRes.statusCode || 500;
    const finalize = (status, error) => {
      if (!breaker) {
        return;
      }

      if (error || status >= 500) {
        breaker.recordFailure(error ? 'proxy_response_error' : 'upstream_error', status);
      } else {
        breaker.recordSuccess();
      }
    };

    if (shouldTransform) {
      responseTransforms.applyResponseTransforms({
        proxyRes,
        req,
        res,
        config: transformations.response,
        logger,
        onComplete: (status, error) => finalize(status ?? upstreamStatus, error)
      });
      return;
    }

    proxyRes.once('end', () => finalize(upstreamStatus, null));
    proxyRes.once('error', (error) => finalize(upstreamStatus, error));
  };

  if (shouldTransform) {
    proxyOptions.selfHandleResponse = true;
  }

  return createProxyMiddleware(proxyOptions);
}

function buildServiceEnvVarName(serviceName) {
  if (!serviceName) {
    return 'SERVICE_URL';
  }

  return `${String(serviceName)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toUpperCase()}_SERVICE_URL`;
}

function createMissingServiceHandler(route, serviceName) {
  const envVarName = buildServiceEnvVarName(serviceName);
  const safeServiceName = String(serviceName || 'unknown');
  const errorServiceKey = safeServiceName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const errorPayload = {
    error: `${errorServiceKey}_service_unconfigured`,
    message: `${safeServiceName} service URL is not configured for gateway route ${route}.`,
    details: {
      service: safeServiceName,
      route,
      expectedEnv: envVarName
    }
  };

  return (req, res) => {
    res.status(503).json(errorPayload);
  };
}

function registerProxies() {
  Object.entries(routeConfigs).forEach(([route, config]) => {
    const middlewares = [];

    // Add auth middleware for API routes if available
    if (route.startsWith('/api') && app.authMiddleware) {
      middlewares.push(app.authMiddleware);
    }

    // Global rate limiting - applied after auth so req.auth is available for admin bypass
    middlewares.push(globalRateLimiter);

    const targetService = config.service;
    const targetUrl = SERVICES[targetService];

    if (!targetUrl) {
      logger.warn('Registered fallback handler for missing service URL', {
        route,
        service: targetService,
        expectedEnv: buildServiceEnvVarName(targetService)
      });

      const fallbackHandler = createMissingServiceHandler(route, targetService);
      app.use(route, ...middlewares, fallbackHandler);
      return;
    }

    const circuitConfig = config.circuitBreaker || {};
    let breaker = null;

    if (circuitConfig.enabled) {
      breaker = circuitRegistry.get(route, circuitConfig);
      middlewares.push((req, res, next) => {
        if (breaker.canRequest()) {
          req.circuitBreaker = breaker;
          return next();
        }

        const fallback = breaker.getFallbackPayload();
        breaker.recordFallbackServed();

        const retryAfterSeconds = fallback.body?.circuitBreaker?.retryAfterMs
          ? Math.ceil(fallback.body.circuitBreaker.retryAfterMs / 1000)
          : null;
        if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
          res.setHeader('Retry-After', retryAfterSeconds);
        }

        res.status(fallback.status).json(fallback.body);
      });
    }

    const proxy = createRouteProxy(route, config, breaker, targetService, targetUrl);

    app.use(route, ...middlewares, proxy);
    logger.info('Registered gateway proxy route', {
      route,
      service: targetService,
      targetUrl,
      transformations: config.transformations
    });
  });
}

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.use((req, res, next) => next());

let server;

async function bootstrap() {
  try {
    logger.info('Gateway initializing...');

    const adminConfigUrl = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';

    // Initialize body size limit from admin-config
    await initializeBodySizeLimit({ adminConfigUrl, serviceName: 'gateway' });
    logger.info('Body size limit initialized from admin-config');

    // Initialize Redis for rate limiting (optional - falls back to memory if unavailable)
    try {
      const redis = shared.cache;
      await redis.initialize();
      const redisClient = redis.getClient();
      await initializeRateLimiter(redisClient, { adminConfigUrl });
      logger.info('Rate limiter initialized with Redis and admin-config');
    } catch (redisError) {
      logger.warn('Redis not available for rate limiting, using memory-based limiting', {
        error: redisError.message
      });
      // Rate limiter already initialized with memory in middleware setup
    }

    const serviceTokenClient = new ServiceTokenClient({
      authBaseUrl: SERVICES.auth,
      serviceName: SERVICE_NAME,
      apiKey: SERVICE_API_KEY,
      logger,
      defaultScopes: ['auth:introspect', 'auth:service-tokens', 'auth:api-keys:verify']
    });

    await serviceTokenClient.getToken();

    const apiKeyVerifier = new ApiKeyVerifier({
      authBaseUrl: SERVICES.auth,
      serviceTokenClient,
      logger
    });

    const jwksClient = new JwksClient({
      jwksUri: `${SERVICES.auth}/.well-known/jwks.json`,
      logger
    });

    const introspectionClient = new IntrospectionClient({
      authBaseUrl: SERVICES.auth,
      serviceTokenClient,
      logger
    });

    const tokenValidator = new TokenValidator({
      jwksClient,
      introspectionClient,
      logger
    });

    const authMiddleware = createAuthMiddleware({
      tokenValidator,
      apiKeyVerifier,
      logger,
      anonymousRoutes: ANONYMOUS_ROUTES
    });

    // Log anonymous routes for debugging
    logger.info('Anonymous routes configured:', ANONYMOUS_ROUTES);

    // Set auth middleware to be available globally
    app.authMiddleware = authMiddleware;

    // Evict token from LRU session cache on logout (before proxy forwards to auth)
    app.post('/api/auth/logout', (req, res, next) => {
      const token = req.cookies.access_token;
      if (token) {
        tokenValidator.invalidateSession(token);
      }
      next();
    });

    // Register proxies (they will handle auth individually)
    registerProxies();

    // 404 handler - must be after all routes
    app.use((req, res) => {
      const availableRoutes = [
        '/health',
        '/api/status',
        '/api/auth/*',
        ...(ENABLE_DESKTOP_OAUTH ? ['/api/desktop-auth/*'] : []),
        ...(OIDC_ENABLED ? ['/api/oauth/*'] : []),
        '/api/users/*',
        '/api/calendar/*',
        '/api/meetings/*',
        '/api/transcripts/*',
        '/api/admin/config/*',
        '/api/admin/access-control/*',
        '/api/admin/docker/*',
        '/api/admin/database/*',
        '/api/admin/system/*',
        '/api/admin/logs/*'
      ];

      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        availableRoutes
      });
    });

    // Error handler - must be last
    app.use(errorHandler);

    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Gateway listening on port ${PORT}`);
      logger.info('Routing to services:', SERVICES);
    });
  } catch (error) {
    logger.error('Failed to initialize gateway', { error: error.message });
    process.exit(1);
  }
}

bootstrap();

const shutdown = async () => {
  logger.info('Gateway shutting down...');

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    logger.info('Gateway shut down cleanly');
    process.exit(0);
  } catch (error) {
    logger.error('Error during gateway shutdown', { error: error.message });
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
