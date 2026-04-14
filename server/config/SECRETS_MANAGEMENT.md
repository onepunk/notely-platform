# Secrets Management Guide

**Last Updated:** October 21, 2025

## Overview

Notely V3 uses a **three-tiered secrets management** approach:
1. **Development:** File-based secrets (`secrets.env`)
2. **Production (Recommended):** Azure Key Vault integration
3. **Future (Optional):** HashiCorp Vault for multi-cloud/advanced scenarios

This guide covers the current file-based system with security best practices.

## Quick Start

### First-Time Setup

```bash
# 1. Navigate to server directory
cd ./server

# 2. Generate secure secrets automatically
./scripts/generate-secrets.sh

# 3. Configure OAuth credentials (see below)
vim config/secrets.env

# 4. Generate platform configuration
./scripts/configure-domains.sh --base-domain yourdomain.com --apply
```

### Existing Installation

If `secrets.env` already exists, the script will prompt you:
- Option 1: Keep existing (safe)
- Option 2: Regenerate missing/placeholder secrets only (recommended for rotation)
- Option 3: Regenerate ALL secrets (destructive - loses OAuth config)

## Scripts Overview

### `generate-secrets.sh`

Generates cryptographically secure secrets using OpenSSL.

**Usage:**
```bash
# Interactive mode (recommended for first run)
./scripts/generate-secrets.sh

# Regenerate only missing/weak secrets (safe - preserves OAuth)
./scripts/generate-secrets.sh --missing-only

# Emergency rotation - regenerate everything (DESTRUCTIVE)
./scripts/generate-secrets.sh --force
```

**What it generates:**
- ✅ JWT_SECRET (64 chars hex)
- ✅ JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (RSA 4096-bit, PEM with escaped newlines)
- ✅ ENCRYPTION_KEY (128 chars hex)
- ✅ PostgreSQL passwords for all 9 services (40 chars base64)
- ✅ Redis password (40 chars base64)
- ✅ Webhook secrets (64 chars hex)

**What it preserves:**
- OAuth credentials (Microsoft, Google)
- Email configuration
- External service tokens
- ACS settings

**Security features:**
- Uses `openssl rand` for cryptographically secure generation
- Automatically creates backup before overwriting
- Sets file permissions to `600` (owner read/write only)
- Validates generated secret strength

### `configure-domains.sh` (Enhanced)

Generates platform `.env` file from base config + secrets + domain settings.

**New Security Features:**

1. **Configuration Consistency:** Validates that all variables in `base.env` and `secrets.env.example` are present in `root.env.template`. This prevents configuration drift where new variables are added but not propagated to containers.
2. **Age Warning:** Warns if `secrets.env` is >90 days old
3. **Strength Validation:**
   - JWT_SECRET must be ≥32 chars (recommends 64)
   - JWT_PRIVATE_KEY / JWT_PUBLIC_KEY must be populated with PEM material
   - ENCRYPTION_KEY must be ≥64 chars (recommends 128)
   - Database passwords should be 20+ chars
4. **Placeholder Detection:** Fails if secrets contain placeholder values (including JWT key pair)
5. **Automatic Remediation:** Suggests running `generate-secrets.sh` on failure

**Example output:**
```
ℹ Validating environment variable configuration...
✓ Environment variable configuration validated
ℹ Validating secret age and strength...
✓ secrets.env age: 15 days (fresh)
✓ JWT_SECRET length: 64 chars ✓
✓ ENCRYPTION_KEY length: 128 chars ✓
✓ Secret validation passed
```

**Configuration consistency failure example:**
```
✗ Environment variable validation failed!

Variables in base.env missing from root.env.template:
  - NEW_SERVICE_PORT
  - NEW_FEATURE_ENABLED

To fix this issue:
  1. Add missing variables to: config/root.env.template
     Example: VARIABLE_NAME=${VARIABLE_NAME}

  2. Export them in configure-domains.sh (lines ~600-830)
     Example: export VARIABLE_NAME
```

## Secret Types and Requirements

### Critical Secrets (Auto-Generated)

