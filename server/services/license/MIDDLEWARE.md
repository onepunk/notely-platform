# License Service Middleware

This document describes the authentication and rate limiting middleware available in the license service.

## Authentication Middleware

### `authMiddleware`

**Location:** `/src/middleware/auth.middleware.ts`

Verifies JWT tokens issued by the auth service using the RS256 algorithm and the JWT_PUBLIC_KEY from environment configuration.

**Features:**
- Validates JWT token from Authorization header (Bearer scheme)
- Verifies token signature using RS256 public key
- Checks token audience matches 'license-service'
- Extracts user ID from token subject (sub) field
- Extracts role and scope from token
- Attaches authentication context to request object

**Usage:**
```typescript
import { authMiddleware } from './middleware/auth.middleware';

// Apply to specific routes
app.use('/api/validate', authMiddleware, validationRoutes);

// Or to individual endpoints
app.post('/api/validate/license', authMiddleware, validateLicenseHandler);
```

**Authentication Context:**
After successful authentication, the middleware attaches this context to the request:
```typescript
req.authContext = {
  userId: string;      // User ID from token sub field
  role?: string;       // User role (admin, support, user, etc.)
  scope?: string | string[];  // Token scopes
};
```

**Error Responses:**
- `401 Unauthorized` - Missing, invalid, or expired token
- `500 Internal Server Error` - JWT_PUBLIC_KEY not configured

### `adminAuthMiddleware`

**Location:** `/src/middleware/auth.middleware.ts`

Extends authentication by requiring 'admin' or 'support' role. Must be used after `authMiddleware`.

**Features:**
- Requires authContext to exist (set by authMiddleware)
- Checks for 'admin' or 'support' role
- Returns 403 if insufficient permissions

**Usage:**
```typescript
import { authMiddleware, adminAuthMiddleware } from './middleware/auth.middleware';

// Chain both middleware for admin-only routes
app.use('/api/admin', authMiddleware, adminAuthMiddleware, adminRoutes);
```

**Error Responses:**
- `401 Unauthorized` - No authentication context (authMiddleware not called)
- `403 Forbidden` - User doesn't have admin or support role

## Rate Limiting Middleware

**Location:** `/src/middleware/rateLimiting.middleware.ts`

Implements Redis-based rate limiting using a sliding window algorithm with INCR and EXPIRE commands.

### `validationRateLimiter`

For public-facing validation endpoints.

**Limits:** 100 requests per minute per IP address

**Usage:**
```typescript
import { validationRateLimiter } from './middleware/rateLimiting.middleware';

app.use('/api/validate', validationRateLimiter, validationRoutes);
```

**Rate Limit Key:** Client IP address (extracted from X-Forwarded-For or direct connection)

### `adminRateLimiter`

For admin endpoints.

**Limits:** 1000 requests per minute per authenticated user

**Usage:**
```typescript
import { adminRateLimiter } from './middleware/rateLimiting.middleware';

app.use('/api/admin', authMiddleware, adminRateLimiter, adminRoutes);
```

**Rate Limit Key:** Authenticated user ID (falls back to IP if not authenticated)

### `heartbeatRateLimiter`

For heartbeat/status check endpoints.

**Limits:** 20 requests per minute per client

**Usage:**
```typescript
import { heartbeatRateLimiter } from './middleware/rateLimiting.middleware';

app.post('/api/heartbeat', authMiddleware, heartbeatRateLimiter, heartbeatHandler);
```

**Rate Limit Key:** Combination of user ID and client IP for stricter per-client limits

### Rate Limit Response Headers

All rate limiters set these headers on responses:
- `X-RateLimit-Limit` - Maximum requests allowed in window
- `X-RateLimit-Remaining` - Requests remaining in current window
- `X-RateLimit-Reset` - Unix timestamp when the limit resets

When rate limit is exceeded:
- `Retry-After` - Seconds until requests are allowed again

**Error Response (429 Too Many Requests):**
```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests, please try again later",
  "retry_after_seconds": 45
}
```

### Error Handling

Rate limiters are designed to fail open - if Redis is unavailable, requests are allowed through with a logged error. This prevents rate limiting infrastructure issues from blocking legitimate traffic.

## Example: Complete Route Protection

```typescript
import express from 'express';
import { authMiddleware, adminAuthMiddleware } from './middleware/auth.middleware';
import { 
  validationRateLimiter, 
  adminRateLimiter, 
  heartbeatRateLimiter 
} from './middleware/rateLimiting.middleware';

const app = express();

// Public validation endpoint - rate limited by IP
app.use('/api/validate', validationRateLimiter, validationRoutes);

// Admin endpoints - requires auth + admin role + rate limited by user
app.use(
  '/api/admin',
  authMiddleware,
  adminAuthMiddleware,
  adminRateLimiter,
  adminRoutes
);

// Heartbeat endpoint - requires auth + strict rate limit per client
app.post(
  '/api/heartbeat',
  authMiddleware,
  heartbeatRateLimiter,
  heartbeatHandler
);
```

## Configuration

### JWT Authentication

Set the JWT public key in your environment:
```bash
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

The key is loaded from `config/env.ts` and normalized automatically (handles escaped newlines).

### Redis

Rate limiting requires Redis to be configured and running. Configuration is loaded from:
- `REDIS_URL` - Full Redis connection URL
- Or `REDIS_HOST` and `REDIS_PORT` - Individual connection parameters

Initialize Redis before starting the server:
```typescript
import { initializeRedis } from './lib/redis';

await initializeRedis();
```

## TypeScript Types

Custom Express types are defined in `/src/types/express.d.ts`:

```typescript
declare module 'express-serve-static-core' {
  interface Request {
    authContext?: {
      userId: string;
      role?: string;
      scope?: string[] | string;
    };
  }
}
```

This allows TypeScript to recognize `req.authContext` in route handlers.
