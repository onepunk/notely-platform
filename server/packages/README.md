# Shared Utilities

## Overview
Cross-cutting concerns and utilities shared across all V3 services. These packages live under `server/packages/` and are consumed via local file dependencies (e.g., `file:../../packages/logger`).

## Structure

```
packages/
├── cache/          # Redis client, caching helpers, queues, rate limiting
├── config/         # Environment configuration loader
├── constants/      # Shared constants (roles, etc.)
├── database/       # PostgreSQL connection pool wrapper
├── errors/         # Error handler + custom error classes
├── http-client/    # Axios client with retry/timeouts
├── logger/         # Structured logging with AsyncLocalStorage contexts
├── middleware/     # Request ID, logging, security, rate limiting
├── nginx/          # Nginx configuration utilities
├── scripts/        # Shared scripts and utilities
└── utils/          # Generic helpers (date, strings, validation)
```

## Components

### Cache (`cache/redis.js`)
- Manages Redis connections for cache/session/job queue use cases
- Provides helpers (`setCache`, `getCache`, `setSession`, job queue APIs, rate limiting)
- Handles health checks and graceful shutdown

### Constants (`constants/`)
- **Roles** (`constants/roles.js` / `constants/roles.ts`) - Centralized user role definitions
  - `ROLES` object with constants: `ADMIN`, `OPERATOR`, `VIEWER`, `USER`
  - `ALL_USER_ROLES` array for iteration and validation
  - Helper functions: `isValidRole()`, `normalizeRole()`, `isAdmin()`, `isOperator()`, `isViewer()`
  - Role hierarchy functions: `getRoleLevel()`, `hasEqualOrHigherPrivilege()`
  - Available in both JavaScript and TypeScript with full type definitions

### Database (`database/pool.js`)
- Configurable PostgreSQL pool with health checks and transaction helper
- Supports env-based connection strings and statement/query timeouts
- Emits instrumentation logs via the shared logger

### Errors (`errors/handler.js`)
- Standard error classes (`NotFoundError`, `UnauthorizedError`, etc.)
- Express error-handling middleware used by services and gateway
- Maps database/JWT errors to consistent API responses

### HTTP Client (`http-client/index.js`)
- Axios instance with sane defaults (timeouts, retries, circuit-breaker friendly hooks)
- Request/response logging tied into the shared logger

### Logger (`logger/index.js`)
- Winston-based structured logger with JSON output
- AsyncLocalStorage to maintain request context across async calls
- Utility to attach request IDs and service metadata automatically

### Middleware (`middleware/*.js`)
- `requestId.js` – attach per-request correlation IDs
- `requestLogging.js` – structured request/response logging
- `security.js` – Helmet + sanitizer stack for common hardening
- `rateLimit.js` – Redis-backed throttling primitives

### Utils (`utils/*.js`)
- Generic helpers shared by services (e.g., date parsing, string helpers)

## Usage

Services import individual packages via local file dependencies:

```javascript
// In package.json:
// "dependencies": {
//   "@notely/shared": "file:../../packages"
// }

// JavaScript services
const { logger, database, constants } = require('@notely/shared');
const { ROLES, isAdmin } = constants.roles;

// Alternative: direct imports
const logger = require('@notely/shared/logger');
const { getPool } = require('@notely/shared/database');
const { errorHandler } = require('@notely/shared/errors');
const requestIdMiddleware = require('@notely/shared/middleware/requestId');
```

```typescript
// TypeScript services - import from .ts files directly
import { ROLES, UserRole, ALL_USER_ROLES, isAdmin } from '@notely/shared/constants/roles';

// Or import the full constants module
import { constants } from '@notely/shared';
const { ROLES, isValidRole } = constants.roles;
```

## Guidelines

1. Keep utilities generic and reusable
2. Document all exported functions
3. Write unit tests for utilities
4. Avoid module-specific logic
5. Use dependency injection where possible
