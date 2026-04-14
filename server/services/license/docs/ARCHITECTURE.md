# License Service Architecture

## System Context

The License Service is a core microservice within the Notely platform responsible for generating, validating, and managing cryptographically signed license keys. It enables both online and offline license validation for desktop clients and portal deployments while maintaining strong security guarantees through asymmetric cryptography.

### Purpose

- Generate cryptographically signed license tokens using RSA private keys
- Validate license authenticity and enforce expiration policies
- Manage license lifecycle (issuance, renewal, revocation)
- Enforce hardware binding for portal licenses
- Provide public key distribution for offline validation
- Integrate with the platform's authentication and authorization systems

### Technology Stack

- **Runtime:** Node.js with TypeScript
- **Web Framework:** Express.js with async error handling
- **Cryptography:** jsonwebtoken (RS256 algorithm)
- **Database:** PostgreSQL (license persistence, revocation tracking)
- **Cache:** Redis (rate limiting, validation caching)
- **Authentication:** JWT validation via Auth Service public key

## Integration Points

The License Service integrates with multiple platform components and external clients:

### 1. License Service ↔ PostgreSQL

**Schema:** `license` schema in `notely_v3` database

**Tables:**
- `licenses` - License records with subject, type, features, limits, expiration
- `license_validations` - Validation attempts and results
- `feature_flags` - Feature enablement configuration
- `license_sessions` - Active session tracking for concurrent client enforcement

**Operations:**
- Store generated licenses with metadata (subject, type, features, limits, expiration)
- Record revocation status (`revoked_at` timestamp)
- Track validation attempts for auditing and analytics
- Query revocation status during online validation

**Connection:**
- Pool-based connection management via `src/lib/database.ts`
- Credentials: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

### 2. License Service ↔ Redis

**Purpose:** Rate limiting for public endpoints

**Keys:**
- `ratelimit:validation:{ip}` - Validation endpoint limits (100/min per IP)
- `ratelimit:admin:{userId}` - Admin endpoint limits (1000/min per user)
- `ratelimit:heartbeat:{userId}:{ip}` - Heartbeat limits (20/min per client)

**Operations:**
- INCR counter for request tracking
- EXPIRE for sliding window enforcement
- TTL queries for Retry-After headers

**Connection:**
- Redis client via `src/lib/redis.ts`
- Credentials: `REDIS_HOST`, `REDIS_PORT`
- Fail-open design: allows requests if Redis unavailable

### 3. License Service ↔ Auth Service

**Purpose:** JWT token verification for authenticated endpoints

**Flow:**
```
Client → License Service (with Bearer token)
         ↓
    Verify JWT signature with Auth Service public key
         ↓
    Extract userId, role, scope from token
         ↓
    Attach authContext to request
         ↓
    Proceed to endpoint logic
```

**Configuration:**
- `JWT_PUBLIC_KEY` - Auth Service RSA public key (PEM format)
- Token audience must include `license-service`
- Algorithms: RS256 only

**Middleware:**
- `authMiddleware` - Validates token, extracts user context
- `adminAuthMiddleware` - Requires admin or support role

### 4. License Service ↔ Gateway

**Purpose:** External routing and load balancing

**Routing:**
- `POST /api/license/validate` → Public validation (rate-limited by IP)
- `GET /api/license/public-key` → Public key distribution (rate-limited)
- `POST /api/license/admin/generate` → Admin license generation (authenticated)
- `POST /api/license/admin/revoke/:licenseKey` → License revocation (authenticated)
- `GET /api/license/admin/info/:licenseKey` → License inspection (authenticated)
- `GET /health` → Liveness probe
- `GET /ready` → Readiness probe (checks DB, Redis, keys)

**Service Discovery:**
- Container: `notely-license-v3`
- Internal port: 3210
- Service name in docker-compose: `license`

### 5. Portal UI → License Service

**Admin Operations:**
1. **Generate License**
   - Admin navigates to License Management UI
   - Selects license type (perpetual, subscription, trial)
   - Specifies organizationId, userId, hardwareId (for portal), features, limits, expiration
   - Portal calls `POST /api/license/admin/generate` with JWT
   - Service returns formatted license key
   - Admin distributes key to customer

