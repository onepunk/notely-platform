import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

type RawEnv = {
  LICENSE_SERVICE_PORT?: string;
  LICENSE_DATABASE_URL?: string;
  DATABASE_URL?: string;
  REDIS_URL?: string;
  REDIS_HOST?: string;
  REDIS_PORT?: string;
  REDIS_PASSWORD?: string;
  JWT_PUBLIC_KEY?: string;
  LICENSE_KEY_DIR?: string;
  LOG_LEVEL?: string;
  PORTAL_DOMAIN?: string;
  PORTAL_PORT?: string;
  PORTAL_URL?: string;
  SUPPORT_SERVICE_URL?: string;
};

const envSchema = z.object({
  LICENSE_SERVICE_PORT: z
    .string()
    .optional()
    .refine((value) => (value ? Number.isInteger(Number(value)) : true), {
      message: 'LICENSE_SERVICE_PORT must be a number',
    }),
  LICENSE_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  LICENSE_KEY_DIR: z.string().optional(),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])
    .optional()
    .default('info'),
  PORTAL_DOMAIN: z.string().optional(),
  PORTAL_PORT: z.string().optional(),
  PORTAL_URL: z.string().optional(),
  SUPPORT_SERVICE_URL: z.string().optional(),
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
  port: parsed.LICENSE_SERVICE_PORT ? Number(parsed.LICENSE_SERVICE_PORT) : 3210,
  database: {
    connectionString: parsed.LICENSE_DATABASE_URL ?? parsed.DATABASE_URL ?? null,
  },
  redis: {
    url: parsed.REDIS_URL ?? null,
    host: parsed.REDIS_HOST ?? 'localhost',
    port: parsed.REDIS_PORT ?? '6379',
    password: parsed.REDIS_PASSWORD ?? null,
  },
  auth: {
    jwtPublicKey: normalizePem(parsed.JWT_PUBLIC_KEY),
  },
  keys: {
    directory: parsed.LICENSE_KEY_DIR ?? path.resolve(__dirname, '../config/keys'),
  },
  portal: {
    domain: parsed.PORTAL_DOMAIN ?? null,
    port: parsed.PORTAL_PORT ?? null,
    url: parsed.PORTAL_URL ?? null,
  },
  supportServiceUrl: parsed.SUPPORT_SERVICE_URL ?? null,
  logLevel: parsed.LOG_LEVEL,
};
