# Contributing to notely-platform

Thanks for your interest in contributing. This repo contains the microservices backend for Notely.

## Development setup

1. Install prerequisites:
   - Docker 24+ and Docker Compose v2
   - Node.js 20+ (for running scripts outside containers)
   - PostgreSQL client tools (`psql`) for running migrations and ad-hoc queries

2. Create your secrets file:
   ```bash
   cd server
   cp config/secrets.dev.env.example config/secrets.dev.env
   # Edit secrets.dev.env and fill in values
   ```

3. Generate the merged `.env` file and start the services:
   ```bash
   ./scripts/configure-domains.sh --base-domain <your-domain> --dev --apply
   docker compose up -d --build
   ```

4. Tail logs:
   ```bash
   docker compose logs -f <service-name>
   ```

## Required environment variables

For local development, set these in `config/secrets.dev.env`:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` — RSA or EC keypair for service-to-service auth
- `BETA_ADMIN_EMAIL` — admin account email (there is no default)
- OAuth client secrets (`GOOGLE_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_SECRET`) if you want OAuth-based login
- `RECAPTCHA_SECRET_KEY` if you want the contact form

For running the sync service test suite:

- `TEST_DATABASE_URL` (or `DATABASE_URL`) — postgres connection string for the test database
- `TEST_SYNC_URL` — URL of the sync service (default: `http://localhost:3205`)
- `TEST_AUTH_URL` — URL of the auth service (default: `http://localhost:3201`)

The tests throw at load time if required vars are missing.

## Required GitHub Actions secrets (for CI)

If you fork this repo and want the Docker image build workflow (`.github/workflows/build-images.yml`) to succeed, configure:

**Secrets:**
- `DOCKER_REGISTRY_USERNAME` and `DOCKER_REGISTRY_PASSWORD` for your registry

**Variables:**
- `DOCKER_REGISTRY` — your registry URL (e.g. `registry.example.com` or `docker.io`)

## Pull request checklist

- [ ] Lint and type-check pass for any service you touched
- [ ] Migrations are backwards-compatible when possible
- [ ] New environment variables documented in the README and in the relevant `secrets.*.env.example` template
- [ ] No credentials, private keys, or personal identifiers committed
- [ ] Commit messages follow the conventional format (`type(scope): subject`)

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md). Do not file security reports as public issues.