| Secret | Length | Format | Purpose |
|--------|--------|--------|---------|
| JWT_SECRET | 64 chars | Hex | Legacy token signing (desktop compatibility) |
| JWT_PRIVATE_KEY / JWT_PUBLIC_KEY | RSA 4096-bit | PEM (`\n` escaped) | OIDC/JWT signing + JWKS |
| ENCRYPTION_KEY | 128 chars | Hex | Data encryption |
| POSTGRES_PASSWORD | 40 chars | Base64 | Admin DB user |
| POSTGRES_*_PASSWORD | 40 chars | Base64 | Service DB users (9x) |
| REDIS_PASSWORD | 40 chars | Base64 | Redis auth |
| *_WEBHOOK_SECRET | 64 chars | Hex | Webhook validation |
| CROWDSEC_API_KEY | Variable | Base64 | CrowdSec bouncer auth |

### JWT Key Pair Handling

The auth service signs every JWT with the RSA key pair stored in `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`.

- **Generation:** `generate-secrets.sh` produces a 4096‑bit pair and escapes newlines so it can live inside `secrets.env`. If you prefer to keep the PEM blobs out of the env file, set `JWT_PRIVATE_KEY_FILE` / `JWT_PUBLIC_KEY_FILE` and mount the files from your secret manager instead.
- **Rotation workflow:**
  1. Remove the existing `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` entries from `secrets.env` and run `./scripts/generate-secrets.sh --missing-only` — the script will backfill a new pair, or paste the replacement PEMs from your KMS.
  2. Update `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, and bump `JWT_KEY_ID` to a new value.
  3. Deploy the new secrets, restart the auth service, then flush any gateway JWKS caches (the gateway refetches automatically on startup or when `kid` changes).
  4. Monitor `/api/oauth/.well-known/jwks.json` to confirm the new key is published before invalidating the previous tokens.
- **Editing tips:** When hand-editing `secrets.env`, keep the `\n`-escaped format. Converting it to literal newlines will break the parser that loads env files.
- **Storage guidance:** In production, store the PEMs in your cloud secret manager or HSM; avoid checking them into Git or leaving them unencrypted on disk.

### Manual Configuration Required

#### Microsoft OAuth (Required)

```bash
# Azure Portal → Azure Active Directory → App Registrations
MICROSOFT_CLIENT_ID=your_app_client_id
MICROSOFT_CLIENT_SECRET=your_app_client_secret
MICROSOFT_TENANT=your_tenant_id_or_common
```

**Setup Steps:**
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Create new registration or use existing "Notely Platform"
4. Copy **Application (client) ID** → `MICROSOFT_CLIENT_ID`
5. Go to **Certificates & secrets** → New client secret
6. Copy secret value → `MICROSOFT_CLIENT_SECRET`
7. Note **Directory (tenant) ID** → `MICROSOFT_TENANT`
8. Add redirect URIs in **Authentication**:
   - `https://api.yourdomain.com/api/auth/microsoft/callback`
   - `https://api.yourdomain.com/api/auth/microsoft/desktop/callback`

#### Google OAuth (Optional - for Google Calendar)

```bash
# Google Cloud Console → APIs & Services → Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

**Setup Steps:**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select project or create new
3. Navigate to **APIs & Services** → **Credentials**
4. Create **OAuth 2.0 Client ID** (Web application)
5. Add authorized redirect URIs:
   - `https://api.yourdomain.com/api/calendar/google/callback`

#### Azure Communication Services (Optional - for Teams Meeting Join)

```bash
# Azure Portal → Communication Services
ACS_ENDPOINT=https://your-acs-resource.communication.azure.com
ACS_RESOURCE_ID=your-immutable-resource-id-guid
ACS_CONNECTION_STRING=endpoint=https://...;accesskey=...
```

#### CrowdSec (Security - Intrusion Prevention)

```bash
# Generated after deploying CrowdSec container
CROWDSEC_API_KEY=your_crowdsec_api_key
```

