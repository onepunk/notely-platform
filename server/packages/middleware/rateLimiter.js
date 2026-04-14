/**
 * Rate Limiting Middleware
 *
 * Uses rate-limiter-flexible for advanced rate limiting features:
 * - Redis-backed for distributed environments (cluster-safe)
 * - Per-IP and per-user/email limiting (simultaneous)
 * - Account lockout after failed attempts
 * - Configurable block durations
 * - Graceful fallback to memory if Redis fails
 * - Loads configuration from admin-config service on startup
 *
 * @module middleware/rateLimiter
 */

const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const logger = require('../logger');

// Store for rate limiters (created lazily)
let limiters = {};
let redisClientRef = null;
let activeConfig = null; // Stores the currently active configuration

// =============================================================================
// IP Whitelist Configuration
// =============================================================================

/**
 * Parse whitelist IPs from environment variable
 * Supports comma-separated IPs and CIDR notation
 * Example: RATE_LIMIT_WHITELIST_IPS=127.0.0.1,192.168.1.0/24,::1
 */
function parseWhitelistIPs() {
  const envValue = process.env.RATE_LIMIT_WHITELIST_IPS || '';
  if (!envValue.trim()) {
    return [];
  }

  const ips = envValue.split(',').map(ip => ip.trim()).filter(Boolean);

  if (ips.length > 0) {
    logger.info('Rate limit IP whitelist configured', {
      count: ips.length,
      ips: ips
    });
  }

  return ips;
}

// Parsed whitelist (loaded once at module init, can be refreshed)
let whitelistedIPs = parseWhitelistIPs();

/**
 * Refresh the whitelist from environment (call after env changes)
 */
function refreshWhitelist() {
  whitelistedIPs = parseWhitelistIPs();
  return whitelistedIPs;
}

/**
 * Check if an IP is whitelisted
 * Supports exact match and basic CIDR matching for /24 and /16 subnets
 *
 * @param {string} ip - IP address to check
 * @returns {boolean} True if whitelisted
 */
