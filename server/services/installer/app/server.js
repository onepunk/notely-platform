/**
 * Notely Platform Installer - Express Server
 *
 * Provides a web-based installation wizard for enterprise deployments.
 * Features:
 * - Self-signed SSL certificate for secure setup
 * - One-time setup token authentication
 * - 9-step installation wizard
 * - Auto-shutdown after completion or timeout
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import winston from 'winston';

import apiRoutes from './routes/api.js';
import { setupTokenAuth } from './middleware/auth.js';
import { startInactivityTimer, resetInactivityTimer } from './lib/shutdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const config = {
  port: parseInt(process.env.INSTALLER_PORT || '9000', 10),
  timeoutMinutes: parseInt(process.env.INSTALLER_TIMEOUT_MINUTES || '30', 10),
  setupToken: process.env.SETUP_TOKEN,
  certDir: '/installer/certs',
  workspacePath: process.env.WORKSPACE_PATH || '/workspace',
};

// Validate setup token exists
if (!config.setupToken) {
  console.error('ERROR: SETUP_TOKEN environment variable is required');
  process.exit(1);
}

// Logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Express app
const app = express();

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: false, // Self-signed cert, no HSTS
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Reset inactivity timer on each request
app.use((req, res, next) => {
  resetInactivityTimer();
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: Date.now() - start,
    });
  });
  next();
});

// Health check (unauthenticated)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Token verification endpoint
app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body;

  if (token === config.setupToken) {
    // Generate session token for subsequent requests
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Store session (in production, use a proper session store)
    app.locals.activeSessions = app.locals.activeSessions || new Set();
    app.locals.activeSessions.add(sessionId);

    logger.info('Setup token verified successfully');
    res.json({
      success: true,
      sessionId,
      message: 'Authentication successful',
    });
  } else {
    logger.warn('Invalid setup token attempt');
    res.status(401).json({
      success: false,
      error: 'Invalid setup token',
    });
  }
});

// API routes (authenticated)
app.use('/api', setupTokenAuth(app), apiRoutes);

// Serve static files (React UI)
const staticPath = path.join(__dirname, 'public');
if (fs.existsSync(staticPath)) {
  app.use(express.static(staticPath));

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
} else {
  // Fallback if UI not built
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Notely Installer</title>
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
          .token-input { padding: 12px; font-size: 16px; width: 300px; margin: 10px; }
          .submit-btn { padding: 12px 24px; font-size: 16px; background: #132E2D; color: white; border: none; cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>Notely Platform Installer</h1>
        <p>Enter your setup token to begin installation:</p>
        <form id="tokenForm">
          <input type="text" class="token-input" id="token" placeholder="Setup Token" required>
          <br>
          <button type="submit" class="submit-btn">Begin Setup</button>
        </form>
        <script>
          document.getElementById('tokenForm').onsubmit = async (e) => {
            e.preventDefault();
            const token = document.getElementById('token').value;
            const res = await fetch('/api/auth/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token })
            });
            const data = await res.json();
            if (data.success) {
              sessionStorage.setItem('sessionId', data.sessionId);
              alert('Authentication successful! (Full UI not built - API is functional)');
            } else {
              alert('Invalid token');
            }
          };
        </script>
      </body>
      </html>
    `);
  });
}

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Read SSL certificates
const sslOptions = {
  key: fs.readFileSync(path.join(config.certDir, 'installer.key')),
  cert: fs.readFileSync(path.join(config.certDir, 'installer.crt')),
};

// Create HTTPS server
const server = https.createServer(sslOptions, app);

// Start server
server.listen(config.port, '0.0.0.0', () => {
  logger.info(`Installer server listening on https://0.0.0.0:${config.port}`);

  // Start inactivity timer
  startInactivityTimer(config.timeoutMinutes, () => {
    logger.info('Inactivity timeout reached, shutting down installer');
    gracefulShutdown();
  });
});

// Graceful shutdown
function gracefulShutdown() {
  logger.info('Shutting down installer...');

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force shutdown after 5 seconds
  setTimeout(() => {
    logger.warn('Forced shutdown');
    process.exit(0);
  }, 5000);
}

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Export for testing
export { app, server };
