# Gateway Service

**Port:** 3200
**Role:** API Gateway - Entry point for all V3 requests
**Phase:** 2 (Weeks 3-4)

## Overview

The Gateway service is the single entry point for all Notely V3 API requests. It routes incoming requests to the appropriate microservices using HTTP proxy middleware and enforces platform-wide security controls.

## Architecture

```
Client Request
     ↓
Gateway (3200)
     ↓
├─→ /api/auth/*       → Auth Service (3201)
├─→ /api/desktop-auth/* → Auth Service (3201)
├─→ /api/oauth/*       → Auth Service (3201) – OIDC provider
├─→ /api/users/*      → Users Service (3202)
├─→ /api/calendar/*   → Calendar Service (3203)
├─→ /api/meetings/*   → Meetings Service (3204)
└─→ /api/transcripts/* → Transcripts Service (3205)
```

## Responsibilities

1. **Request Routing**: Proxy requests to appropriate microservices
2. **Health Monitoring**: Aggregate health status from all services
3. **Request Logging**: Log all incoming requests (via shared middleware)
4. **Security Headers**: Apply common security headers (via shared middleware)
5. **Error Handling**: Gracefully handle service unavailability
6. **Delegated API-Key Validation**: Call the Auth service for API-key verification to keep database credentials out of the gateway.

## Endpoints

### Gateway Health
```bash
GET /health
```
Returns gateway's own health status.

**Response:**
```json
{
  "status": "healthy",
  "service": "gateway",
  "timestamp": "2025-10-15T10:30:00.000Z",
  "version": "1.0.0"
}
```

### Service Status
```bash
GET /api/status
```
Checks health of all microservices.

**Response:**
```json
{
  "gateway": "healthy",
  "services": {
    "auth": { "status": "healthy", "url": "http://auth-v2:3201" },
    "users": { "status": "healthy", "url": "http://users-v2:3202" },
    "calendar": { "status": "unreachable", "url": "http://calendar-v2:3203" },
    "meetings": { "status": "healthy", "url": "http://meetings-v2:3204" },
    "transcripts": { "status": "healthy", "url": "http://transcripts-v2:3205" }
  },
  "timestamp": "2025-10-15T10:30:00.000Z"
}
```

## Proxied Routes

All routes starting with `/api/{service}/` are proxied to the corresponding microservice:

- `/api/auth/*` → Auth Service
- `/api/desktop-auth/*` → Auth Service (desktop OAuth endpoints)
- `/api/oauth/*` → Auth Service (OIDC provider endpoints)
- `/api/users/*` → Users Service
- `/api/calendar/*` → Calendar Service
- `/api/meetings/*` → Meetings Service
- `/api/transcripts/*` → Transcripts Service

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_PORT` | 3200 | Gateway listening port |
| `AUTH_SERVICE_URL` | http://auth:3201 | Auth service endpoint |
| `USERS_SERVICE_URL` | http://users:3202 | Users service endpoint |
| `CALENDAR_SERVICE_URL` | http://calendar:3203 | Calendar service endpoint |
| `MEETINGS_SERVICE_URL` | http://meetings:3204 | Meetings service endpoint |
| `TRANSCRIPTS_SERVICE_URL` | http://transcripts:3205 | Transcripts service endpoint |
| `SERVICE_NAME` | gateway | Service name used when minting service-to-service tokens |
| `GATEWAY_SERVICE_API_KEY` | **Required** | Shared secret used to request service tokens from Auth (no default - set in secrets.env) |

## Authentication Flow

Gateway authenticates inbound requests using JWT validation, service-to-service tokens, and API keys:

- **JWT / Service Tokens**: Validated via Auth JWKS and `/internal/tokens/introspect`, with circuit breakers guarding failures.
- **API Keys**: The gateway delegates all API key verification to the Auth service. Auth stores all API keys in `auth.api_keys` (both service and client keys) and validates them via `POST /internal/api-keys/verify`. The gateway caches verification responses in-process and retries with exponential backoff if Auth is unavailable. This architecture eliminates the need for gateway database credentials and centralizes credential management in Auth.

When adding a new service that needs API-key verification, reuse `@notely/shared`.authClient.ApiKeyVerifier with that service’s own service-token client.

## Running Locally

### With Docker Compose (recommended)
```bash
cd ./server
docker compose up -d gateway-v2
```

### Standalone
```bash
cd services/gateway
npm install
cp .env.example .env
npm run dev
```

## Testing

```bash
# Gateway health
curl http://localhost:3200/health

# Service status
curl http://localhost:3200/api/status

# Test routing (requires auth service running)
curl -X POST http://localhost:3200/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'
```

## Shared Infrastructure

Gateway uses the following shared components from Phase 0:

- `logger` - Structured logging
- `requestIdMiddleware` - Request ID tracking
- `requestLoggingMiddleware` - HTTP request logging
- `securityMiddleware` - Security headers
- `errorHandler` - Centralized error handling

## Error Handling

When a microservice is unavailable, the gateway returns:

```json
{
  "error": "Auth service unavailable",
  "message": "connect ECONNREFUSED 127.0.0.1:3201"
}
```

Status code: `502 Bad Gateway`

## Monitoring

- **Logs**: All requests logged with request ID
- **Health**: `/health` endpoint for container health checks
- **Service Status**: `/api/status` for monitoring dashboard

## Future Enhancements

- [ ] Rate limiting per service
- [ ] Request/response transformation
- [ ] Circuit breaker pattern
- [ ] Load balancing for multiple service instances
- [ ] GraphQL gateway support
- [ ] WebSocket proxying

## Related Documentation

- [Phase 1 Implementation Guide](../../docs/ARCH_V2/PHASE_1_MICROSERVICES.md)
- [V2 Architecture Overview](../../docs/ARCH_V2/OVERVIEW.md)
- [Shared Infrastructure (`@notely/shared`)](../../packages/README.md)