2. **Revoke License**
   - Admin searches for license or enters key
   - Portal calls `POST /api/license/admin/revoke/:licenseKey` with JWT
   - Service marks license as revoked in database
   - Returns confirmation with revocation timestamp

3. **View License Details**
   - Admin enters license key
   - Portal calls `GET /api/license/admin/info/:licenseKey` with JWT
   - Service decodes and returns license metadata (type, features, limits, expiration)

**User License Entry:**
1. User enters license key in portal settings
2. Portal calls `POST /api/license/validate` with license key and hardware ID
3. Service validates signature, expiration, hardware binding
4. Returns validation result with features and limits
5. Portal enables/disables features based on result

### 6. Desktop Client → License Service

**Online Validation:**
1. Desktop client starts up
2. Reads cached license key from local storage
3. Calls `POST /api/license/validate` with license key (no hardware ID for desktop)
4. Service validates signature, expiration, revocation status
5. Returns validation result with features and limits
6. Desktop enables/disables features accordingly
7. Caches result with timestamp

**Offline Validation:**
1. Desktop client detects no network connectivity
2. Reads cached license key and public key from local storage
3. Validates JWT signature locally using embedded public key
4. Checks expiration timestamp
5. If cached validation < 7 days old, accepts as valid
6. If cached validation > 7 days old, requires online check
7. Continues operation with cached feature set

**Heartbeat (Concurrent Client Enforcement):**
1. Desktop client sends periodic heartbeat (every 5 minutes)
2. Calls `POST /api/heartbeat` with userId and session ID
3. Service tracks active sessions in `license_sessions` table
4. Rejects heartbeat if concurrent client limit exceeded
5. Desktop shows "License limit exceeded" error if rejected

**Public Key Retrieval:**
1. Desktop client checks for embedded public key on first run
2. If missing or outdated, calls `GET /api/license/public-key`
3. Service returns current public key in PEM format
4. Desktop caches public key for offline validation
5. Periodically refreshes (e.g., weekly) to support key rotation

## Component Architecture

The service follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                         API Layer                           │
│  ┌────────────────────┐  ┌────────────────────────────────┐ │
│  │  Health Routes     │  │  Validation Routes             │ │
│  │  /health, /ready   │  │  /api/license/validate         │ │
│  └────────────────────┘  │  /api/license/public-key       │ │
│                          └────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Admin Routes (Auth Required)                         │  │
│  │  /api/license/admin/generate                          │  │
│  │  /api/license/admin/revoke/:licenseKey                │  │
│  │  /api/license/admin/info/:licenseKey                  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    Middleware Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Rate Limit   │  │ Auth         │  │ Admin Auth       │  │
│  │ (Redis)      │  │ (JWT verify) │  │ (Role check)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   Controller Layer                          │
│  ┌────────────────────────┐  ┌──────────────────────────┐  │
│  │ licenseController      │  │ validationController     │  │
│  │ - generateLicense()    │  │ - validateLicense()      │  │
│  │ - revokeLicense()      │  │ - getPublicKey()         │  │
│  │ - getLicenseInfo()     │  └──────────────────────────┘  │
│  └────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                     Service Layer                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────┐  │
│  │ licenseGenerator │  │ licenseValidator │  │ keyMgr   │  │
│  │ - generate       │  │ - validate (async)│  │ - init   │  │
│  │ - validate params│  │ - validateSync    │  │ - getPriv│  │
│  │ - create JWT     │  │ - parseKey        │  │ - getPub │  │
│  │ - sign with RSA  │  │ - verifySignature │  │ - verify │  │
│  │ - format key     │  │ - checkExpiration │  │          │  │
│  │                  │  │ - checkHardware   │  │          │  │
│  │                  │  │ - checkRevocation │  │          │  │
│  └──────────────────┘  └──────────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                  Data Access Layer                          │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Database       │  │ Redis          │  │ File System  │  │
│  │ - getPool()    │  │ - getClient()  │  │ - load keys  │  │
│  │ - query()      │  │ - incr/expire  │  │              │  │
│  └────────────────┘  └────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### API Layer (`src/api/`)

