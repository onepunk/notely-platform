/**
 * Notely V3 WebSocket Gateway Service
 *
 * Provides real-time sync notifications to connected desktop clients.
 * Port: 3217
 *
 * Features:
 * - WebSocket connections with JWT authentication via Sec-WebSocket-Protocol
 * - Redis Pub/Sub for cross-device notifications
 * - Connection tracking per user/device
 * - WebSocket-level ping/pong for connection health
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const promClient = require('prom-client');

const JwtValidator = require('./auth/jwtValidator');
const ConnectionManager = require('./connections/manager');
const PubSubManager = require('./redis/pubsub');
const SyncNotifyHandler = require('./handlers/syncNotify');

// Simple logger (following patterns from other services)
const logger = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', message: msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.log(JSON.stringify({ level: 'warn', message: msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', message: msg, ...meta, timestamp: new Date().toISOString() })),
  debug: (msg, meta = {}) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(JSON.stringify({ level: 'debug', message: msg, ...meta, timestamp: new Date().toISOString() }));
    }
  }
};

// Configuration
const PORT = parseInt(process.env.WS_GATEWAY_PORT || '3217', 10);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth:3201';
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS || '30000', 10);
const MAX_CONNECTIONS_PER_USER = parseInt(process.env.WS_MAX_CONNECTIONS_PER_USER || '5', 10);

// Prometheus metrics (defined before components that use them)
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const connectionsGauge = new promClient.Gauge({
  name: 'ws_gateway_connections_total',
  help: 'Total number of active WebSocket connections',
  registers: [register]
});

const usersGauge = new promClient.Gauge({
  name: 'ws_gateway_users_total',
  help: 'Total number of users with active connections',
  registers: [register]
});

const messagesCounter = new promClient.Counter({
  name: 'ws_gateway_messages_total',
  help: 'Total number of messages sent',
  labelNames: ['type'],
  registers: [register]
});

const authFailuresCounter = new promClient.Counter({
  name: 'ws_gateway_auth_failures_total',
  help: 'Total number of authentication failures',
  registers: [register]
});

// JWKS metrics
const jwksFetchSuccessCounter = new promClient.Counter({
  name: 'ws_gateway_jwks_fetch_success_total',
  help: 'Total number of successful JWKS key fetches',
  registers: [register]
});

const jwksFetchErrorsCounter = new promClient.Counter({
  name: 'ws_gateway_jwks_fetch_errors_total',
  help: 'Total number of failed JWKS key fetches',
  registers: [register]
});

const tokenValidationSuccessCounter = new promClient.Counter({
  name: 'ws_gateway_token_validation_success_total',
  help: 'Total number of successful token validations',
  registers: [register]
});

const tokenValidationErrorsCounter = new promClient.Counter({
  name: 'ws_gateway_token_validation_errors_total',
  help: 'Total number of failed token validations',
  registers: [register]
});

// Initialize components
const jwtValidator = new JwtValidator({
  authServiceUrl: AUTH_SERVICE_URL,
  logger,
  metrics: {
    jwksFetchSuccess: jwksFetchSuccessCounter,
    jwksFetchErrors: jwksFetchErrorsCounter,
    tokenValidationSuccess: tokenValidationSuccessCounter,
    tokenValidationErrors: tokenValidationErrorsCounter,
  }
});

const connectionManager = new ConnectionManager({
  maxConnectionsPerUser: MAX_CONNECTIONS_PER_USER,
  logger
});

const pubsubManager = new PubSubManager({ logger });

const syncNotifyHandler = new SyncNotifyHandler({
  connectionManager,
  pubsubManager,
  logger
});

// Update metrics periodically
setInterval(() => {
  const stats = connectionManager.getStats();
  connectionsGauge.set(stats.totalConnections);
  usersGauge.set(stats.totalUsers);
}, 5000);

// Create HTTP server for health check and metrics
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    try {
      const redisHealth = await pubsubManager.healthCheck();
      const stats = connectionManager.getStats();

      if (redisHealth.status !== 'healthy') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'unhealthy',
          service: 'ws-gateway',
          error: 'Redis unhealthy',
          redis: redisHealth
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        service: 'ws-gateway',
        connections: stats.totalConnections,
        users: stats.totalUsers,
        uptime: process.uptime(),
        redis: 'connected',
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'unhealthy',
        service: 'ws-gateway',
        error: error.message
      }));
    }
    return;
  }

  if (req.url === '/metrics') {
    try {
      const metrics = await register.metrics();
      res.writeHead(200, { 'Content-Type': register.contentType });
      res.end(metrics);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(error.message);
    }
    return;
  }

  // 404 for other HTTP requests
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not Found',
    message: 'This is a WebSocket server. Connect via WebSocket to /ws',
    availableEndpoints: ['GET /health', 'GET /metrics', 'WebSocket /ws']
  }));
});

// Create WebSocket server
const wss = new WebSocketServer({
  server,
  path: '/ws',
  // Verify connection during upgrade
  verifyClient: async ({ req }, callback) => {
    const protocol = req.headers['sec-websocket-protocol'];

    if (!protocol) {
      logger.warn('WebSocket connection rejected: missing protocol header');
      authFailuresCounter.inc();
      callback(false, 401, 'Missing authentication');
      return;
    }

    try {
      const { token, deviceId } = jwtValidator.parseAuthProtocol(protocol);
      const user = await jwtValidator.validate(token);

      // Attach user info to request for use in connection handler
      req.authUser = user;
      req.authDeviceId = deviceId;
      req.authToken = token;

      callback(true);
    } catch (error) {
      logger.warn('WebSocket authentication failed', {
        error: error.message,
        ip: req.socket.remoteAddress
      });
      authFailuresCounter.inc();
      callback(false, 401, 'Authentication failed');
    }
  }
});

// Handle new WebSocket connections
wss.on('connection', async (ws, req) => {
  const { userId } = req.authUser;
  const deviceId = req.authDeviceId;

  logger.info('WebSocket connection established', {
    userId,
    deviceId,
    ip: req.socket.remoteAddress
  });

  // Add connection to manager
  const added = connectionManager.addConnection(userId, deviceId, ws);
  if (!added) {
    ws.close(4008, 'Connection limit exceeded');
    return;
  }

  // Register user for sync notifications
  await syncNotifyHandler.registerUser(userId);

  // Send authenticated message (include the protocol so client knows it was accepted)
  ws.send(JSON.stringify({
    type: 'authenticated',
    payload: {
      userId,
      deviceId,
      maxConnections: MAX_CONNECTIONS_PER_USER
    }
  }));

  // Setup ping/pong for connection health
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
    connectionManager.updateLastPing(ws);
  });

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        messagesCounter.inc({ type: 'pong' });
      }
      // Other message types can be added here if needed
    } catch (error) {
      logger.warn('Invalid WebSocket message', {
        userId,
        deviceId,
        error: error.message
      });
    }
  });

  // Handle connection close
  ws.on('close', async (code, reason) => {
    logger.info('WebSocket connection closed', {
      userId,
      deviceId,
      code,
      reason: reason.toString()
    });

    connectionManager.removeConnection(userId, deviceId);

    // Check if we should unsubscribe from Redis
    await syncNotifyHandler.checkAndUnregister(userId);
  });

  // Handle errors
  ws.on('error', (error) => {
    logger.error('WebSocket error', {
      userId,
      deviceId,
      error: error.message
    });
  });
});

// Ping interval to detect dead connections
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      const info = connectionManager.getConnectionInfo(ws);
      logger.info('Terminating inactive WebSocket', info);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

// Clean up on server close
wss.on('close', () => {
  clearInterval(pingInterval);
});

// Graceful shutdown
let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('WebSocket Gateway shutting down...');

  clearInterval(pingInterval);

  // Close all WebSocket connections
  wss.clients.forEach((ws) => {
    ws.close(1001, 'Server shutting down');
  });

  // Close Redis connection
  await pubsubManager.close();

  // Close HTTP server
  server.close(() => {
    logger.info('WebSocket Gateway shut down gracefully');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Initialize and start
async function initialize() {
  try {
    logger.info('Initializing WebSocket Gateway...');

    // Initialize Redis Pub/Sub
    await pubsubManager.initialize();
    logger.info('Redis Pub/Sub ready');

    // Pre-warm JWKS cache
    await jwtValidator.warmCache();

    // Start HTTP/WebSocket server
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`WebSocket Gateway listening on port ${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to initialize WebSocket Gateway', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

initialize();
