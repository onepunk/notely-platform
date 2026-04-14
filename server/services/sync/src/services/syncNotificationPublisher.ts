/**
 * Sync Notification Publisher
 *
 * Publishes sync notifications to Redis for real-time WebSocket delivery.
 * Used by the merge endpoint to notify other devices when changes are made.
 */

import { createClient, RedisClientType } from 'redis';
import { config } from '../config/env';

let publisher: RedisClientType | null = null;
let isInitializing = false;
let initializePromise: Promise<void> | null = null;

/**
 * Build Redis URL from config
 */
function buildRedisUrl(): string {
  const { host, port, password } = config.redis;

  let credentials = '';
  if (password) {
    credentials = `:${encodeURIComponent(password)}@`;
  }

  return `redis://${credentials}${host}:${port}`;
}

/**
 * Initialize the Redis publisher connection
 * Safe to call multiple times - will only initialize once
 */
export async function initializeSyncPublisher(): Promise<void> {
  if (publisher) {
    return;
  }

  // Prevent concurrent initialization
  if (isInitializing && initializePromise) {
    return initializePromise;
  }

  isInitializing = true;

  initializePromise = (async () => {
    try {
      const redisUrl = buildRedisUrl();

      publisher = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('[SyncPublisher] Redis retry limit exceeded');
              return new Error('Redis retry limit exceeded');
            }
            const delay = Math.min(retries * 100, 3000);
            console.warn(`[SyncPublisher] Redis reconnecting in ${delay}ms (attempt ${retries}/10)`);
            return delay;
          }
        }
      });

      publisher.on('error', (err) => {
        console.error('[SyncPublisher] Redis error:', err.message);
      });

      publisher.on('connect', () => {
        console.log('[SyncPublisher] Redis connected');
      });

      publisher.on('ready', () => {
        console.log('[SyncPublisher] Redis ready');
      });

      await publisher.connect();
      console.log('[SyncPublisher] Initialized successfully');
    } catch (error: any) {
      console.error('[SyncPublisher] Failed to initialize:', error.message);
      publisher = null;
      throw error;
    } finally {
      isInitializing = false;
    }
  })();

  return initializePromise;
}

/**
 * Publish a sync notification to Redis
 *
 * This notifies the ws-gateway service that a user's data has changed,
 * allowing it to push notifications to the user's other connected devices.
 *
 * @param userId - The user whose data changed
 * @param sourceDeviceId - The device that made the change (will be excluded from notification)
 * @param changesCount - Number of entities that changed
 */
export async function publishSyncNotification(
  userId: string,
  sourceDeviceId: string,
  changesCount: number
): Promise<void> {
  // Lazily initialize if not already done
  if (!publisher) {
    try {
      await initializeSyncPublisher();
    } catch (error: any) {
      console.warn('[SyncPublisher] Could not initialize, skipping notification:', error.message);
      return;
    }
  }

  if (!publisher) {
    console.warn('[SyncPublisher] Publisher not available, skipping notification');
    return;
  }

  const channel = `sync:user:${userId}`;
  const message = JSON.stringify({
    type: 'sync:needed',
    timestamp: Date.now(),
    source_device_id: sourceDeviceId,
    changes_count: changesCount
  });

  try {
    await publisher.publish(channel, message);
    console.log('[SyncPublisher] Published notification', { userId, channel, changesCount });
  } catch (error: any) {
    console.error('[SyncPublisher] Failed to publish:', error.message);
    // Don't throw - this is a non-critical operation
  }
}

/**
 * Close the Redis publisher connection
 * Call this during graceful shutdown
 */
export async function closeSyncPublisher(): Promise<void> {
  if (publisher) {
    try {
      await publisher.quit();
      console.log('[SyncPublisher] Connection closed');
    } catch (error: any) {
      console.error('[SyncPublisher] Error closing connection:', error.message);
    }
    publisher = null;
  }
}

/**
 * Check if the publisher is connected
 */
export function isSyncPublisherConnected(): boolean {
  return publisher !== null && publisher.isOpen;
}