**Setup Steps:**
1. Deploy CrowdSec: `docker compose up -d crowdsec`
2. Generate bouncer key: `docker exec notely-crowdsec-v3 cscli bouncers add firewall-bouncer -o raw`
3. Copy the generated key → `CROWDSEC_API_KEY`
4. Install firewall bouncer on host: `sudo apt install crowdsec-firewall-bouncer-iptables`
5. Configure bouncer with the API key in `/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml`

## Security Best Practices

### File Permissions

The `generate-secrets.sh` script automatically sets:
```bash
chmod 600 config/secrets.env  # Owner read/write only
```

Verify permissions:
```bash
ls -la config/secrets.env
# Should show: -rw------- (600)
```

### Secret Rotation Schedule

| Secret Type | Rotation Frequency | Method |
|-------------|-------------------|--------|
| JWT_SECRET | Quarterly (90 days) | `generate-secrets.sh --missing-only` |
| ENCRYPTION_KEY | Annually | Manual (requires data re-encryption) |
| Database passwords | Quarterly | `generate-secrets.sh --missing-only` |
| OAuth secrets | When compromised | Azure/Google console |
| Webhook secrets | Quarterly | `generate-secrets.sh --missing-only` |

**Automated reminders:**
`configure-domains.sh` will warn you when secrets are >90 days old.

### Backup Strategy

**Before Rotation:**
```bash
# Manual backup
cp config/secrets.env config/secrets.env.backup.$(date +%Y%m%d)

# Encrypt backup (recommended)
gpg --symmetric --cipher-algo AES256 config/secrets.env.backup.20251021
```

**Automatic backups:**
`generate-secrets.sh` automatically creates timestamped backups:
```
config/secrets.env.backup.20251021_143022
```

### Version Control Protection

**Critical: Never commit `secrets.env` to Git!**

Verify `.gitignore` contains:
```bash
# Should already be in .gitignore
config/secrets.env
config/secrets.*.backup.*
.env
```

Check for accidental commits:
```bash
git log --all --full-history -- config/secrets.env
# Should return: nothing
```

If accidentally committed:
```bash
# DANGER: Rewrites history - coordinate with team
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch config/secrets.env' \
  --prune-empty --tag-name-filter cat -- --all

# Rotate ALL secrets immediately
./scripts/generate-secrets.sh --force
```

## Troubleshooting

### Error: "Environment variable validation failed"

**Cause:** Variables in `base.env` or `secrets.env.example` are missing from `root.env.template`

**Solution:**
1. Add the missing variables to `config/root.env.template`:
   ```bash
   VARIABLE_NAME=${VARIABLE_NAME}
   ```
2. Add the corresponding export in `scripts/configure-domains.sh` (around lines 744-930):
   ```bash
   export VARIABLE_NAME
   ```
3. If the variable is intentionally internal-only (used by the script but not needed in containers), add it to the `INTERNAL_VARS` array in the `validate_env_template` function.

### Error: "JWT_SECRET is too short"

**Cause:** Secret doesn't meet minimum length requirement

**Solution:**
```bash
./scripts/generate-secrets.sh --missing-only
./scripts/configure-domains.sh --base-domain yourdomain.com --apply
```

### Warning: "secrets.env is 120 days old"

**Cause:** Secrets haven't been rotated in >90 days

**Solution:**
```bash
# Rotate secrets (preserves OAuth credentials)
./scripts/generate-secrets.sh --missing-only

# Or manually edit secrets.env and update timestamp
touch config/secrets.env
```

### Error: "Placeholder values found in secrets.env"

**Cause:** OAuth credentials not configured

**Solution:**
1. Configure OAuth credentials in Azure/Google consoles
2. Edit `config/secrets.env` with real values
3. Re-run: `./scripts/configure-domains.sh --base-domain yourdomain.com --apply`

### Secret strength report shows "short" warnings

**Non-blocking warnings:**
```
⚠ JWT_SECRET is short (48 chars) - recommend 64+ chars
```

**Action:** Not critical, but regenerate for better security:
```bash
./scripts/generate-secrets.sh --missing-only
```

## Migration Paths

### Current: File-Based Secrets

**Status:** ✅ Production-ready for current scale
**Best for:** Development, small teams, single-cloud deployments

### Near-Term: Azure Key Vault

