import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';

/**
 * Admin API authentication middleware for the sync service.
 *
 * Accepts either:
 * 1. X-Internal-Api-Key header matching SYNC_ADMIN_API_KEY (service-to-service)
 * 2. Gateway-forwarded X-Auth-Role of 'admin' or 'super_admin' with a valid X-Auth-Subject
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  // Option 1: Service-to-service API key
  const apiKey = req.headers['x-internal-api-key'] as string | undefined;
  if (apiKey && config.admin.apiKey && apiKey === config.admin.apiKey) {
    return next();
  }

  // Option 2: Gateway-forwarded admin role
  const authRole = req.headers['x-auth-role'] as string | undefined;
  const authSubject = req.headers['x-auth-subject'] as string | undefined;

  if (authRole && ['admin', 'super_admin'].includes(authRole) && authSubject) {
    return next();
  }

  return res.status(401).json({
    error: 'unauthorized',
    message: 'Admin authentication required. Provide X-Internal-Api-Key or valid admin role headers.',
  });
}
