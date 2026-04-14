# Notely Platform

The microservices backend for [Notely](https://yourdomain.com), a privacy-first meeting transcription and AI note-taking product.

This repo contains the server-side platform: API gateway, authentication, user management, calendar integration, meetings, transcripts, summaries, license management, and supporting infrastructure (nginx, observability, WebSocket gateway).

## Architecture

The platform is composed of independent microservices, each running in its own container. Services communicate through the API gateway and a shared RabbitMQ message bus. PostgreSQL is the primary datastore; Redis handles caching and rate limiting.

```
server/
├── services/        Individual microservices (auth, users, sync, meetings, ...)
├── packages/        Shared libraries used by multiple services
├── shared/          Cross-service helpers (logging, messaging, etc.)
├── infrastructure/  LLM gateway and worker, platform infra pieces
├── ops/             Database migrations, observability configs
├── config/          Base and secrets env templates
└── docker-compose.yml
```

See `server/docs/` for detailed architecture documentation.

## Quick start

Prerequisites: Docker 24+, Docker Compose v2, a `psql` client for running migrations.

```bash
cd server

# 1. Create your secrets file from the template
cp config/secrets.dev.env.example config/secrets.dev.env
# ... edit config/secrets.dev.env and fill in real values ...

# 2. Generate the merged .env file and start all services
./scripts/configure-domains.sh --base-domain <your-domain> --dev --apply
docker compose up -d --build

# 3. Tail logs
docker compose logs -f gateway
```

Required secrets (edit `config/secrets.dev.env`):

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` (RSA or EC keypair for service-to-service auth)
- `BETA_ADMIN_EMAIL` — admin account email (no default)
- OAuth secrets (`GOOGLE_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_SECRET`) if you want social login
- `GRAFANA_ADMIN_PASSWORD` — Grafana admin password (no default)

## Running tests

The test suite requires a running postgres instance. Supply the connection via env var; there are no hardcoded fallbacks:

```bash
export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/notely_test
export TEST_SYNC_URL=http://localhost:3205
export TEST_AUTH_URL=http://localhost:3201
```

See `CONTRIBUTING.md` for the full development workflow, required environment variables, and pull request checklist.

## Related repositories

- [`notely-cloud`](https://github.com/onepunk/notely-cloud) — cloud desktop client
- [`notely-ai`](https://github.com/onepunk/notely-ai) — standalone AI desktop client

## Security

To report a security issue, see [`SECURITY.md`](./SECURITY.md). Do not file security reports as public issues.

## License

Apache License 2.0. See [`LICENSE`](./LICENSE).
