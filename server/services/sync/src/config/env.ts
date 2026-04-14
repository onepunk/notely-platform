import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

type RawEnv = {
  SYNC_SERVICE_PORT?: string;
  JWT_PUBLIC_KEY?: string;
  SYNC_DEVICE_QUOTA?: string;
  SYNC_DATABASE_URL?: string;
  DATABASE_URL?: string;
  SYNC_ADMIN_API_KEY?: string;
  // Redis configuration for real-time sync notifications
  REDIS_HOST?: string;
  REDIS_PORT?: string;
  REDIS_PASSWORD?: string;
};

const envSchema = z.object({
  SYNC_SERVICE_PORT: z
    .string()
    .optional()
    .refine((value) => (value ? Number.isInteger(Number(value)) : true), {
      message: 'SYNC_SERVICE_PORT must be a number',
    }),
  JWT_PUBLIC_KEY: z.string().optional(),
  SYNC_DEVICE_QUOTA: z
    .string()
    .optional()
    .refine((value) => (value ? Number.isInteger(Number(value)) : true), {
      message: 'SYNC_DEVICE_QUOTA must be a number',
    })
    .default('5'),
  SYNC_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SYNC_ADMIN_API_KEY: z.string().optional(),
  // Redis configuration
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z
    .string()
    .optional()
    .refine((value) => (value ? Number.isInteger(Number(value)) : true), {
      message: 'REDIS_PORT must be a number',
    }),
  REDIS_PASSWORD: z.string().optional(),
});

const parsed = envSchema.parse(process.env as RawEnv);

/**
 * Normalize PEM-encoded key by replacing escaped newlines with actual newlines
 * This handles JWT_PUBLIC_KEY values that come from environment variables with \n as literal strings
 */
function normalizePem(value?: string): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/\\n/g, '\n');
}

export const config = {
  port: parsed.SYNC_SERVICE_PORT ? Number(parsed.SYNC_SERVICE_PORT) : 3205,
  auth: {
    jwtPublicKey: normalizePem(parsed.JWT_PUBLIC_KEY),
    deviceQuota: parsed.SYNC_DEVICE_QUOTA ? Number(parsed.SYNC_DEVICE_QUOTA) : 5,
  },
  admin: {
    apiKey: parsed.SYNC_ADMIN_API_KEY || null,
  },
  database: {
    connectionString: parsed.SYNC_DATABASE_URL ?? parsed.DATABASE_URL ?? null,
  },
  redis: {
    host: parsed.REDIS_HOST || 'redis',
    port: parsed.REDIS_PORT ? Number(parsed.REDIS_PORT) : 6379,
    password: parsed.REDIS_PASSWORD || '',
  },
};
