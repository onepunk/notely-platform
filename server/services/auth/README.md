# Auth Service

**Port:** 3201
**Role:** Authentication & JWT Token Management
**Phase:** 1 (Week 1-2)

## Overview

The Auth Service handles user authentication, JWT token generation, session management, and token validation for all V2 microservices.

> **Progress (Oct 20, 2025):** `auth.user_credentials` + `auth.sessions` live; service reads solely from this schema while JWT/session logic is being hardened.

## Architecture

```
Client
  ↓
Gateway (3200)
  ↓
Auth Service (3201)
  ↓
├─→ PostgreSQL (notely_v3.auth schema only)
└─→ Redis (session cache)
```

## Responsibilities

1. **User Authentication**: Validate credentials and generate JWT tokens
2. **Session Management**: Store and manage active sessions
3. **Token Validation**: Validate JWTs for other microservices
4. **Token Refresh**: Refresh expired tokens within grace period
5. **Logout**: Invalidate sessions

### Data Ownership
- Auth service is the system of record for credentials (`auth.user_credentials`).
- The Users service publishes events (or exposes a private API) so Auth can upsert its projection when profile data changes.
- Auth **never** reads from the Users schema directly, preserving independent deployability.

## Endpoints

### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-10-15T11:30:00.000Z",
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "user"
  }
}
```

### Logout
```bash
POST /api/auth/logout
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### Internal API-Key Verification
```bash
POST /internal/api-keys/verify
Authorization: Bearer <service-token>
Content-Type: application/json

{
  "apiKey": "raw-api-key"
}
```

**Response:**
```json
{
  "valid": true,
  "key": {
    "id": "uuid",
    "name": "integration-key",
    "scopes": ["notes:read"]
  }
}
```

Returns `{ "valid": false, "reason": "not_found" }` when the key is inactive or unknown. Service tokens must include the `auth:api-keys:verify` scope.

### Refresh Token
```bash
POST /api/auth/refresh
Content-Type: application/json

{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-10-15T12:30:00.000Z"
}
```

### Validate Token (Service-to-Service)
```bash
POST /api/auth/validate
Content-Type: application/json

{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "valid": true,
  "userId": "user-uuid",
  "email": "user@example.com",
  "role": "user"
}
```

### Get Current User
```bash
GET /api/auth/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "userId": "user-uuid",
  "email": "user@example.com"
}
```

## Database Schema

### auth.user_credentials
```sql
CREATE TABLE auth.user_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE,
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  first_name VARCHAR(120),
  last_name VARCHAR(120),
  is_active BOOLEAN DEFAULT TRUE,
  email_verified BOOLEAN DEFAULT FALSE,
  password_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

The Users service (once implemented) owns the canonical profile. Changes to user data are replicated into `auth.user_credentials` via service-to-service APIs or domain events so the Auth service never queries another schema directly.

### auth.sessions
```sql
CREATE TABLE auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.user_credentials(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_session_future_expiry CHECK (expires_at > created_at)
);