function isWhitelisted(ip) {
  if (!ip || whitelistedIPs.length === 0) {
    return false;
  }

  // Normalize IPv6 localhost
  const normalizedIP = ip === '::1' ? '127.0.0.1' : ip;

  for (const whitelistEntry of whitelistedIPs) {
    // Exact match
    if (whitelistEntry === ip || whitelistEntry === normalizedIP) {
      return true;
    }

    // Handle ::1 in whitelist
    if (whitelistEntry === '::1' && (ip === '::1' || ip === '127.0.0.1')) {
      return true;
    }

    // Basic CIDR support for common cases
    if (whitelistEntry.includes('/')) {
      const [subnet, bits] = whitelistEntry.split('/');
      const maskBits = parseInt(bits, 10);

      // Only support /8, /16, /24 for simplicity
      if (maskBits === 24 || maskBits === 16 || maskBits === 8) {
        const subnetParts = subnet.split('.');
        const ipParts = normalizedIP.split('.');

        if (ipParts.length === 4 && subnetParts.length === 4) {
          const octetsToMatch = maskBits / 8;
          let matches = true;

          for (let i = 0; i < octetsToMatch; i++) {
            if (subnetParts[i] !== ipParts[i]) {
              matches = false;
              break;
            }
          }

          if (matches) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG = {
  // Global rate limit (applied at gateway to all endpoints)
  global: {
    points: 100,             // 100 requests
    duration: 60,            // per minute
    blockDuration: 60 * 5,   // block for 5 minutes if exceeded
  },

  // Download tracking API rate limit (portal-bff)
  downloadTracking: {
    points: 30,              // 30 requests
    duration: 60,            // per minute
    blockDuration: 60,       // block for 1 minute if exceeded
  },

  // Auth endpoint configurations
  auth: {
    login: {
      // Per-IP limits for login attempts
      ip: {
        points: 10,              // 10 attempts
        duration: 60 * 15,       // per 15 minutes
        blockDuration: 60 * 15,  // block for 15 minutes if exceeded
      },
      // Per-email limits (stricter - protects individual accounts)
      email: {
        points: 5,               // 5 attempts per email
        duration: 60 * 15,       // per 15 minutes
        blockDuration: 60 * 30,  // block for 30 minutes if exceeded
      },
      // Consecutive failures tracking (for account lockout)
      consecutiveFails: {
        points: 5,               // 5 consecutive failures
        duration: 60 * 60 * 24,  // tracked over 24 hours
        blockDuration: 60 * 60,  // lock account for 1 hour
      }
    },
    changePassword: {
      // Per-user limits for password changes
      user: {
        points: 3,               // 3 attempts
        duration: 60 * 15,       // per 15 minutes
        blockDuration: 60 * 30,  // block for 30 minutes
      }
    },
    register: {
      // Per-IP limits for registration
      ip: {
        points: 5,               // 5 registrations
        duration: 60 * 60,       // per hour
        blockDuration: 60 * 60,  // block for 1 hour
      }
    },
    validate: {
      // Per-IP limits for token validation (higher limit for service calls)
      ip: {
        points: 100,             // 100 validations
        duration: 60,            // per minute
        blockDuration: 60 * 5,   // block for 5 minutes
      }
    },
    passwordReset: {
      // Per-IP limits for password reset requests
      ip: {
        points: 3,               // 3 reset requests
        duration: 60 * 60,       // per hour
        blockDuration: 60 * 60,  // block for 1 hour
      },
      // Per-email limits
      email: {
        points: 3,               // 3 reset requests per email
        duration: 60 * 60,       // per hour
        blockDuration: 60 * 60,  // block for 1 hour
      }
    }
  }
};

// =============================================================================
// Config Fetching
// =============================================================================

/**
 * Fetch rate limit configuration from admin-config service
 *
 * @param {string} adminConfigUrl - URL of the admin-config service
 * @returns {Promise<Object|null>} Configuration or null if fetch failed
 */
async function fetchConfigFromService(adminConfigUrl) {
  if (!adminConfigUrl) {
    logger.debug('No admin-config URL provided, using default config');
    return null;
  }

  try {
    const url = `${adminConfigUrl}/api/admin/config/rate-limit`;
    logger.info('Fetching rate limit config from admin-config service', { url });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Internal service call - no auth required for read
        'X-Internal-Service': 'rate-limiter'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('Failed to fetch rate limit config from admin-config', {
        status: response.status,
        statusText: response.statusText
      });
      return null;
    }

    const data = await response.json();

    if (data && data.config) {
      logger.info('Successfully loaded rate limit config from admin-config service', {
        global: data.config.global?.enabled,
        loginIP: data.config.auth?.login?.ip?.points,
        changePasswordDuration: data.config.auth?.changePassword?.user?.duration
      });
      return data.config;
    }

    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.warn('Timeout fetching rate limit config from admin-config service');
    } else {
      logger.warn('Error fetching rate limit config from admin-config service', {
        error: error.message
      });
    }
    return null;
  }
}

// =============================================================================
// Limiter Factory
// =============================================================================

/**
 * Create a rate limiter with Redis + memory fallback
 *
 * @param {string} keyPrefix - Prefix for Redis keys
 * @param {Object} options - Rate limiter options
 * @param {Object} redisClient - Optional Redis client
 * @returns {RateLimiterRedis|RateLimiterMemory}
 */
function createLimiter(keyPrefix, options, redisClient = null) {
  const memoryLimiter = new RateLimiterMemory({
    keyPrefix: `rl:${keyPrefix}`,
    points: options.points,
    duration: options.duration,
    blockDuration: options.blockDuration || 0,
  });

  if (redisClient) {
    try {
      return new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: `rl:${keyPrefix}`,
        points: options.points,
        duration: options.duration,
        blockDuration: options.blockDuration || 0,
        insuranceLimiter: memoryLimiter, // Fallback if Redis fails
      });
    } catch (error) {
      logger.warn(`Failed to create Redis rate limiter for ${keyPrefix}, using memory`, {
        error: error.message
      });
      return memoryLimiter;
    }
  }

  return memoryLimiter;
}

/**
 * Initialize all rate limiters
 *
 * @param {Object} redisClient - Redis client instance (from node-redis v4)
 * @param {Object} options - Initialization options
 * @param {string} options.adminConfigUrl - URL of the admin-config service (e.g., 'http://admin-config:3206')
 * @param {Object} options.customConfig - Optional custom configuration to override defaults
 */
async function initialize(redisClient = null, options = {}) {
  redisClientRef = redisClient;

  const { adminConfigUrl, customConfig = {} } = options;

  // Try to fetch config from admin-config service
  let serviceConfig = null;
  if (adminConfigUrl) {
    serviceConfig = await fetchConfigFromService(adminConfigUrl);
  }

  // Merge configs: DEFAULT_CONFIG < serviceConfig < customConfig
  let config = DEFAULT_CONFIG;
  if (serviceConfig) {
    config = mergeConfig(config, serviceConfig);
  }
  if (customConfig && Object.keys(customConfig).length > 0) {
    config = mergeConfig(config, customConfig);
  }

  // Store active config for reference
  activeConfig = config;

  // Global limiter
  limiters.global = createLimiter('global', config.global, redisClient);

  // Download tracking limiter (portal-bff)
  if (config.downloadTracking) {
    limiters.downloadTracking = createLimiter('download-tracking', config.downloadTracking, redisClient);
  }

  // Auth limiters
  limiters.loginByIP = createLimiter('auth:login:ip', config.auth.login.ip, redisClient);
  limiters.loginByEmail = createLimiter('auth:login:email', config.auth.login.email, redisClient);
  limiters.loginConsecutiveFails = createLimiter('auth:login:consecutive', config.auth.login.consecutiveFails, redisClient);
  limiters.changePasswordByUser = createLimiter('auth:changepw:user', config.auth.changePassword.user, redisClient);
  limiters.registerByIP = createLimiter('auth:register:ip', config.auth.register.ip, redisClient);
  limiters.validateByIP = createLimiter('auth:validate:ip', config.auth.validate.ip, redisClient);
  limiters.resetByIP = createLimiter('auth:reset:ip', config.auth.passwordReset.ip, redisClient);
  limiters.resetByEmail = createLimiter('auth:reset:email', config.auth.passwordReset.email, redisClient);

  logger.info('Rate limiters initialized', {
    redisEnabled: !!redisClient,
    configSource: serviceConfig ? 'admin-config' : 'defaults',
    limiters: Object.keys(limiters),
    changePasswordDuration: config.auth.changePassword.user.duration
  });
}

/**
 * Get the currently active configuration
 * @returns {Object} Active configuration
 */
function getActiveConfig() {
  return activeConfig || DEFAULT_CONFIG;
}

/**
 * Deep merge configuration objects
 */
function mergeConfig(defaults, custom) {
  const result = { ...defaults };
  for (const key in custom) {
    if (custom[key] && typeof custom[key] === 'object' && !Array.isArray(custom[key])) {
      result[key] = mergeConfig(defaults[key] || {}, custom[key]);
    } else {
      result[key] = custom[key];
    }
  }
  return result;
}

/**
 * Get a specific limiter (initializes with memory if not yet initialized)
 *
 * @param {string} name - Limiter name
 * @returns {RateLimiterRedis|RateLimiterMemory}
 */
function getLimiter(name) {
  if (!limiters[name]) {
    // Initialize with defaults if not yet initialized (sync fallback)
    logger.warn('Rate limiter not initialized, using defaults', { name });
    const config = DEFAULT_CONFIG;
    activeConfig = config;

    // Create just the needed limiter with defaults
    switch (name) {
      case 'global':
        limiters.global = createLimiter('global', config.global, redisClientRef);
        break;
      case 'downloadTracking':
        limiters.downloadTracking = createLimiter('download-tracking', config.downloadTracking, redisClientRef);
        break;
      case 'loginByIP':
        limiters.loginByIP = createLimiter('auth:login:ip', config.auth.login.ip, redisClientRef);
        break;
      case 'loginByEmail':
        limiters.loginByEmail = createLimiter('auth:login:email', config.auth.login.email, redisClientRef);
        break;
      case 'loginConsecutiveFails':
        limiters.loginConsecutiveFails = createLimiter('auth:login:consecutive', config.auth.login.consecutiveFails, redisClientRef);
        break;
      case 'changePasswordByUser':
        limiters.changePasswordByUser = createLimiter('auth:changepw:user', config.auth.changePassword.user, redisClientRef);
        break;
      case 'registerByIP':
        limiters.registerByIP = createLimiter('auth:register:ip', config.auth.register.ip, redisClientRef);
        break;
      case 'validateByIP':
        limiters.validateByIP = createLimiter('auth:validate:ip', config.auth.validate.ip, redisClientRef);
        break;
      case 'resetByIP':
        limiters.resetByIP = createLimiter('auth:reset:ip', config.auth.passwordReset.ip, redisClientRef);
        break;
      case 'resetByEmail':
        limiters.resetByEmail = createLimiter('auth:reset:email', config.auth.passwordReset.email, redisClientRef);
        break;
    }
  }
  return limiters[name];
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get client IP address (handles proxies)
 *
 * @param {Object} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIP(req) {
  // Check for forwarded IP (behind proxy/load balancer)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Take the first IP in the chain (original client)
    return forwarded.split(',')[0].trim();
  }
  // Check Cloudflare header
  const cfIP = req.headers['cf-connecting-ip'];
  if (cfIP) {
    return cfIP;
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Set rate limit headers on response
 *
 * @param {Object} res - Express response object
 * @param {Object} rateLimiterRes - Rate limiter response
 * @param {number} maxPoints - Maximum points allowed
 */
function setRateLimitHeaders(res, rateLimiterRes, maxPoints) {
  const remaining = Math.max(0, rateLimiterRes.remainingPoints || 0);
  const resetTime = new Date(Date.now() + (rateLimiterRes.msBeforeNext || 0));

  res.set({
    'X-RateLimit-Limit': maxPoints,
    'X-RateLimit-Remaining': remaining,
    'X-RateLimit-Reset': resetTime.toISOString(),
    'Retry-After': Math.ceil((rateLimiterRes.msBeforeNext || 0) / 1000)
  });
}

/**
 * Send rate limit exceeded response
 *
 * @param {Object} res - Express response object
 * @param {Object} rateLimiterRes - Rate limiter response
 * @param {string} message - Error message
 * @param {string} requestId - Request ID for tracking
 */
function sendRateLimitResponse(res, rateLimiterRes, message, requestId) {
  const retryAfter = Math.ceil((rateLimiterRes.msBeforeNext || 60000) / 1000);

  res.status(429).json({
    success: false,
    error: 'Too Many Requests',
    message: message || 'Too many requests, please try again later.',
    retryAfter,
    retryAfterMs: rateLimiterRes.msBeforeNext || 60000,
    requestId
  });
}

// =============================================================================
// Middleware Functions
// =============================================================================

/**
 * Global rate limiter middleware
 *
 * Apply this at the gateway level to limit all traffic.
 *
 * Usage: app.use(globalRateLimiter)
 */
async function globalRateLimiter(req, res, next) {
  // Skip health checks and metrics
  if (req.path === '/health' || req.path === '/metrics' || req.path === '/ready') {
    return next();
  }

  const ip = getClientIP(req);
  const requestId = req.requestId || req.headers['x-request-id'];

  // Skip rate limiting for whitelisted IPs (e.g., security scanners)
  if (isWhitelisted(ip)) {
    logger.debug('Rate limit bypassed for whitelisted IP', { ip, path: req.path });
    return next();
  }

  // Skip rate limiting for authenticated admin users
  const role = req.auth?.role;
  if (role === 'admin' || role === 'super_admin') {
    return next();
  }

  const limiter = getLimiter('global');
  const config = getActiveConfig();

  try {
    const result = await limiter.consume(ip, 1);
    setRateLimitHeaders(res, result, config.global.points);
    next();
  } catch (error) {
    if (error.remainingPoints !== undefined) {
      // Rate limit exceeded
      logger.warn('Global rate limit exceeded', {
        ip,
        path: req.path,
        method: req.method,
        requestId,
        blockedFor: error.msBeforeNext
      });

      setRateLimitHeaders(res, error, config.global.points);
      return sendRateLimitResponse(
        res,
        error,
        'Too many requests. Please slow down.',
        requestId
      );
    }

    // Unexpected error - fail open
    logger.error('Global rate limit check failed', {
      error: error.message,
      ip,
      requestId
    });
    next();
  }
}

/**
 * Login rate limiter middleware
 *
 * Applies both IP-based and email-based rate limiting.
 * Tracks consecutive failures for account lockout.
 *
 * Usage: router.post('/login', loginRateLimiter, handler)
 */
async function loginRateLimiter(req, res, next) {
  const ip = getClientIP(req);
  const email = (req.body?.email || '').toLowerCase().trim();
  const requestId = req.requestId || req.headers['x-request-id'];
  const config = getActiveConfig();

  // Skip rate limiting for whitelisted IPs
  if (isWhitelisted(ip)) {
    req.rateLimiters = null; // No limiters to consume
    return next();
  }

  try {
    // Check IP-based limit first
    const ipLimiter = getLimiter('loginByIP');
    const ipRes = await ipLimiter.get(ip);

    if (ipRes && ipRes.remainingPoints <= 0) {
      logger.warn('Login rate limit exceeded (IP)', {
        ip,
        email: email || '(not provided)',
        requestId,
        blockedFor: ipRes.msBeforeNext
      });

      setRateLimitHeaders(res, ipRes, config.auth.login.ip.points);
      return sendRateLimitResponse(
        res,
        ipRes,
        'Too many login attempts from this IP address. Please try again later.',
        requestId
      );
    }

    // Check email-based limit if email provided
    if (email) {
      const emailLimiter = getLimiter('loginByEmail');
      const emailRes = await emailLimiter.get(email);

      if (emailRes && emailRes.remainingPoints <= 0) {
        logger.warn('Login rate limit exceeded (email)', {
          ip,
          email,
          requestId,
          blockedFor: emailRes.msBeforeNext
        });

        setRateLimitHeaders(res, emailRes, config.auth.login.email.points);
        return sendRateLimitResponse(
          res,
          emailRes,
          'Too many login attempts for this account. Please try again later or reset your password.',
          requestId
        );
      }

      // Check consecutive failures (account lockout)
      const consecutiveLimiter = getLimiter('loginConsecutiveFails');
      const consecutiveRes = await consecutiveLimiter.get(email);

      if (consecutiveRes && consecutiveRes.remainingPoints <= 0) {
        logger.warn('Account temporarily locked due to consecutive failures', {
          ip,
          email,
          requestId,
          blockedFor: consecutiveRes.msBeforeNext
        });

        setRateLimitHeaders(res, consecutiveRes, config.auth.login.consecutiveFails.points);
        return sendRateLimitResponse(
          res,
          consecutiveRes,
          'Account temporarily locked due to too many failed attempts. Please try again later or reset your password.',
          requestId
        );
      }
    }

    // Store limiter info on request for post-login consumption
    req.rateLimiters = {
      ip: { limiter: getLimiter('loginByIP'), key: ip },
      email: email ? { limiter: getLimiter('loginByEmail'), key: email } : null,
      consecutive: email ? { limiter: getLimiter('loginConsecutiveFails'), key: email } : null
    };

    next();
  } catch (error) {
    logger.error('Login rate limit check failed', {
      error: error.message,
      ip,
      email: email || '(not provided)',
      requestId
    });
    // Fail open - allow request if rate limiter fails
    next();
  }
}

/**
 * Consume login rate limit points after login attempt
 *
 * Call this AFTER processing the login to properly track success/failure.
 *
 * @param {Object} req - Express request with rateLimiters attached
 * @param {boolean} success - Whether login was successful
 */
async function consumeLoginPoints(req, success) {
  if (!req.rateLimiters) return;

  const { ip, email, consecutive } = req.rateLimiters;

  try {
    if (success) {
      // Successful login - consume IP point, reset consecutive fails
      await ip.limiter.consume(ip.key, 1);

      if (consecutive) {
        // Reset consecutive failure counter on success
        await consecutive.limiter.delete(consecutive.key);
      }
    } else {
      // Failed login - consume points from all limiters
      await ip.limiter.consume(ip.key, 1);

      if (email) {
        await email.limiter.consume(email.key, 1);
      }

      if (consecutive) {
        await consecutive.limiter.consume(consecutive.key, 1);
      }
    }
  } catch (error) {
    // Rate limit exceeded during consumption - this is expected when limits are hit
    if (error.remainingPoints !== undefined) {
      logger.debug('Login rate limit consumed', {
        success,
        remainingPoints: error.remainingPoints
      });
    } else {
      logger.error('Error consuming login rate limit points', {
        error: error.message,
        success
      });
    }
  }
}

/**
 * Change password rate limiter middleware
 *
 * Limits password change attempts per authenticated user.
 *
 * Usage: router.post('/change-password', authMiddleware, changePasswordRateLimiter, handler)
 */
async function changePasswordRateLimiter(req, res, next) {
  const userId = req.userId;
  const ip = getClientIP(req);
  const requestId = req.requestId || req.headers['x-request-id'];
  const config = getActiveConfig();

  // Skip rate limiting for whitelisted IPs
  if (isWhitelisted(ip)) {
    return next();
  }

  if (!userId) {
    // Not authenticated - let auth middleware handle this
    return next();
  }

  try {
    const limiter = getLimiter('changePasswordByUser');
    await limiter.consume(userId, 1);
    next();
  } catch (error) {
    if (error.remainingPoints !== undefined) {
      logger.warn('Change password rate limit exceeded', {
        userId,
        ip,
        requestId,
        blockedFor: error.msBeforeNext
      });

      setRateLimitHeaders(res, error, config.auth.changePassword.user.points);
      return sendRateLimitResponse(
        res,
        error,
        'Too many password change attempts. Please try again later.',
        requestId
      );
    }

    logger.error('Change password rate limit check failed', {
      error: error.message,
      userId,
      requestId
    });
    next();
  }
}

/**
 * Registration rate limiter middleware
 *
 * Limits account creation per IP to prevent spam.
 *
 * Usage: router.post('/register', registerRateLimiter, handler)
 */
async function registerRateLimiter(req, res, next) {
  const ip = getClientIP(req);
  const requestId = req.requestId || req.headers['x-request-id'];
  const config = getActiveConfig();

  // Skip rate limiting for whitelisted IPs
  if (isWhitelisted(ip)) {
    return next();
  }

  try {
    const limiter = getLimiter('registerByIP');
    await limiter.consume(ip, 1);
    next();
  } catch (error) {
    if (error.remainingPoints !== undefined) {
      logger.warn('Registration rate limit exceeded', {
        ip,
        requestId,
        blockedFor: error.msBeforeNext
      });

      setRateLimitHeaders(res, error, config.auth.register.ip.points);
      return sendRateLimitResponse(
        res,
        error,
        'Too many registration attempts from this IP address. Please try again later.',
        requestId
      );
    }

    logger.error('Registration rate limit check failed', {
      error: error.message,
      ip,
      requestId
    });
    next();
  }
}

/**
 * Token validation rate limiter middleware
 *
 * Higher limits for service-to-service token validation.
 *
 * Usage: router.post('/validate', validateRateLimiter, handler)
 */
async function validateRateLimiter(req, res, next) {
  const ip = getClientIP(req);
  const requestId = req.requestId || req.headers['x-request-id'];
  const config = getActiveConfig();

  // Skip rate limiting for whitelisted IPs
  if (isWhitelisted(ip)) {
    return next();
  }

  try {
    const limiter = getLimiter('validateByIP');
    await limiter.consume(ip, 1);
    next();
  } catch (error) {
    if (error.remainingPoints !== undefined) {
      logger.warn('Token validation rate limit exceeded', {
        ip,
        requestId,
        blockedFor: error.msBeforeNext
      });

      setRateLimitHeaders(res, error, config.auth.validate.ip.points);
      return sendRateLimitResponse(
        res,
        error,
        'Too many validation requests. Please try again later.',
        requestId
      );
    }

    logger.error('Token validation rate limit check failed', {
      error: error.message,
      ip,
      requestId
    });
    next();
  }
}

/**
 * Password reset rate limiter middleware
 *
 * Limits password reset requests per IP and email.
 *
 * Usage: router.post('/reset-password', passwordResetRateLimiter, handler)
 */
async function passwordResetRateLimiter(req, res, next) {
  const ip = getClientIP(req);
  const email = (req.body?.email || '').toLowerCase().trim();
  const requestId = req.requestId || req.headers['x-request-id'];
  const config = getActiveConfig();

  // Skip rate limiting for whitelisted IPs
  if (isWhitelisted(ip)) {
    return next();
  }

  try {
    // Check and consume IP-based limit
    const ipLimiter = getLimiter('resetByIP');
    await ipLimiter.consume(ip, 1);

    // Check and consume email-based limit if email provided
    if (email) {
      const emailLimiter = getLimiter('resetByEmail');
      await emailLimiter.consume(email, 1);
    }

    next();
  } catch (error) {
    if (error.remainingPoints !== undefined) {
      logger.warn('Password reset rate limit exceeded', {
        ip,
        email: email || '(not provided)',
        requestId,
        blockedFor: error.msBeforeNext
      });

      setRateLimitHeaders(res, error, config.auth.passwordReset.ip.points);
      return sendRateLimitResponse(
        res,
        error,
        'Too many password reset requests. Please try again later.',
        requestId
      );
    }

    logger.error('Password reset rate limit check failed', {
      error: error.message,
      ip,
      requestId
    });
    next();
  }
}

/**
 * Download tracking rate limiter middleware
 *
 * Limits download tracking API requests per IP.
 * Used by portal-bff for analytics endpoint.
 *
 * Usage: router.post('/track', downloadTrackingRateLimiter, handler)
 */
async function downloadTrackingRateLimiter(req, res, next) {
  const ip = getClientIP(req);
  const requestId = req.requestId || req.headers['x-request-id'];
  const config = getActiveConfig();

  // Skip rate limiting for whitelisted IPs
  if (isWhitelisted(ip)) {
    return next();
  }

  try {
    const limiter = getLimiter('downloadTracking');
    await limiter.consume(ip, 1);
    next();
  } catch (error) {
    if (error.remainingPoints !== undefined) {
      logger.warn('Download tracking rate limit exceeded', {
        ip,
        requestId,
        blockedFor: error.msBeforeNext
      });

      setRateLimitHeaders(res, error, config.downloadTracking?.points || 30);
      return sendRateLimitResponse(
        res,
        error,
        'Too many tracking requests. Please try again later.',
        requestId
      );
    }

    logger.error('Download tracking rate limit check failed', {
      error: error.message,
      ip,
      requestId
    });
    next();
  }
}

/**
 * Create a custom rate limiter for any endpoint
 *
 * @param {string} name - Unique name for this limiter
 * @param {Object} options - Rate limiter options
 * @param {number} options.points - Max requests per window
 * @param {number} options.duration - Window duration in seconds
 * @param {number} options.blockDuration - Block duration in seconds (optional)
 * @returns {Function} Express middleware
 */
function createEndpointLimiter(name, options) {
  const keyPrefix = `endpoint:${name}`;
  const limiter = createLimiter(keyPrefix, options, redisClientRef);
  limiters[`endpoint:${name}`] = limiter;

  return async (req, res, next) => {
    const ip = getClientIP(req);
    const requestId = req.requestId || req.headers['x-request-id'];

    // Skip rate limiting for authenticated admin users
    const role = req.auth?.role || req.headers['x-auth-role'];
    if (role === 'admin' || role === 'super_admin') {
      return next();
    }

    try {
      await limiter.consume(ip, 1);
      next();
    } catch (error) {
      if (error.remainingPoints !== undefined) {
        logger.warn(`Rate limit exceeded for ${name}`, {
          ip,
          requestId,
          blockedFor: error.msBeforeNext
        });

        setRateLimitHeaders(res, error, options.points);
        return sendRateLimitResponse(
          res,
          error,
          `Too many requests to ${name}. Please try again later.`,
          requestId
        );
      }

      logger.error(`Rate limit check failed for ${name}`, {
        error: error.message,
        ip,
        requestId
      });
      next();
    }
  };
}

/**
 * Reset all limiters (for testing)
 */
function reset() {
  limiters = {};
  redisClientRef = null;
}

module.exports = {
  // Initialization
  initialize,
  getLimiter,
  reset,
  getActiveConfig,

  // Global middleware
  globalRateLimiter,

  // Auth-specific middleware
  loginRateLimiter,
  consumeLoginPoints,
  changePasswordRateLimiter,
  registerRateLimiter,
  validateRateLimiter,
  passwordResetRateLimiter,

  // Portal-BFF middleware
  downloadTrackingRateLimiter,

  // Custom limiter factory
  createEndpointLimiter,

  // IP Whitelist (for security scanning)
  isWhitelisted,
  refreshWhitelist,

  // Utilities
  getClientIP,
  setRateLimitHeaders,
  sendRateLimitResponse,

  // Configuration (for reference/override)
  DEFAULT_CONFIG
};
