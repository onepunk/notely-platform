import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

type RawEnv = {
  SUMMARIES_SERVICE_PORT?: string;
  JWT_PUBLIC_KEY?: string;
  SUMMARIES_DATABASE_URL?: string;
  DATABASE_URL?: string;
  LLM_GATEWAY_URL: string;
  LICENSE_SERVICE_URL: string;
  REDIS_HOST?: string;
  REDIS_PORT?: string;
  REDIS_PASSWORD?: string;
};

const envSchema = z.object({
  SUMMARIES_SERVICE_PORT: z
    .string()
    .optional()
    .refine((value) => (value ? Number.isInteger(Number(value)) : true), {
      message: 'SUMMARIES_SERVICE_PORT must be a number',
    }),
  JWT_PUBLIC_KEY: z.string().optional(),
  SUMMARIES_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  LLM_GATEWAY_URL: z.string({ required_error: 'LLM_GATEWAY_URL is required' }),
  LICENSE_SERVICE_URL: z.string({ required_error: 'LICENSE_SERVICE_URL is required' }),
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

function normalizePem(value?: string): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/\\n/g, '\n');
}

export const config = {
  port: parsed.SUMMARIES_SERVICE_PORT ? Number(parsed.SUMMARIES_SERVICE_PORT) : 3207,
  auth: {
    jwtPublicKey: normalizePem(parsed.JWT_PUBLIC_KEY),
  },
  database: {
    connectionString: parsed.SUMMARIES_DATABASE_URL ?? parsed.DATABASE_URL ?? null,
  },
  llmGateway: {
    url: parsed.LLM_GATEWAY_URL,
  },
  license: {
    url: parsed.LICENSE_SERVICE_URL,
  },
  redis: {
    host: parsed.REDIS_HOST || 'redis',
    port: parsed.REDIS_PORT ? Number(parsed.REDIS_PORT) : 6379,
    password: parsed.REDIS_PASSWORD || '',
  },
};
