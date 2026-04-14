import { z } from 'zod';

const orderEnum = z.enum(['asc', 'desc']);

const usersSortEnum = z.enum(['email', 'sync_version', 'last_sync', 'device_count', 'sync_success_rate']);

export const usersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: usersSortEnum.default('last_sync'),
  order: orderEnum.default('desc'),
  search: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) {
        return '';
      }
      const normalized = Array.isArray(value) ? value[0] : value;
      return normalized.trim();
    }),
});

export const devicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  user_id: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) {
        return '';
      }
      return Array.isArray(value) ? value[0] : value;
    }),
  search: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) {
        return '';
      }
      const normalized = Array.isArray(value) ? value[0] : value;
      return normalized.trim();
    }),
});

const hoursSchema = z.coerce.number().int().min(1).max(24 * 30).default(24);

export const conflictsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  hours: hoursSchema.default(24),
});

export const corruptionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  severity: z
    .union([z.literal(''), z.literal('low'), z.literal('medium'), z.literal('high'), z.literal('critical')])
    .optional()
    .transform((value) => value ?? ''),
  hours: hoursSchema.default(72),
});
