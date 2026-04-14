const { Pool } = require('pg');

let pool;
let logger;

/**
 * Build a PostgreSQL connection string from discrete env vars.
 *
 * @returns {string|null} connection string or null if required pieces missing
 */
function buildConnectionStringFromEnv() {
  const host = process.env.DB_HOST || process.env.POSTGRES_HOST;
  const port = process.env.DB_PORT || process.env.POSTGRES_PORT || '5432';
  const database = process.env.DB_NAME || process.env.POSTGRES_DB;
  const user = process.env.DB_USER || process.env.POSTGRES_USER;
  const password = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD;

  if (!host || !database || !user) {
    return null;
  }

  const authPart = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  const credentials = password ? `${authPart}@` : `${authPart}@`;
  return `postgresql://${credentials}${host}:${port}/${database}`;
}

/**
 * PostgreSQL Connection Pool Manager
 *
 * Implements production-ready connection pooling with:
 * - Configurable pool size and timeouts
 * - Health checks
 * - Transaction helpers
 * - Graceful shutdown
 * - Connection monitoring
 *
 * Configuration via environment variables:
 * - DATABASE_URL: Full PostgreSQL connection string
 * - DB_POOL_MAX: Maximum pool size (default: 20)
 * - DB_POOL_MIN: Minimum pool size (default: 5)
 * - DB_POOL_IDLE_TIMEOUT_MS: Idle connection timeout (default: 30000)
 * - DB_POOL_CONNECTION_TIMEOUT_MS: Connection acquisition timeout (default: 2000)
 * - DB_STATEMENT_TIMEOUT_MS: Statement timeout (default: 30000)
 * - DB_QUERY_TIMEOUT_MS: Query timeout (default: 25000)
 */

/**
 * Initialize the connection pool
 *
 * @param {Object} customLogger - Optional logger instance (will use console if not provided)
 * @returns {Promise<Pool>} Initialized pool instance
 */
async function initialize(customLogger) {
  logger = customLogger || console;

  if (pool) {
    logger.warn('Database pool already initialized');
    return pool;
  }

  const connectionString = process.env.DATABASE_URL || buildConnectionStringFromEnv();

  if (!connectionString) {
    throw new Error('DATABASE_URL or DB_{HOST,NAME,USER} environment variables must be set for database connection');
  }

  const config = {
    connectionString,

    // SSL configuration (enabled in production)
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,

    // Connection pool limits
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '5', 10),

    // Timeout configuration
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '2000', 10),

    // Statement timeout (server-side)
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '25000', 10),

    // Application name for monitoring
    application_name: `notely-platform-${process.env.SERVICE_NAME || 'shared'}-${process.env.NODE_ENV || 'development'}`
  };

  try {
    pool = new Pool(config);

    // Error handler for pool errors
    pool.on('error', (err, client) => {
      logger.error('Unexpected error on idle database client', {
        error: err.message,
        stack: err.stack
      });
    });

    // Connect event for monitoring
    pool.on('connect', (client) => {
      logger.debug('New database client connected', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      });
    });

    // Acquire event for monitoring
    pool.on('acquire', (client) => {
      logger.debug('Client acquired from pool', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      });
    });

    // Remove event for monitoring
    pool.on('remove', (client) => {
      logger.debug('Client removed from pool', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      });
    });

    // Test connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW(), current_database(), current_user');
    client.release();

    logger.info('PostgreSQL connection pool established successfully', {
      database: result.rows[0].current_database,
      user: result.rows[0].current_user,
      timestamp: result.rows[0].now,
      config: {
        max: config.max,
        min: config.min,
        idleTimeoutMs: config.idleTimeoutMillis,
        connectionTimeoutMs: config.connectionTimeoutMillis
      }
    });

    return pool;
  } catch (error) {
    logger.error('Failed to initialize database connection pool', {
      error: error.message,
      stack: error.stack,
      config: {
        database: config.connectionString?.split('@')[1] || 'unknown',
        max: config.max,
        min: config.min
      }
    });
    throw error;
  }
}

/**
 * Get the current pool instance
 *
 * @returns {Pool} Pool instance
 * @throws {Error} If pool is not initialized
 */
function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initialize() first.');
  }
  return pool;
}

/**
 * Execute a query with automatic error handling
 *
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      logger.warn('Slow query detected', {
        duration_ms: duration,
        query: text.substring(0, 100),
        rows: result.rowCount
      });
    }

    return result;
  } catch (error) {
    const duration = Date.now() - start;

    logger.error('Database query error', {
      error: error.message,
      code: error.code,
      duration_ms: duration,
      query: text.substring(0, 100),
      params: params?.length || 0
    });

    throw error;
  }
}

/**
 * Execute a transaction with automatic rollback on error
 *
 * @param {Function} callback - Async function that receives a client
 * @returns {Promise<any>} Result from callback
 */
async function transaction(callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', {
      error: error.message,
      code: error.code
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database health
 *
 * @returns {Promise<Object>} Health status
 */
async function healthCheck() {
  try {
    const start = Date.now();
    const result = await pool.query('SELECT 1 AS health_check');
    const duration = Date.now() - start;

    return {
      status: 'healthy',
      duration_ms: duration,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      }
    };
  } catch (error) {
    logger.error('Database health check failed', {
      error: error.message,
      code: error.code
    });

    return {
      status: 'unhealthy',
      error: error.message,
      pool: {
        total: pool?.totalCount || 0,
        idle: pool?.idleCount || 0,
        waiting: pool?.waitingCount || 0
      }
    };
  }
}

/**
 * Get current pool statistics
 *
 * @returns {Object} Pool statistics
 */
function getStats() {
  if (!pool) {
    return {
      initialized: false
    };
  }

  return {
    initialized: true,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  };
}

/**
 * Gracefully close the connection pool
 *
 * @returns {Promise<void>}
 */
async function close() {
  if (pool) {
    logger.info('Closing database connection pool...', {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount
    });

    await pool.end();
    pool = null;

    logger.info('Database connection pool closed successfully');
  }
}

module.exports = {
  initialize,
  getPool,
  query,
  transaction,
  healthCheck,
  getStats,
  close
};
