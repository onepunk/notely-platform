# Services Directory - V3 Microservices

## Overview

This directory contains all V3 microservices. **V3 is built as microservices from day 1**, not extracted from a monolith. Each service is independently deployable, owns its database schema, and authenticates with a schema-scoped database role.

## Current Status: Phase 1 Implementation

We're building these services **from scratch** in parallel with the legacy V1 system (`../server`).

## Microservices

### Gateway (Port 3200)
**Status:** ✅ Operational (Week 1)
- `services/gateway/`
- Express proxy routing to all downstream services
- Aggregated health check exposed at `/api/status`
- Depends on `@notely/shared` middleware and logging

### 1. Auth Service (Port 3201)
**Status:** ✅ Operational (Week 1-2)
- Auth-owned credential store live (`auth.user_credentials`, `auth.sessions`)
- Authentication & JWT token management
- Session persistence backed by PostgreSQL + Redis (credentials via `POSTGRES_AUTH_USER`)
- `/api/auth` routes exposed behind the gateway
- Publishes login audit events and consumes `users.profile.updated` for credential projection syncing (RabbitMQ)
- **Schema:** `auth` in `notely_v3` database

### 2. Users Service (Port 3202)
**Status:** ✅ Operational (Week 1-2)
- User management (read & update profile endpoints)
- Profile management with login activity projection
- Publishes `users.profile.updated` events and records `auth.user.login` activity from RabbitMQ
- Settings and preferences groundwork
- **Schema:** `users` in `notely_v3` database

### 3. Calendar Service (Port 3203)
**Status:** 📅 Planned (Week 5-8)
- Calendar integration (Microsoft, Google)
- Event synchronization
- Provider management
- **Schema:** `calendar` in `notely_v3` database

### 4. Meetings Service (Port 3204)
**Status:** 📅 Planned (Week 9-12)
- Meeting management
- Participant tracking
- Teams integration
- **Schema:** `meetings` in `notely_v3` database

### 5. Transcripts Service (Port 3205)
**Status:** 📅 Planned (Week 13-16)
- Transcript processing
- Storage and retrieval
- Integration with Whisper/LLM
- **Schema:** `transcripts` in `notely_v3` database

## Service Structure

Each service follows this template:
```
service-name/
├── src/
│   ├── routes/         # Express routes
│   ├── services/       # Business logic
│   ├── models/         # Database queries
│   ├── middleware/     # Service-specific middleware
│   └── app.js          # Express app setup
├── tests/              # Unit and integration tests
├── Dockerfile          # Container configuration
├── package.json        # Dependencies
├── .env.example        # Environment template
└── README.md           # Service documentation
```

## Shared Infrastructure

All services import shared infrastructure via `@notely/shared` (packages linked to `packages/`):
- Database connection pooling
- Redis caching
- Structured logging
- Error handling
- HTTP client with timeouts
- Security middleware
- Rate limiting

Example usage:
```javascript
const db = require('@notely/shared/database/pool');
const logger = require('@notely/shared/logger');
const cache = require('@notely/shared/cache/redis');
```

## Database Strategy

All services connect to the dedicated V3 PostgreSQL container (`notely-postgres-v3`, addressed as `postgres:5432`). Within that instance we operate a single database (`notely_v3`) partitioned into service-specific schemas and login roles:

```
notely-postgres:5432
└── notely_v3 database
    ├── auth schema (auth service only)
    ├── users schema (users service only)
    ├── calendar schema (calendar service only)
    ├── meetings schema (meetings service only)
    ├── transcripts schema (transcripts service only)
    ├── notes schema (notes service only)
    ├── summaries schema (summaries service only)
    ├── admin schema (admin service only)
    └── actions schema (actions service only)

Credentials are managed via per-service environment variables (e.g. `POSTGRES_AUTH_USER` / `POSTGRES_AUTH_PASSWORD`) generated in `config/secrets.env` and applied through Flyway (`ops/migrations/V2__service_roles.sql`).
```

**Why shared instance, separate schemas?**
- Keeps V3 isolated from V2 while avoiding cross-instance orchestration during early phases
- Simplifies local development and transactional workflows while services mature
- Easy to promote a schema into its own database later—roles, migrations, and secrets are already scoped by service

## Service Communication

Services communicate via:
- **HTTP REST APIs** - Primary method
- **Redis pub/sub** - Event notifications (future)
- **Message queue** - Async operations (future)

## Development Workflow

1. **Create service directory**: `mkdir services/service-name`
2. **Copy service template**: Use existing service as template
3. **Implement routes**: Build REST API endpoints
4. **Import shared infra**: Use `@notely/shared` modules (linked to `packages/`)
5. **Write tests**: Unit and integration tests
6. **Add to Docker Compose**: Update `../docker-compose.yml`
7. **Deploy and test**: Start service independently

## Next Service to Build

**Week 1-2:** Auth Service (port 3201)
- See implementation plan in `docs/ARCH_V2/PHASE_1_MICROSERVICES.md`
- Start with authentication and JWT management
- Foundation for all other services
