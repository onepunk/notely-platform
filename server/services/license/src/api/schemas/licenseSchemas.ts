/**
 * Zod validation schemas for license API endpoints
 *
 * These schemas validate request bodies, query parameters, and responses
 * to ensure data consistency and type safety across the API.
 */

import { z } from 'zod';

/**
 * Schema for license generation request
 */
export const generateLicenseSchema = z
  .object({
    productType: z.enum(['portal', 'desktop', 'notely-ai']).default('portal'),
    type: z.enum(['perpetual', 'subscription', 'trial'], {
      errorMap: () => ({ message: 'Type must be one of: perpetual, subscription, trial' }),
    }),
    organizationId: z.union([z.string(), z.null()]).optional(),
    userId: z.string().uuid({ message: 'User ID must be a valid UUID' }),
    hardwareId: z.string().optional(),
    features: z.record(z.boolean()).optional().default({}),
    limits: z.record(z.number().int().positive()).optional().default({}),
    expiresAt: z
      .string()
      .datetime({ message: 'ExpiresAt must be a valid ISO 8601 datetime' })
      .optional(),
    notes: z.string().max(1000).optional(),
    // Notely AI specific fields
    activationLimit: z.number().int().min(1).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    const trimmedOrgId = typeof data.organizationId === 'string'
      ? data.organizationId.trim()
      : undefined;

    if (data.productType === 'portal' && !trimmedOrgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Organization ID is required for portal licenses',
      });
    }

    if (data.productType === 'desktop' && data.organizationId && !trimmedOrgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Organization ID must be meaningful text when provided',
      });
    }

    // notely-ai licenses don't require organizationId or hardwareId
  });

export type GenerateLicenseInput = z.infer<typeof generateLicenseSchema>;

/**
 * Schema for license validation request
 */
export const validateLicenseSchema = z.object({
  licenseKey: z.string().min(1, { message: 'License key is required' }),
  hardwareId: z.string().optional(),
});

export type ValidateLicenseInput = z.infer<typeof validateLicenseSchema>;

/**
 * Schema for listing licenses query parameters
 */
export const listLicensesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  type: z.enum(['perpetual', 'subscription', 'trial', 'all']).optional(),
  status: z.enum(['active', 'expired', 'revoked', 'all']).optional(),
  search: z.string().optional(), // Search by organization ID or user ID
});

export type ListLicensesQuery = z.infer<typeof listLicensesQuerySchema>;

/**
 * Schema for validation log query parameters
 */
export const validationLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  licenseId: z.string().uuid().optional(),
  isValid: z.coerce.boolean().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  ipAddress: z.string().optional(),
});

export type ValidationLogQuery = z.infer<typeof validationLogQuerySchema>;

/**
 * Schema for heartbeat request
 */
export const heartbeatSchema = z.object({
  clientId: z.string().min(1, { message: 'Client ID is required' }),
  sessionToken: z.string().min(1, { message: 'Session token is required' }),
  clientVersion: z.string().optional(),
  platform: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional().default({}),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

/**
 * Schema for revocation request
 */
export const revokeLicenseSchema = z.object({
  reason: z.string().min(1, { message: 'Revocation reason is required' }).optional(),
});

export type RevokeLicenseInput = z.infer<typeof revokeLicenseSchema>;

/**
 * Standard success response wrapper
 */
export const successResponseSchema = z.object({
  success: z.literal(true),
  data: z.any(),
});

/**
 * Standard error response wrapper
 */
export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});

/**
 * Pagination metadata schema
 */
export const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative().optional(),
});

export type PaginationMetadata = z.infer<typeof paginationSchema>;

/**
 * Helper function to create paginated response
 */
export function createPaginatedResponse<T>(
  data: T[],
  pagination: PaginationMetadata
) {
  return {
    success: true,
    data: {
      items: data,
      pagination,
    },
  };
}

/**
 * Helper function to create success response
 */
export function createSuccessResponse<T>(data: T) {
  return {
    success: true,
    data,
  };
}

/**
 * Helper function to create error response
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: any
) {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
}