**Timeline:** Production deployment (6-12 months)
**Best for:** Production security, compliance (SOC2/HIPAA)

**Migration preview:**
```typescript
// Future: services/packages/secrets/azure-keyvault.ts
import { SecretClient } from "@azure/keyvault-secrets";

export async function loadSecrets() {
  const client = new SecretClient(
    process.env.AZURE_KEYVAULT_URL,
    new DefaultAzureCredential()
  );

  return {
    jwtSecret: await client.getSecret("jwt-secret"),
    postgresPassword: await client.getSecret("postgres-password"),
    // ...
  };
}
```

### Long-Term: HashiCorp Vault (Optional)

**Timeline:** Enterprise scale (12+ months, if needed)
**Best for:** Multi-cloud, Kubernetes, 50+ services

**Triggers for migration:**
- Deploying to 3+ cloud providers
- Running on Kubernetes
- Dedicated platform team (2+ engineers)
- Dynamic credential rotation required

## Environment-Specific Secrets

### Development vs Production

**Development:**
```bash
config/secrets.development.env  # Localhost, test OAuth apps
```

**Staging:**
```bash
config/secrets.staging.env      # Staging domain, separate OAuth
```

**Production:**
```bash
config/secrets.production.env   # Production domain, verified OAuth
```

**Usage:**
```bash
# Link appropriate file
ln -sf secrets.production.env secrets.env

# Generate config
./scripts/configure-domains.sh --base-domain yourdomain.com --environment production --apply
```

## Validation Commands

### Check Secret Health

```bash
# Full validation (runs automatically with configure-domains.sh)
cd server
./scripts/configure-domains.sh --base-domain yourdomain.com --skip-restart

# Check file age manually
stat -c '%y' config/secrets.env

# Verify no placeholders
grep -i "your_\|placeholder\|secret_here" config/secrets.env
# Should return: nothing
```

### Test Secret Strength

```bash
# Check JWT_SECRET length
JWT_SECRET=$(grep "^JWT_SECRET=" config/secrets.env | cut -d= -f2)
echo "JWT_SECRET length: ${#JWT_SECRET} chars"
# Should show: 64+

# Check ENCRYPTION_KEY length
ENCRYPTION_KEY=$(grep "^ENCRYPTION_KEY=" config/secrets.env | cut -d= -f2)
echo "ENCRYPTION_KEY length: ${#ENCRYPTION_KEY} chars"
# Should show: 128+
```

## FAQ

**Q: Can I use the same secrets in dev and production?**
A: **NO.** Always use separate secrets per environment.

**Q: How do I share secrets with my team?**
A: Use encrypted password managers (1Password, LastPass) or secure file sharing with GPG encryption. Never email or Slack unencrypted secrets.

**Q: What happens if I lose secrets.env?**
A: You'll need to regenerate all secrets, reconfigure OAuth in Azure/Google, and restart all services. **Always maintain encrypted backups.**

**Q: Can I manually edit secrets.env?**
A: Yes, but use `generate-secrets.sh` for better security. Manual edits are fine for OAuth credentials.

**Q: Do I need to restart services after rotation?**
A: Yes. Run: `./scripts/configure-domains.sh --base-domain yourdomain.com --apply`

**Q: How do I audit secret access?**
A: Currently: Check container logs. Future: Azure Key Vault provides full audit trails.

## Related Documentation

- [Configuration System](./CLAUDE.md) - Overall config architecture
- [Configure Domains Script](./README.md) - Domain configuration guide
- [V3 Architecture](../docs/OVERVIEW.md) - Platform overview
- [Security Best Practices](../docs/SECURITY.md) - Platform security (TBD)

## Support

**Issues with secret generation:**
```bash
# Check OpenSSL is installed
openssl version
# Should show: OpenSSL 1.1.1+ or OpenSSL 3.x

# Manually generate a test secret
openssl rand -hex 32
# Should output: 64 character hex string
```

**Script errors:**
Check script has execute permissions:
```bash
ls -la scripts/generate-secrets.sh
# Should show: -rwxr-xr-x (executable)

# Fix if needed
chmod +x scripts/generate-secrets.sh
```