CREATE INDEX idx_sessions_token ON auth.sessions(token);
CREATE INDEX idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON auth.sessions(expires_at);
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_PORT` | 3201 | Auth service listening port |
| `DB_HOST` | notely-postgres | PostgreSQL host |
| `DB_NAME` | notely_v3 | Database name |
| `JWT_PRIVATE_KEY` | (required) | PEM-encoded RSA private key used for signing JWTs (may be provided via `JWT_PRIVATE_KEY_FILE`) |
| `JWT_PUBLIC_KEY` | (required) | PEM-encoded RSA public key exposed via JWKS (derived automatically when private key provided) |
| `JWT_KEY_ID` | (optional) | Key identifier advertised in JWKS (defaults to SHA-256 fingerprint of public key) |
| `JWT_EXPIRES_IN` | 1h | User token expiry (e.g., 1h, 7d, 30d) |
| `SERVICE_TOKEN_EXPIRES_IN` | 5m | Service-to-service token lifetime |
| `REDIS_HOST` | notely-redis | Redis host for caching |
| `AUTH_ENABLE_DESKTOP_OAUTH` | false | Feature flag to enable `/api/desktop-auth/*` flow (set true in staging/prod rollout) |
| `AUTH_DESKTOP_STATE_TTL_SECONDS` | 600 | TTL for cached PKCE state stored in Redis |
| `AUTH_DESKTOP_LOGIN_TEMPLATE_VERSION` | 2025-10-21 | Identifier for the placeholder login template (surfaced in HTML for debugging) |
| `AUTH_DESKTOP_DEFAULT_SCOPE` | `openid offline_access email profile` | Default scopes requested during desktop OAuth |
| `AUTH_ENABLE_OIDC_PROVIDER` | true | Feature flag: enables the embedded `node-oidc-provider` at `/api/oauth/*` |
| `AUTH_OIDC_ISSUER_URL` | http://localhost:3201/api/oauth | Public issuer URL exposed in the discovery document |
| `AUTH_OIDC_COOKIE_KEYS` | dev-oidc-cookie-secret-1,dev-oidc-cookie-secret-2 | HMAC keys for OIDC cookies (configure secure values in prod) |
| `AUTH_OIDC_DEFAULT_SCOPE` | `openid profile email offline_access` | Default scopes allowed for clients |
| `AUTH_OIDC_DESKTOP_CLIENT_ID` | notely-desktop | Desktop client identifier |
| `AUTH_OIDC_DESKTOP_REDIRECT_URIS` | notely://auth/callback | Comma-separated list of desktop redirect URIs |
| `AUTH_OIDC_DESKTOP_POST_LOGOUT_REDIRECT_URIS` | notely://auth/logout | Comma-separated list of post-logout URIs for desktop |
| `AUTH_OIDC_PORTAL_CLIENT_ID` | notely-portal | Portal web client identifier |
| `AUTH_OIDC_PORTAL_CLIENT_SECRET` | portal-secret | Confidential client secret (override in secrets) |
| `AUTH_OIDC_PORTAL_REDIRECT_URIS` | https://localhost:3004/oauth/callback | Comma-separated redirect URIs for portal |
| `AUTH_OIDC_PORTAL_POST_LOGOUT_REDIRECT_URIS` | https://localhost:3004/logout-complete | Comma-separated post-logout URIs for portal |

## Running Locally

### With Docker Compose (recommended)
```bash
cd ./server
docker compose up -d auth-v2
```

### Standalone
```bash
cd services/auth
npm install
cp .env.example .env
npm run dev
```

## Testing

```bash
# Health check
curl http://localhost:3201/health

# Login
curl -X POST http://localhost:3201/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Validate token (used by other services)
curl -X POST http://localhost:3201/api/auth/validate \
  -H "Content-Type: application/json" \
  -d '{"token":"your-jwt-token-here"}'

# Get current user
curl http://localhost:3201/api/auth/me \
  -H "Authorization: Bearer your-jwt-token-here"
```

## Internal API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/internal/service-tokens` | Exchange a service API key for a short-lived JWT (`X-Service-Name` + `X-Service-Key` headers required). |
| `POST` | `/internal/tokens/introspect` | Validate any issued token; requires a service token with the `auth:introspect` scope. |
| `GET` | `/internal/api-keys` | Enumerate active API keys for auditing; requires a service token with `auth:service-tokens`. |
| `GET` | `/internal/api-keys/:serviceName` | Retrieve metadata for a specific service API key. |

The Auth service exposes its signing key set at `/.well-known/jwks.json`, enabling other services to cache the public key (5 minute TTL) for JWT verification.

## Service-to-Service Authentication

Other microservices validate tokens by calling `/api/auth/validate`:

```javascript
// Example from Users Service
const validateToken = async (token) => {
  const response = await httpClient.post(
    'http://auth-v2:3201/api/auth/validate',
    { token }
  );
  return response.data; // { valid: true, userId, email, role }
};
```

## Event Integrations

- Publishes `auth.user.login` and `auth.user.login_failed` messages to the shared RabbitMQ topic exchange for audit trails and activity feeds.
- Consumes `users.profile.updated` events to keep `auth.user_credentials` aligned with the Users service source of truth (first name, last name, email).
- Requires `RABBITMQ_URL`/`RABBITMQ_*` environment variables drawn from `server/.env`; the service initializes both a publisher and consumer channel during startup.

## Shared Infrastructure

Auth service uses these shared components from Phase 0:

- `database/pool` - PostgreSQL connection pooling
- `cache/redis` - Redis caching
- `logger` - Structured logging
- `middleware/requestId` - Request ID tracking
- `middleware/requestLogging` - HTTP request logging
- `middleware/security` - Security headers
- `errors/handler` - Centralized error handling

## Caching Strategy

- **User data**: Cached for 5 minutes (`user:email:{email}`, `user:id:{id}`)
- **Session data**: Cached for 1 minute (`session:{token}`)
- **Cache invalidation**: On logout, token refresh, and session expiry

## Security

- Passwords hashed with bcrypt (minimum 10 rounds)
- JWT tokens signed with HS256 algorithm
- Sessions stored in database (not just JWT)
- Expired sessions cleaned up periodically
- Security headers applied via shared middleware

## Monitoring

- **Logs**: All authentication events logged with user ID/email
- **Health**: `/health` endpoint checks database and Redis connectivity
- **Metrics**: Request counts, error rates, authentication success/failure

## Future Enhancements

- [ ] OAuth2 flows (Microsoft, Google) - Week 3-4
- [ ] Multi-factor authentication (MFA)
- [ ] Password reset functionality
- [ ] Rate limiting on login attempts
- [ ] Suspicious activity detection
- [ ] Refresh token rotation
- [ ] Session management dashboard

## Related Documentation

- [Phase 1 Implementation Guide](../../docs/ARCH_V2/PHASE_1_MICROSERVICES.md)
- [V2 Architecture Overview](../../docs/ARCH_V2/OVERVIEW.md)
- [Gateway Service](../gateway/README.md)
- [Shared Infrastructure (`@notely/shared`)](../../packages/README.md)
