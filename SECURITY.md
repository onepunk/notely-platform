# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please **do not** open a public issue. Instead, report it privately using GitHub's private security advisories:

- https://github.com/onepunk/notely-platform/security/advisories/new

Please include:

- A clear description of the issue
- Steps to reproduce
- The affected version or commit hash
- Any proof-of-concept code, if available

Maintainers will triage reports as quickly as they can and coordinate a fix and disclosure timeline privately with the reporter.

## Supported Versions

Security fixes are applied to the most recent tagged release. Older releases are not backported unless the vulnerability is critical and actively exploited.

## Scope

This repository contains the microservices backend. Reports about:

- Any service under `server/services/*` — **in scope**
- The API gateway, authentication, authorization, and session handling — **in scope**
- The license service — **in scope**
- Infrastructure configuration (nginx, docker-compose, CrowdSec) shipped in this repo — **in scope**
- The desktop clients — **out of scope** (report against [`notely-cloud`](https://github.com/onepunk/notely-cloud) or [`notely-ai`](https://github.com/onepunk/notely-ai))

## Credential Handling

- No production credentials are committed. All secrets live in `config/secrets.*.env` files which are gitignored.
- `.env.example` templates contain placeholder values only.
- `config/keys/license-signing-public.pem` is the **public** half of the license signing key; the private half is held externally and is never committed.
- Database test users and passwords required by the test suite must be supplied via environment variables (`TEST_DATABASE_URL`, `TEST_SYNC_URL`, etc.). The test code does not contain any hardcoded credential fallbacks.
- GitHub Actions secrets (`DOCKER_REGISTRY_USERNAME`, `DOCKER_REGISTRY_PASSWORD`, `INTERNAL_API_KEY`, etc.) are configured per-fork and are never hardcoded in workflow files.