**Routes:**
- `health.routes.ts` - Health and readiness probes
- `validation.routes.ts` - Public validation and key distribution
- `admin.routes.ts` - Admin license operations

**Controllers:**
- `validationController.ts` - License validation and public key retrieval
- `licenseController.ts` - License generation, revocation, inspection

### Middleware Layer (`src/middleware/`)

**Authentication:**
- `auth.middleware.ts`
  - `authMiddleware()` - Validates JWT from Authorization header
  - `adminAuthMiddleware()` - Requires admin or support role

**Rate Limiting:**
- `rateLimiting.middleware.ts`
  - `validationRateLimiter` - 100 req/min per IP (public endpoints)
  - `adminRateLimiter` - 1000 req/min per user (admin endpoints)
  - `heartbeatRateLimiter` - 20 req/min per client (heartbeat endpoint)

### Service Layer (`src/services/`)

**License Generator (`licenseGenerator.ts`):**
- Validates generation parameters (type, organizationId, userId, hardwareId, features, limits)
- Enforces rules: portal requires organizationId + hardwareId, desktop requires userId
- Creates JWT payload with standard claims (iss, sub, jti, iat, exp)
- Signs JWT with RSA private key (RS256 algorithm)
- Formats key with prefix: `NOTELY-PORTAL-{jwt}` or `NOTELY-DESKTOP-{jwt}`

**License Validator (`licenseValidator.ts`):**
- Parses license key format and extracts JWT
- Verifies JWT signature using RSA public key
- Checks expiration timestamp
- Validates hardware binding for portal licenses
- Queries database for revocation status (async)
- Returns structured validation result with features/limits or error code

**Key Manager (`keyManager.ts`):**
- Loads RSA key pair from `config/keys/` on initialization
- Verifies key pair works together (test sign/verify cycle)
- Caches keys in memory for performance
- Provides `getPrivateKey()` and `getPublicKey()` accessors
- Validates PEM format and key integrity

### Data Access Layer (`src/lib/`)

**Database (`database.ts`):**
- PostgreSQL connection pool
- Query methods for licenses, validations, sessions
- Revocation status checks

**Redis (`redis.ts`):**
- Redis client singleton
- Rate limiting operations (INCR, EXPIRE, TTL)
- Health check for readiness probe

**File System:**
- RSA key pair loaded from `config/keys/private.pem` and `config/keys/public.pem`
- Keys must exist before service starts
- Private key secured with `600` permissions

### Models (`src/models/`)

- `License.ts` - License entity definitions
- `LicenseValidation.ts` - Validation record structure
- `FeatureFlag.ts` - Feature configuration schema

### Configuration (`src/config/`)

- `env.ts` - Environment variable loading and validation
- Secrets management via docker-compose env files

## Data Flows

### License Issuance Flow

```
┌───────────────┐                ┌───────────────────┐
│  Admin User   │                │   Portal UI       │
└───────┬───────┘                └─────────┬─────────┘
        │                                  │
        │  1. Navigate to License Mgmt    │
        │─────────────────────────────────>│
        │                                  │
        │  2. Fill license form            │
        │     (type, org, user, features)  │
        │─────────────────────────────────>│
        │                                  │
        │                                  │  3. POST /api/license/admin/generate
        │                                  │     Authorization: Bearer {jwt}
        │                                  │     Body: { type, orgId, userId, ... }
        │                                  │────────────────────────────────────┐
        │                                  │                                    │
        │                                  │                                    ↓
        │                                  │              ┌───────────────────────────┐
        │                                  │              │  License Service          │
        │                                  │              │  - Auth middleware        │
        │                                  │              │  - Admin middleware       │
        │                                  │              │  - Rate limiter           │
        │                                  │              └─────────┬─────────────────┘
        │                                  │                        │
        │                                  │                        │  4. Validate params
        │                                  │                        ↓
        │                                  │              ┌───────────────────────────┐
        │                                  │              │  License Generator        │
        │                                  │              │  - Create JWT payload     │
        │                                  │              │  - Load private key       │
        │                                  │              │  - Sign with RS256        │
        │                                  │              │  - Format: NOTELY-TYPE-jwt│
        │                                  │              └─────────┬─────────────────┘
        │                                  │                        │
        │                                  │                        │  5. Store in DB
        │                                  │                        ↓
        │                                  │              ┌───────────────────────────┐
        │                                  │              │  PostgreSQL               │
        │                                  │              │  INSERT INTO licenses     │
        │                                  │              │    (subject, type, ...)   │
        │                                  │              └─────────┬─────────────────┘
        │                                  │                        │
        │                                  │  6. Return license key │
        │                                  │<───────────────────────┘
        │                                  │     { licenseKey: "NOTELY-..." }
        │  7. Display license key          │
        │<─────────────────────────────────│
        │                                  │
        │  8. Copy and distribute to       │
        │     customer                     │
        │                                  │
```

