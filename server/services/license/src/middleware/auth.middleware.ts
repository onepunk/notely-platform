import { Request, Response, NextFunction } from 'express';

/** Admin-level roles (matches @notely/shared constants.roles.isAdmin) */
const ADMIN_ROLES = new Set(['admin', 'super_admin']);
function isAdmin(role: string | undefined | null): boolean {
  return !!role && ADMIN_ROLES.has(role.toLowerCase());
}

/**
 * Authentication middleware for license service endpoints
 *
 * IMPORTANT: This service follows the platform's centralized authentication pattern.
 * The API Gateway validates JWT tokens and forwards authentication context via headers.
 * This middleware trusts and extracts those headers - it does NOT re-validate JWTs.
 *
 * Architecture:
 *   Client → Gateway (validates JWT) → License Service (trusts headers)
 *
 * Headers forwarded by gateway:
 *   - X-Auth-Type: Token type (user/service/api-key)
 *   - X-Auth-Subject: User ID
 *   - X-Auth-Email: User email
 *   - X-Auth-Role: User role
 *   - X-Auth-Scopes: Comma-separated scopes
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * @returns 401 for missing auth context, or calls next()
 *
 * @example
 * ```typescript
 * router.use('/current', authMiddleware);
 * router.use('/admin', authMiddleware, adminAuthMiddleware);
 * ```
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Extract authentication context from gateway headers
  const subject = req.headers['x-auth-subject'] as string | undefined;
  const email = req.headers['x-auth-email'] as string | undefined;
  const role = req.headers['x-auth-role'] as string | undefined;
  const scopesHeader = req.headers['x-auth-scopes'] as string | undefined;

  // Validate that gateway provided authentication context
  if (!subject) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing authentication context',
    });
    return;
  }

  // Parse scopes from comma-separated string
  const scopes = (scopesHeader || '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

  // Attempt to determine organization context from headers/scopes
  const organizationHeaderCandidates = [
    req.headers['x-auth-organization-id'],
    req.headers['x-auth-org-id'],
    req.headers['x-organization-id'],
    req.headers['x-org-id'],
  ];
  const organizationIdFromHeader = organizationHeaderCandidates.find(
    (value): value is string => typeof value === 'string' && value.length > 0
  );

  const scopeOrgEntry = scopes.find((scopeEntry) =>
    scopeEntry.startsWith('org:') || scopeEntry.startsWith('organization:')
  );
  const organizationIdFromScope = scopeOrgEntry
    ? scopeOrgEntry.split(':')[1]
    : undefined;

  const organizationId = organizationIdFromHeader || organizationIdFromScope;

  // Attach authentication context to request
  req.authContext = {
    userId: subject,
    email: email || undefined,
    role: role || undefined,
    scope: scopes,
    organizationId: organizationId || undefined,
  };

  next();
}

/**
 * Admin authentication middleware for license service admin endpoints (read-only)
 *
 * Verifies the user has admin or support role.
 * Use this for read-only operations where support staff need visibility.
 * Must be used after authMiddleware in the middleware chain.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * @returns 401 if not authenticated, 403 if insufficient permissions, or calls next()
 *
 * @example
 * ```typescript
 * router.get('/licenses', authMiddleware, adminAuthMiddleware, listLicenses);
 * ```
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Verify authentication context exists
  if (!req.authContext) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  const { role } = req.authContext;

  // Check for admin or support role (read access)
  if (!isAdmin(role) && role !== 'support') {
    res.status(403).json({
      error: 'forbidden',
      message: 'Admin or support role required',
    });
    return;
  }

  next();
}

/**
 * Admin-only authentication middleware for license service write operations
 *
 * Verifies the user has admin role only (not support).
 * Use this for write operations: generate, revoke, create, update, delete.
 * Must be used after authMiddleware in the middleware chain.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * @returns 401 if not authenticated, 403 if not admin, or calls next()
 *
 * @example
 * ```typescript
 * router.post('/generate', authMiddleware, adminOnlyMiddleware, generateLicense);
 * ```
 */
export function adminOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Verify authentication context exists
  if (!req.authContext) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  const { role } = req.authContext;

  // Check for admin role only (support cannot modify)
  if (!isAdmin(role)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Admin role required for this operation',
    });
    return;
  }

  next();
}
