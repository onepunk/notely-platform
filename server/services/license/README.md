# Notely License Service (V3)

This service manages license generation, validation, and lifecycle operations for Notely deployments. It provides REST endpoints for license creation, verification, renewal, and revocation while coordinating with the Auth service and PostgreSQL for license data persistence.

## Service Description

The License Service is responsible for:
- Generating cryptographically signed license tokens
- Validating license authenticity and expiration
- Managing license lifecycle (creation, renewal, revocation)
- Enforcing license quotas and feature limits
- Providing license metrics and analytics
- Integrating with the Notely ecosystem through JWT validation

## Installation

```bash
npm install
```

## Environment Variables

The service requires the following environment variables (see `.env.example` for template):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LICENSE_PORT` | Yes | 3210 | Port for the service HTTP server |
| `NODE_ENV` | Yes | development | Execution environment (development, production) |
| `DB_HOST` | Yes | notely-postgres | PostgreSQL database host |
| `DB_PORT` | Yes | 5432 | PostgreSQL database port |
| `DB_NAME` | Yes | notely_v3 | PostgreSQL database name |
| `DB_USER` | Yes | notely_user | PostgreSQL database user |
| `DB_PASSWORD` | Yes | - | PostgreSQL database password |
| `REDIS_HOST` | Yes | notely-redis | Redis cache host |
| `REDIS_PORT` | Yes | 6379 | Redis cache port |
| `JWT_PUBLIC_KEY` | Yes | - | Public key for JWT validation (multi-line) |
| `JWT_EXPIRES_IN` | No | 1h | Default JWT token expiration time |
| `LICENSE_ENCRYPTION_KEY` | Yes | - | Key for encrypting sensitive license data |
| `LOG_LEVEL` | No | info | Logging verbosity (debug, info, warn, error) |

## Development Commands

```bash
# Build the service
npm run build

# Start the service in production mode
npm start

# Start the service in development mode with hot reload
npm run dev

# Run linting
npm run lint

# Run tests
npm run test
```

## API Endpoints Summary

### License Operations

- **Generate License**
  - `POST /api/v1/licenses`
  - Create a new license for a customer/deployment

- **Validate License**
  - `GET /api/v1/licenses/:id/validate`
  - Validate a license token and check status

- **Get License Details**
  - `GET /api/v1/licenses/:id`
  - Retrieve license information

- **Renew License**
  - `POST /api/v1/licenses/:id/renew`
  - Extend an existing license expiration

- **Revoke License**
  - `POST /api/v1/licenses/:id/revoke`
  - Immediately revoke a license

- **List Licenses**
  - `GET /api/v1/licenses`
  - List all licenses with filtering options

### Health & Metrics

- **Health Check**
  - `GET /health`
  - Service health status

- **Readiness Check**
  - `GET /ready`
  - Service readiness for traffic

- **Metrics**
  - `GET /metrics`
  - Prometheus-formatted metrics

## Architecture

The service follows a microservices architecture pattern:

- **Express Server**: HTTP API with async error handling
- **JWT Validation**: Integrates with Auth service for token verification
- **Database Layer**: PostgreSQL for persistent license data and state
- **Caching**: Redis for performance optimization
- **Monitoring**: Prometheus metrics and Winston structured logging
- **API Documentation**: Swagger/OpenAPI specifications

## Current Status

- Project scaffolded with Express + TypeScript
- Configuration management in place
- Health and readiness endpoints available
- Package dependencies configured
- Ready for implementation of core license logic

## Next Steps

1. Implement license generation and cryptographic signing
2. Add database schema and migrations for license storage
3. Implement JWT validation middleware
4. Create license validation and verification endpoints
5. Add Redis caching for license validation
6. Instrument metrics and structured logging
7. Implement comprehensive test suite
8. Add API documentation and Swagger specs

## Running with Docker

```bash
# Build and start the service
docker compose up -d --build license

# View logs
docker compose logs -f license

# Stop the service
docker compose down
```

## Database Schema

License data is stored in PostgreSQL. The service maintains:
- License records with customer/tenant associations
- License features and quotas
- Audit trail for license operations
- Revocation status and timestamps

Database migrations are managed centrally via Flyway. The licensing schema is defined in:
- `./server/ops/migrations/V36__licensing_schema.sql`

All migrations are applied automatically through the centralized Flyway system.

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run integration tests
npm run test:integration
```

## Troubleshooting

**Service fails to start**: Ensure all required environment variables are set in `.env`. Check database connectivity and Redis availability.

**License validation fails**: Verify JWT_PUBLIC_KEY is correctly formatted (multi-line PEM format). Check that the license hasn't been revoked.

**Database connection errors**: Confirm PostgreSQL is running and the connection details in `.env` are correct.

For more detailed documentation, see `docs/` directory.