### Online Validation Flow

```
┌────────────────┐              ┌──────────────────────┐
│ Desktop Client │              │  License Service     │
└────────┬───────┘              └──────────┬───────────┘
         │                                 │
         │  1. Read cached license key    │
         │     from local storage          │
         │                                 │
         │  2. POST /api/license/validate │
         │     Body: { licenseKey }        │
         │────────────────────────────────>│
         │                                 │
         │                                 │  3. Parse key format
         │                                 │     NOTELY-DESKTOP-{jwt}
         │                                 ↓
         │                       ┌─────────────────────┐
         │                       │  License Validator  │
         │                       │  - Extract JWT      │
         │                       │  - Load public key  │
         │                       │  - Verify signature │
         │                       └──────────┬──────────┘
         │                                 │
         │                                 │  4. Check expiration
         │                                 │     exp > now ?
         │                                 ↓
         │                       ┌─────────────────────┐
         │                       │  Validation Logic   │
         │                       │  if (exp < now)     │
         │                       │    return expired   │
         │                       └──────────┬──────────┘
         │                                 │
         │                                 │  5. Check revocation
         │                                 ↓
         │                       ┌─────────────────────┐
         │                       │  PostgreSQL         │
         │                       │  SELECT revoked_at  │
         │                       │  WHERE subject=$1   │
         │                       └──────────┬──────────┘
         │                                 │
         │                                 │  6. Build result
         │                                 ↓
         │                       ┌─────────────────────┐
         │                       │  Validation Result  │
         │                       │  { valid: true,     │
         │                       │    features: [...], │
         │                       │    limits: {...} }  │
         │                       └──────────┬──────────┘
         │                                 │
         │  7. Return validation result    │
         │<────────────────────────────────│
         │                                 │
         │  8. Cache result with timestamp │
         │     (for offline fallback)      │
         │                                 │
         │  9. Enable/disable features     │
         │     based on result             │
         │                                 │
```

### Offline Validation Flow

```
┌────────────────┐
│ Desktop Client │
└────────┬───────┘
         │
         │  1. Detect no network
         │     connectivity
         │
         │  2. Read cached license key
         │     and public key from
         │     local storage
         │
         ↓
┌──────────────────────┐
│  Local Validation    │
│  - Parse license key │
│  - Extract JWT       │
│  - Verify signature  │
│    with public key   │
└──────────┬───────────┘
         │
         │  3. Check expiration
         │     exp > now ?
         ↓
┌──────────────────────┐
│  Expiration Check    │
│  if (exp < now)      │
│    show "expired"    │
│    disable features  │
└──────────┬───────────┘
         │
         │  4. Check cache age
         │     lastValidation < 7d ?
         ↓
┌──────────────────────┐
│  Cache Age Check     │
│  if (cacheAge > 7d)  │
│    require online    │
│    validation        │
│  else                │
│    accept cached     │
│    result            │
└──────────┬───────────┘
         │
         │  5. Enable features
         │     based on cached
         │     validation result
         │
         ↓
┌──────────────────────┐
│  Feature Enablement  │
│  - Read features     │
│  - Read limits       │
│  - Apply to UI       │
└──────────────────────┘
```

**Key Points:**
- Offline validation relies on JWT signature verification with cached public key
- No network calls, no database queries, no revocation checks
- Desktop clients embed public key or download via `GET /api/license/public-key`
- Cached validation results expire after 7 days (configurable)
- Requires online check to refresh cache and verify revocation status

