/**
 * Redis Pub/Sub Manager for WebSocket Gateway
 *
 * Manages Redis subscriptions for real-time sync notifications.
 * Uses the same connection patterns as @notely/cache.
 */

const redis = require('redis');

class PubSubManager {
  constructor({ logger }) {
    this.logger = logger;
    this.subscriber = null;
    this.subscriptions = new Map(); // channel -> Set<callback>
    this.userChannels = new Map(); // userId -> channel name
  }

  /**
   * Build Redis URL from environment variables
   * @private
   */
  _buildRedisUrl() {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = process.env.REDIS_PORT || '6379';
    const password = process.env.REDIS_PASSWORD || '';

    let credentials = '';
    if (password) {
      credentials = `:${encodeURIComponent(password)}@`;
    }

    return `redis://${credentials}${host}:${port}`;
  }

  /**
   * Initialize Redis subscriber connection
   */
  async initialize() {
    if (this.subscriber) {
      this.logger?.warn?.('PubSubManager already initialized');
      return;
    }

    const redisUrl = process.env.REDIS_URL || this._buildRedisUrl();
    const redisConfig = {
      url: redisUrl,
      socket: {
        connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '5000', 10),
        reconnectStrategy: (retries) => {
          const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES || '10', 10);
          if (retries > maxRetries) {
            this.logger?.error?.('Redis subscriber retry limit exceeded');
            return new Error('Redis retry limit exceeded');
          }
          const delay = Math.min(retries * 100, 3000);
          this.logger?.warn?.(`Redis subscriber reconnecting in ${delay}ms (attempt ${retries}/${maxRetries})`);
          return delay;
        }
      }
    };

    this.subscriber = redis.createClient(redisConfig);

    this.subscriber.on('error', (err) => {
      this.logger?.error?.('Redis subscriber error', { error: err.message });
    });

    this.subscriber.on('connect', () => {
      this.logger?.info?.('Redis subscriber connected');
    });

    this.subscriber.on('ready', () => {
      this.logger?.info?.('Redis subscriber ready');
    });

    await this.subscriber.connect();
    this.logger?.info?.('PubSubManager initialized');
  }

  /**
   * Subscribe to sync notifications for a user
   *
   * @param {string} userId - User ID
   * @param {function} callback - Function to call when notification received
   */
  async subscribeUser(userId, callback) {
    const channel = `sync:user:${userId}`;

    // Track subscription
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());

      // Subscribe to Redis channel
      await this.subscriber.subscribe(channel, (message) => {
        const callbacks = this.subscriptions.get(channel);
        if (callbacks) {
          for (const cb of callbacks) {
            try {
              const parsed = JSON.parse(message);
              cb(parsed);
            } catch (err) {
              this.logger?.error?.('Failed to process pub/sub message', {
                channel,
                error: err.message
              });
            }
          }
        }
      });

      this.logger?.debug?.('Subscribed to Redis channel', { channel });
    }

    this.subscriptions.get(channel).add(callback);
    this.userChannels.set(userId, channel);
  }

  /**
   * Unsubscribe from sync notifications for a user
   *
   * @param {string} userId - User ID
   * @param {function} callback - The callback to remove
   */
  async unsubscribeUser(userId, callback) {
    const channel = `sync:user:${userId}`;
    const callbacks = this.subscriptions.get(channel);

    if (!callbacks) {
      return;
    }

    callbacks.delete(callback);

    // If no more callbacks for this channel, unsubscribe from Redis
    if (callbacks.size === 0) {
      this.subscriptions.delete(channel);
      this.userChannels.delete(userId);

      try {
        await this.subscriber.unsubscribe(channel);
        this.logger?.debug?.('Unsubscribed from Redis channel', { channel });
      } catch (err) {
        this.logger?.warn?.('Failed to unsubscribe from Redis channel', {
          channel,
          error: err.message
        });
      }
    }
  }

  /**
   * Check if user has active subscriptions
   *
   * @param {string} userId - User ID
   * @returns {boolean}
   */
  isUserSubscribed(userId) {
    const channel = `sync:user:${userId}`;
    const callbacks = this.subscriptions.get(channel);
    return callbacks && callbacks.size > 0;
  }

  /**
   * Get statistics
   *
   * @returns {{ subscribedChannels: number, subscribedUsers: number }}
   */
  getStats() {
    return {
      subscribedChannels: this.subscriptions.size,
      subscribedUsers: this.userChannels.size
    };
  }

  /**
   * Health check
   *
   * @returns {Promise<{ status: string, duration_ms?: number, error?: string }>}
   */
  async healthCheck() {
    try {
      if (!this.subscriber) {
        return { status: 'unhealthy', error: 'Subscriber not initialized' };
      }

      const start = Date.now();
      await this.subscriber.ping();
      const duration = Date.now() - start;

      return {
        status: 'healthy',
        duration_ms: duration
      };
    } catch (error) {
      this.logger?.error?.('Redis health check failed', { error: error.message });
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
        this.logger?.info?.('Redis subscriber closed');
      } catch (err) {
        this.logger?.warn?.('Error closing Redis subscriber', { error: err.message });
      }
      this.subscriber = null;
    }
    this.subscriptions.clear();
    this.userChannels.clear();
  }
}

module.exports = PubSubManager;
