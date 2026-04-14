import { createClient, RedisClientType } from 'redis';
import { config } from '../config/env';

let client: RedisClientType | null = null;

/**
 * Build a Redis connection URL from discrete environment variables.
 */
function buildRedisUrl(): string {
  if (config.redis.url) {
    return config.redis.url;
  }

  const host = config.redis.host;
  const port = config.redis.port;
  const password = config.redis.password;

  if (password) {
    // URL-encode the password to handle special characters
    const encodedPassword = encodeURIComponent(password);
    return `redis://:${encodedPassword}@${host}:${port}`;
  }

  return `redis://${host}:${port}`;
}

/**
 * Initialize Redis connection
 */
export async function initializeRedis(): Promise<void> {
  if (client) {
    console.warn('Redis already initialized');
    return;
  }

  try {
    const redisUrl = buildRedisUrl();
    const redisConfig = {
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries: number) => {
          const maxRetries = 3;

          if (retries > maxRetries) {
            console.error('Redis connection retry limit exceeded');
            return new Error('Redis retry limit exceeded');
          }

          const delay = Math.min(retries * 100, 3000);
          console.warn(`Redis reconnecting in ${delay}ms (attempt ${retries}/${maxRetries})`);
          return delay;
        },
      },
    };

    client = createClient(redisConfig);

    client.on('error', (err) => {
      console.error('Redis client error:', err.message);
    });

    client.on('connect', () => {
      console.log('Redis client connected');
    });

    client.on('ready', () => {
      console.log('Redis client ready');
    });

    await client.connect();
    await client.ping();

    console.log('Redis connection established successfully');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    throw error;
  }
}

/**
 * Get Redis client instance
 */
export function getRedisClient(): RedisClientType {
  if (!client) {
    throw new Error('Redis not initialized. Call initializeRedis() first.');
  }
  return client;
}

/**
 * Health check
 */
export async function redisHealthCheck(): Promise<{ status: string; duration_ms?: number; error?: string }> {
  try {
    if (!client) {
      return { status: 'unhealthy', error: 'Redis not initialized' };
    }

    const start = Date.now();
    await client.ping();
    const duration = Date.now() - start;

    return {
      status: 'healthy',
      duration_ms: duration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Redis health check failed:', errorMessage);
    return {
      status: 'unhealthy',
      error: errorMessage,
    };
  }
}

/**
 * Initialize Redis connection (alias for initializeRedis)
 */
export async function initRedis(): Promise<void> {
  return initializeRedis();
}

/**
 * Ping Redis to check connectivity
 */
export async function pingRedis(): Promise<string> {
  if (!client) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return client.ping();
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    console.log('Redis connection closed');
  }
}