## Trust Boundaries

The License Service implements defense-in-depth with clear trust boundaries:

### Trust Boundary 1: Private Key Isolation

**Location:** License Service container

**Protected Asset:** RSA private key (`config/keys/private.pem`)

**Controls:**
- Private key never exposed via API
- File permissions: `600` (owner read/write only)
- Key loaded once on service startup
- Cached in memory, never written to disk after startup
- Docker volume mount (not in image layers)
- Container runs as non-root user

**Threat Model:**
- Container compromise → Private key compromised → Attacker can issue arbitrary licenses
- Mitigation: Key rotation, audit logs, container security hardening

### Trust Boundary 2: Public Key Distribution

**Location:** License Service → Desktop Clients, Portal Deployments

**Protected Asset:** RSA public key (`config/keys/public.pem`)

**Distribution Methods:**
1. Embedded in desktop client builds (signed app package)
2. Downloaded via `GET /api/license/public-key` (rate-limited)
3. Embedded in portal Docker images

**Controls:**
- Public key is read-only (file permissions: `644`)
- Served via HTTPS in production
- Rate-limited to prevent abuse (100 req/min per IP)
- Versioned with key rotation process

**Threat Model:**
- Public key tampering → Clients validate with wrong key → License validation fails (fail-closed)
- Key rotation lag → Old clients reject new licenses → Mitigated by dual-key support during rotation

### Trust Boundary 3: JWT Signature Verification

**Location:** License Service (online), Desktop Clients (offline)

**Protected Asset:** License authenticity

**Controls:**
- RS256 algorithm (asymmetric cryptography)
- Signature verified with public key before trusting payload
- Algorithm whitelist (only RS256 accepted, prevents "none" attack)
- Expiration checked after signature verification
- Subject, issuer, and audience claims validated

**Threat Model:**
- JWT tampering → Signature verification fails → License rejected
- Expired license → Expiration check fails → License rejected
- Replay attack → Revocation check in database → License rejected

### Trust Boundary 4: Hardware Binding (Portal Licenses)

**Location:** Portal deployment validation

**Protected Asset:** Portal license tied to specific hardware

**Controls:**
- Hardware ID collected from portal server (MAC address, motherboard serial, etc.)
- Hardware ID included in JWT payload (`hwid` claim)
- Validation requires matching hardware ID
- Hardware ID cannot be changed without new license

**Threat Model:**
- License copied to different hardware → Hardware ID mismatch → License rejected
- Hardware ID spoofing → Requires root access to portal server → Out of scope

### Trust Boundary 5: Admin Operations

**Location:** Portal UI → License Service API

**Protected Asset:** License generation and revocation

**Controls:**
- JWT authentication required (Auth Service token)
- Admin or support role required (`adminAuthMiddleware`)
- Rate-limited (1000 req/min per user)
- Audit logging for all operations
- TLS encryption in transit

**Threat Model:**
- Unauthorized license generation → Auth middleware rejects non-admin users
- Stolen admin token → Audit logs track misuse, token expiration limits window
- Brute force → Rate limiter blocks excessive requests

### Trust Boundary 6: Revocation Enforcement

**Location:** License Service database

**Protected Asset:** Revoked license list

**Controls:**
- Revocation status stored in `licenses.revoked_at` column
- Online validation queries database for revocation
- Offline validation cannot check revocation (7-day cache limit)
- Admin-only revocation API

**Threat Model:**
- License revoked but cached offline → Accepted for up to 7 days → Acceptable risk for desktop
- Database compromise → Attacker clears revocation flags → Mitigated by database access controls
- Offline validation bypass → User never connects → Mitigated by 7-day cache expiration

## Security Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                    Trust Boundary 1                            │
│              License Service Container                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Private Key (config/keys/private.pem)                   │  │
│  │  - Permissions: 600 (owner only)                         │  │
│  │  - Never exposed via API                                 │  │
│  │  - Cached in memory only                                 │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │ Signs JWT                               │
│                      ↓                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  License Generator                                        │  │
│  │  - Creates JWT with RS256                                │  │
│  │  - Returns: NOTELY-TYPE-{signed_jwt}                     │  │
│  └───────────────────┬──────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                       │
                       │ Trust Boundary 2
                       │ (Public Key Distribution)
                       ↓
