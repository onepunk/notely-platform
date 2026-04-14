import { createClient, RedisClientType } from 'redis';
import { config } from '../config/env';

let redisClient: RedisClientType | null = null;
let isConnected = false;

export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient) {
    redisClient = createClient({
      socket: {
        host: config.redis.host,
        port: config.redis.port,
      },
      password: config.redis.password || undefined,
    });

    redisClient.on('error', (err) => {
      console.error('Redis client error:', err);
      isConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('Redis client connected');
      isConnected = true;
    });

    redisClient.on('disconnect', () => {
      console.log('Redis client disconnected');
      isConnected = false;
    });

    await redisClient.connect();
  }

  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
  }
}

export interface SyncNotification {
  type: 'sync:needed';
  userId: string;
  entityType: 'summary';
  entityId: string;
  action: 'create' | 'update' | 'delete';
  timestamp: number;
  // Fields expected by ws-gateway/handlers/syncNotify.js
  source_device_id?: string;  // Device that made the change (excluded from notification)
  changes_count: number;      // Number of changes
}

export async function notifySyncNeeded(
  userId: string,
  entityId: string,
  action: 'create' | 'update' | 'delete',
  sourceDeviceId?: string
): Promise<void> {
  try {
    const client = await getRedisClient();

    // Include fields expected by ws-gateway syncNotify handler
    const notification: SyncNotification = {
      type: 'sync:needed',
      userId,
      entityType: 'summary',
      entityId,
      action,
      timestamp: Date.now(),
      // ws-gateway uses source_device_id to exclude originating device from notification
      source_device_id: sourceDeviceId,
      changes_count: 1,  // Single entity change
    };

    const channel = `sync:user:${userId}`;
    await client.publish(channel, JSON.stringify(notification));

    console.log(`Published sync notification to ${channel}:`, notification);
  } catch (error) {
    // Log but don't throw - sync notification is not critical to operation
    console.error('Failed to publish sync notification:', error);
  }
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
