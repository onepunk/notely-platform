const redis = require('redis');
const logger = require('../logger');

let client;
let publisher;
let subscriber;

/**
 * Build a Redis connection URL from discrete environment variables.
 *
 * @returns {string} Redis URL (e.g., redis://user:pass@host:port)
 */
function buildRedisUrlFromEnv() {
  const host = process.env.REDIS_HOST || process.env.REDIS_SERVER || '127.0.0.1';
  const port = process.env.REDIS_PORT || '6379';
  const username = process.env.REDIS_USERNAME || process.env.REDIS_USER || '';
  const password = process.env.REDIS_PASSWORD || process.env.REDIS_PASS || '';

  let credentials = '';

  if (username && password) {
    credentials = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (password && !username) {
    credentials = `:${encodeURIComponent(password)}@`;
  } else if (username && !password) {
    credentials = `${encodeURIComponent(username)}@`;
  }

  return `redis://${credentials}${host}:${port}`;
}

/**
 * Redis Connection Manager
 *
 * Provides:
 * - Cache operations (get, set, delete)
 * - Session management
 * - Job queue (pub/sub)
 * - Idempotency keys
 * - Rate limiting
 * - Leader election
 *
 * Configuration via environment variables:
 * - REDIS_URL: Full Redis connection string
 * - REDIS_MAX_RETRIES: Max connection retry attempts (default: 3)
 * - REDIS_CONNECT_TIMEOUT_MS: Connection timeout (default: 5000)
 * - REDIS_COMMAND_TIMEOUT_MS: Command timeout (default: 5000)
 */

/**
 * Initialize Redis connections
 *
 * Creates three Redis clients:
 * - Main client for cache/session operations
 * - Publisher for job queue
 * - Subscriber for job queue notifications
 *
 * @returns {Promise<void>}
 */
async function initialize() {
  if (client) {
    logger.warn('Redis already initialized');
    return;
  }

  try {
    const redisUrl = process.env.REDIS_URL || buildRedisUrlFromEnv();
    const redisConfig = {
      url: redisUrl,
      socket: {
        connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '5000', 10),
        reconnectStrategy: (retries) => {
          const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES || '3', 10);

          if (retries > maxRetries) {
            logger.error('Redis connection retry limit exceeded');
            return new Error('Redis retry limit exceeded');
          }

          const delay = Math.min(retries * 100, 3000);
          logger.warn(`Redis reconnecting in ${delay}ms (attempt ${retries}/${maxRetries})`);
          return delay;
        }
      }
    };

    // Main Redis client
    client = redis.createClient(redisConfig);

    // Publisher client for job queue
    publisher = redis.createClient(redisConfig);

    // Subscriber client for real-time updates
    subscriber = redis.createClient(redisConfig);

    // Error handlers
    client.on('error', (err) => {
      logger.error('Redis client error', { error: err.message });
    });

    publisher.on('error', (err) => {
      logger.error('Redis publisher error', { error: err.message });
    });

    subscriber.on('error', (err) => {
      logger.error('Redis subscriber error', { error: err.message });
    });

    // Connection event handlers
    client.on('connect', () => {
      logger.info('Redis client connected');
    });

    client.on('ready', () => {
      logger.info('Redis client ready');
    });

    // Connect all clients
    await client.connect();
    await publisher.connect();
    await subscriber.connect();

    // Test connection
    await client.ping();

    logger.info('Redis connections established successfully');

    // Initialize job queue channels
    await initializeJobQueue();

  } catch (error) {
    logger.error('Failed to connect to Redis', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Initialize job queue subscribers
 *
 * @private
 */
async function initializeJobQueue() {
  // Subscribe to job completion notifications
  await subscriber.subscribe('job_completed', (message) => {
    try {
      const jobResult = JSON.parse(message);
      logger.info(`Job completed: ${jobResult.jobId} - ${jobResult.jobType}`);
    } catch (error) {
      logger.error('Error processing job completion message', { error: error.message });
    }
  });

  await subscriber.subscribe('job_failed', (message) => {
    try {
      const jobResult = JSON.parse(message);
      logger.error(`Job failed: ${jobResult.jobId} - ${jobResult.error}`);
    } catch (error) {
      logger.error('Error processing job failure message', { error: error.message });
    }
  });

  logger.info('Job queue subscribers initialized');
}

// =============================================================================
// Job Queue Operations
// =============================================================================

/**
 * Add a job to the queue
 *
 * @param {string} jobType - Type of job
 * @param {Object} payload - Job data
 * @param {Object} options - Job options
 * @param {number} options.priority - Job priority (default: 0)
 * @param {number} options.maxAttempts - Max retry attempts (default: 3)
 * @param {number} options.delay - Delay before execution (ms)
 * @returns {Promise<string>} Job ID
 */
async function addJob(jobType, payload, options = {}) {
  const jobId = `job:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  const job = {
    id: jobId,
    type: jobType,
    payload,
    priority: options.priority || 0,
    attempts: 0,
    maxAttempts: options.maxAttempts || 3,
    scheduledFor: options.delay ? Date.now() + options.delay : Date.now(),
    createdAt: Date.now()
  };

  const queueKey = `queue:${jobType}`;
  const priority = job.priority || 0;

  await client.zAdd(queueKey, {
    score: priority,
    value: JSON.stringify(job)
  });

  logger.info(`Job added to queue: ${jobId} (${jobType})`);
  return jobId;
}

/**
 * Get next job from queue
 *
 * @param {string} jobType - Type of job
 * @returns {Promise<Object|null>} Job data or null
 */
async function getNextJob(jobType) {
  const queueKey = `queue:${jobType}`;
  const jobs = await client.zRange(queueKey, 0, 0);

  if (jobs.length === 0) {
    return null;
  }

  const jobData = JSON.parse(jobs[0]);

  // Check if job is scheduled for future
  if (jobData.scheduledFor > Date.now()) {
    return null;
  }

  // Remove job from queue
  await client.zRem(queueKey, jobs[0]);

  return jobData;
}

/**
 * Mark job as completed
 *
 * @param {string} jobId - Job ID
 * @param {Object} result - Job result
 * @returns {Promise<void>}
 */
async function completeJob(jobId, result = {}) {
  await publisher.publish('job_completed', JSON.stringify({
    jobId,
    result,
    completedAt: Date.now()
  }));
}

/**
 * Mark job as failed
 *
 * @param {string} jobId - Job ID
 * @param {Error} error - Error that occurred
 * @param {boolean} retryable - Whether job can be retried
 * @returns {Promise<void>}
 */
async function failJob(jobId, error, retryable = true) {
  await publisher.publish('job_failed', JSON.stringify({
    jobId,
    error: error.message || error,
    retryable,
    failedAt: Date.now()
  }));
}

// =============================================================================
// Cache Operations
// =============================================================================

/**
 * Set cache value
 *
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttlSeconds - TTL in seconds (default: 3600)
 * @returns {Promise<void>}
 */
async function setCache(key, value, ttlSeconds = 3600) {
  const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
  await client.setEx(key, ttlSeconds, serializedValue);
}

/**
 * Get cache value
 *
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Cached value or null
 */
async function getCache(key) {
  const value = await client.get(key);
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Delete cache value
 *
 * @param {string} key - Cache key
 * @returns {Promise<number>} Number of keys deleted
 */
async function deleteCache(key) {
  return await client.del(key);
}

/**
 * Check if cache key exists
 *
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} True if exists
 */
async function existsCache(key) {
  return (await client.exists(key)) > 0;
}

// =============================================================================
// Session Operations
// =============================================================================

/**
 * Set session data
 *
 * @param {string} sessionId - Session ID
 * @param {Object} data - Session data
 * @param {number} ttlSeconds - TTL in seconds (default: 86400 - 24 hours)
 * @returns {Promise<void>}
 */
async function setSession(sessionId, data, ttlSeconds = 86400) {
  await client.setEx(`session:${sessionId}`, ttlSeconds, JSON.stringify(data));
}

/**
 * Get session data
 *
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object|null>} Session data or null
 */
async function getSession(sessionId) {
  const data = await client.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Delete session
 *
 * @param {string} sessionId - Session ID
 * @returns {Promise<number>} Number of keys deleted
 */
async function deleteSession(sessionId) {
  return await client.del(`session:${sessionId}`);
}

// =============================================================================
// Idempotency Operations
// =============================================================================

/**
 * Check if request is idempotent (already processed)
 *
 * @param {string} idempotencyKey - Idempotency key
 * @param {string} userId - User ID
 * @returns {Promise<any|null>} Cached response or null
 */
async function checkIdempotency(idempotencyKey, userId) {
  const key = `idempotency:${userId}:${idempotencyKey}`;
  const result = await client.get(key);

  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

/**
 * Store idempotency response
 *
 * @param {string} idempotencyKey - Idempotency key
 * @param {string} userId - User ID
 * @param {any} response - Response to cache
 * @param {number} ttlSeconds - TTL in seconds (default: 3600)
 * @returns {Promise<void>}
 */
async function setIdempotency(idempotencyKey, userId, response, ttlSeconds = 3600) {
  const key = `idempotency:${userId}:${idempotencyKey}`;
  const serializedResponse = typeof response === 'object' ? JSON.stringify(response) : response;
  await client.setEx(key, ttlSeconds, serializedResponse);
}

/**
 * Delete idempotency cache
 *
 * @param {string} idempotencyKey - Idempotency key
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of keys deleted
 */
async function deleteIdempotency(idempotencyKey, userId) {
  const key = `idempotency:${userId}:${idempotencyKey}`;
  return await client.del(key);
}

// =============================================================================
// Rate Limiting Operations
// =============================================================================

/**
 * Check rate limit
 *
 * @param {string} userId - User ID or IP
 * @param {string} endpoint - Endpoint identifier
 * @param {number} limit - Max requests per window (default: 100)
 * @param {number} windowSeconds - Time window in seconds (default: 3600)
 * @returns {Promise<Object>} Rate limit status
 */
async function checkRateLimit(userId, endpoint, limit = 100, windowSeconds = 3600) {
  const key = `rate_limit:${userId}:${endpoint}`;
  const current = await client.get(key);

  if (!current) {
    // First request in window
    await client.setEx(key, windowSeconds, '1');
    return {
      allowed: true,
      remaining: limit - 1,
      resetTime: Date.now() + (windowSeconds * 1000)
    };
  }

  const count = parseInt(current);
  if (count >= limit) {
    const ttl = await client.ttl(key);
    return {
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + (ttl * 1000)
    };
  }

  await client.incr(key);
  const ttl = await client.ttl(key);
  return {
    allowed: true,
    remaining: limit - count - 1,
    resetTime: Date.now() + (ttl * 1000)
  };
}

// =============================================================================
// Leader Election (for distributed recording coordination)
// =============================================================================

/**
 * Attempt to become leader for a meeting
 *
 * @param {string} meetingId - Meeting ID
 * @param {string} clientId - Client ID
 * @param {Object} clientData - Client metadata
 * @returns {Promise<boolean>} True if elected as leader
 */
async function electLeader(meetingId, clientId, clientData) {
  const key = `leader:${meetingId}`;
  const lockKey = `lock:${key}`;

  // Try to acquire lock
  const lockAcquired = await client.set(lockKey, clientId, {
    PX: 10000, // 10 second lock
    NX: true
  });

  if (!lockAcquired) {
    return false;
  }

  try {
    // Check if there's already a leader
    const currentLeader = await client.hGetAll(key);

    if (Object.keys(currentLeader).length === 0) {
      // No leader exists, become the leader
      await client.hSet(key, {
        clientId,
        ...clientData,
        electedAt: Date.now()
      });
      await client.expire(key, 60); // Leader expires in 60 seconds
      return true;
    }

    // Compare with current leader (lower ping wins)
    const currentPing = parseFloat(currentLeader.ping) || Infinity;
    const newPing = parseFloat(clientData.ping) || Infinity;

    if (newPing < currentPing) {
      await client.hSet(key, {
        clientId,
        ...clientData,
        electedAt: Date.now()
      });
      await client.expire(key, 60);
      return true;
    }

    return false;
  } finally {
    // Release lock
    await client.del(lockKey);
  }
}

/**
 * Get current leader for a meeting
 *
 * @param {string} meetingId - Meeting ID
 * @returns {Promise<Object>} Leader data
 */
async function getLeader(meetingId) {
  const key = `leader:${meetingId}`;
  return await client.hGetAll(key);
}

/**
 * Renew leadership
 *
 * @param {string} meetingId - Meeting ID
 * @param {string} clientId - Client ID
 * @returns {Promise<boolean>} True if renewed
 */
async function renewLeadership(meetingId, clientId) {
  const key = `leader:${meetingId}`;
  const leader = await client.hGetAll(key);

  if (leader.clientId === clientId) {
    await client.expire(key, 60);
    return true;
  }

  return false;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get Redis client instance
 *
 * @returns {RedisClient} Redis client
 * @throws {Error} If not initialized
 */
function getClient() {
  if (!client) {
    throw new Error('Redis not initialized. Call initialize() first.');
  }
  return client;
}

/**
 * Health check
 *
 * @returns {Promise<Object>} Health status
 */
async function healthCheck() {
  try {
    const start = Date.now();
    await client.ping();
    const duration = Date.now() - start;

    return {
      status: 'healthy',
      duration_ms: duration
    };
  } catch (error) {
    logger.error('Redis health check failed', { error: error.message });
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

/**
 * Gracefully close all Redis connections
 *
 * @returns {Promise<void>}
 */
async function close() {
  if (client) await client.quit();
  if (publisher) await publisher.quit();
  if (subscriber) await subscriber.quit();
  logger.info('Redis connections closed');
}

module.exports = {
  initialize,
  getClient,
  healthCheck,
  close,

  // Job queue
  addJob,
  getNextJob,
  completeJob,
  failJob,

  // Cache
  setCache,
  getCache,
  deleteCache,
  existsCache,

  // Sessions
  setSession,
  getSession,
  deleteSession,

  // Leader election
  electLeader,
  getLeader,
  renewLeadership,

  // Idempotency
  checkIdempotency,
  setIdempotency,
  deleteIdempotency,

  // Rate limiting
  checkRateLimit
};