┌────────────────────────────────────────────────────────────────┐
│                    Desktop Client / Portal                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Public Key (embedded or downloaded)                     │  │
│  │  - Verifies JWT signatures                               │  │
│  │  - Cannot sign new licenses                              │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │ Trust Boundary 3                        │
│                      │ (JWT Verification)                      │
│                      ↓                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  License Validator (Client-Side)                         │  │
│  │  - Verify signature with public key                      │  │
│  │  - Check expiration (exp claim)                          │  │
│  │  - Check hardware binding (hwid claim)                   │  │
│  │  - Trusted only after verification                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                       │
                       │ Trust Boundary 5
                       │ (Admin Operations)
                       ↓
┌────────────────────────────────────────────────────────────────┐
│                    Portal Admin UI                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Admin Token (from Auth Service)                         │  │
│  │  - JWT with role=admin                                   │  │
│  │  - Required for license operations                       │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                          │
│                      │ Authorization: Bearer {admin_jwt}       │
│                      ↓                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  License Service API                                      │  │
│  │  - authMiddleware: Verify admin token                    │  │
│  │  - adminAuthMiddleware: Check role                       │  │
│  │  - adminRateLimiter: Limit requests                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                       │
                       │ Trust Boundary 6
                       │ (Revocation Database)
                       ↓
┌────────────────────────────────────────────────────────────────┐
│                    PostgreSQL                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  licenses table                                           │  │
│  │  - subject (license ID)                                   │  │
│  │  - revoked_at (timestamp or NULL)                        │  │
│  │  - Access controls: license service only                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Docker Network                          │
│                      notely-network (bridge)                    │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Gateway (notely-gateway-v3)                              │ │
│  │  - Routes /api/license/* to license service              │ │
│  │  - TLS termination                                        │ │
│  │  - Load balancing (if scaled)                            │ │
│  └───────────────────┬───────────────────────────────────────┘ │
│                      │                                          │
│                      ↓                                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  License Service (notely-license-v3)                      │ │
│  │  Container: notely-license-v3                             │ │
│  │  Image: notely/license:v3                                 │ │
│  │  Port: 3210                                               │ │
│  │  Env:                                                     │ │
│  │    - NODE_ENV                                             │ │
│  │    - LICENSE_SERVICE_PORT=3210                            │ │
│  │    - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD     │ │
│  │    - REDIS_HOST, REDIS_PORT                               │ │
│  │    - JWT_PUBLIC_KEY (Auth Service public key)             │ │
│  │  Volumes:                                                 │ │
│  │    - ./services/license/config/keys:/app/config/keys:ro  │ │
│  │  Depends on: postgres, redis                             │ │
│  └───────────┬───────────────────────────────────┬───────────┘ │
│              │                                   │              │
│              ↓                                   ↓              │
│  ┌─────────────────────┐           ┌─────────────────────────┐ │
│  │  PostgreSQL         │           │  Redis                  │ │
│  │  notely-postgres-v3 │           │  notely-redis-v3        │ │
│  │  Port: 5432         │           │  Port: 6379             │ │
│  │  Database: notely_v3│           │  Rate limiting data     │ │
│  │  Schema: license    │           │  - Counters             │ │
│  │  Tables:            │           │  - Expirations          │ │
│  │  - licenses         │           └─────────────────────────┘ │
│  │  - validations      │                                        │
│  │  - feature_flags    │                                        │
│  │  - sessions         │                                        │
│  └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration Management

### Environment Variables

**Required:**
- `LICENSE_SERVICE_PORT` - HTTP server port (default: 3210)
- `NODE_ENV` - Environment (development, production)
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` - PostgreSQL connection
- `REDIS_HOST`, `REDIS_PORT` - Redis connection
- `JWT_PUBLIC_KEY` - Auth Service public key (PEM format with `\n` escapes)

**Optional:**
- `LOG_LEVEL` - Logging verbosity (debug, info, warn, error)

### Key Pair Management

**Location:** `services/license/config/keys/`

**Files:**
- `private.pem` - RSA private key (4096-bit recommended)
- `public.pem` - RSA public key (extracted from private key)

**Permissions:**
- `private.pem`: `600` (owner read/write only)
- `public.pem`: `644` (world-readable)

**Generation:**
```bash
# Generate private key
openssl genrsa -out private.pem 4096

# Extract public key
openssl rsa -in private.pem -pubout -out public.pem

# Set permissions
chmod 600 private.pem
chmod 644 public.pem
```

**Security:**
- Private key must never be committed to version control
- Private key should be rotated annually (see KEY_ROTATION.md)
- Public key distributed to clients via API or embedded in builds

## Monitoring and Observability

### Health Endpoints

**Liveness Probe:**
- `GET /health`
- Returns 200 OK if service is running
- Does not check dependencies

**Readiness Probe:**
- `GET /ready`
- Checks: PostgreSQL connectivity, Redis connectivity, key files accessible
- Returns 200 OK if all checks pass
- Returns 503 Service Unavailable if any check fails

### Metrics

**Rate Limiting:**
- X-RateLimit-Limit header (max requests per window)
- X-RateLimit-Remaining header (requests remaining)
- X-RateLimit-Reset header (window reset timestamp)

**Logging:**
- Structured JSON logs via Winston
- Request/response logging
- Error logging with stack traces (development only)
- Authentication failures
- Rate limit violations
- License validation attempts

### Audit Trail

**License Operations:**
- Generation: Log organizationId, userId, type, features, limits, issuedBy
- Revocation: Log licenseId, revokedBy, revokedAt, reason
- Validation: Log licenseId, result, clientIp, userId (optional)

**Storage:**
- `license.license_validations` table for validation history
- Application logs for operational events

## Error Handling

### HTTP Status Codes

- `200 OK` - Successful validation or operation
- `201 Created` - License generated successfully
- `400 Bad Request` - Invalid parameters or malformed license key
- `401 Unauthorized` - Missing or invalid authentication token
- `403 Forbidden` - Insufficient permissions (non-admin)
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server-side error (key loading failure, database error)
- `503 Service Unavailable` - Service not ready (dependencies unavailable)

### Error Response Format

```json
{
  "error": "error_code",
  "message": "Human-readable error message",
  "details": [
    {
      "field": "fieldName",
      "message": "Validation error for this field"
    }
  ]
}
```

### Validation Error Codes

- `INVALID_FORMAT` - License key format invalid
- `INVALID_SIGNATURE` - JWT signature verification failed
- `LICENSE_EXPIRED` - License expiration date passed
- `MISSING_HWID` - Portal license missing required hardware ID
- `HWID_MISMATCH` - Hardware ID doesn't match license binding
- `LICENSE_REVOKED` - License has been revoked

## Future Enhancements

### Planned Features

1. **License Analytics Dashboard**
   - Active license count by type
   - Validation attempts over time
   - Revocation trends
   - Feature usage statistics

2. **License Renewal Automation**
   - Email notifications before expiration
   - Auto-renewal for subscription licenses
   - Grace period enforcement

3. **Multi-Tenant License Management**
   - Organization-level license pooling
   - License seat allocation
   - Usage tracking per user

4. **Offline Validation Cache Sync**
   - Batch validation API for desktop clients
   - Periodic cache refresh mechanism
   - Conflict resolution for offline/online validation

5. **License Transfer**
   - Transfer license between users or organizations
   - Hardware ID update for portal migrations
   - Audit trail for transfers

### Technical Debt

1. **Database Models**
   - Complete TypeScript models for all tables
   - ORM integration (TypeORM or Prisma)
   - Migration management (Flyway integration)

2. **Test Coverage**
   - Unit tests for all services
   - Integration tests for API endpoints
   - End-to-end validation scenarios
   - Load testing for rate limiter

3. **API Documentation**
   - OpenAPI/Swagger specification
   - Interactive API explorer
   - Client SDK generation

4. **Caching Strategy**
   - Redis caching for license validation results
   - Cache invalidation on revocation
   - TTL configuration per license type
