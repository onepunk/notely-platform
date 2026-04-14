# License Service Key Rotation

## Overview

The License Service uses RSA asymmetric cryptography to sign and validate license keys. The private key signs licenses, while the public key validates them. Key rotation is essential for maintaining security over time, limiting the impact of potential key compromise, and following cryptographic best practices.

### Why Key Rotation is Necessary

1. **Limit Compromise Impact:** If a private key is compromised, rotation limits the window of time an attacker can issue fraudulent licenses
2. **Cryptographic Hygiene:** Regular rotation prevents accumulation of signed licenses that could be analyzed for cryptanalysis
3. **Compliance:** Many security standards require periodic key rotation (e.g., annually)
4. **Detection Window:** Suspicious activity with old keys can be detected and isolated
5. **Graceful Migration:** Planned rotation allows gradual client updates without service disruption

### Key Rotation Strategy

**Dual-Key Support During Transition:**
- Service signs new licenses with latest key version (v2)
- Service validates licenses with both old (v1) and new (v2) public keys
- Old key marked for retirement after migration period
- Clients update public key through app updates or API download

**Frequency:**
- Annual rotation (scheduled)
- Emergency rotation (on-demand if compromise suspected)

## 6-Step Key Rotation Process

### Step 1: Generate New Key Pair (v2)

Generate a new RSA key pair and store it securely.

```bash
# Navigate to license service directory
cd ./server/services/license

# Create backup directory for old keys
mkdir -p config/keys/archive/$(date +%Y-%m-%d)

# Backup current keys
cp config/keys/private.pem config/keys/archive/$(date +%Y-%m-%d)/private-v1.pem
cp config/keys/public.pem config/keys/archive/$(date +%Y-%m-%d)/public-v1.pem

# Generate new private key (4096-bit RSA)
openssl genrsa -out config/keys/private-v2.pem 4096

# Extract new public key
openssl rsa -in config/keys/private-v2.pem -pubout -out config/keys/public-v2.pem

# Set secure permissions
chmod 600 config/keys/private-v2.pem
chmod 644 config/keys/public-v2.pem

# Verify key pair works together
openssl rsa -in config/keys/private-v2.pem -pubout -text -noout
openssl rsa -pubin -in config/keys/public-v2.pem -text -noout
```

**File Structure After Step 1:**
```
config/keys/
├── private.pem         # v1 (current, still active)
├── public.pem          # v1 (current, still active)
├── private-v2.pem      # v2 (new, not yet active)
├── public-v2.pem       # v2 (new, not yet active)
└── archive/
    └── 2025-11-13/
        ├── private-v1.pem  # Backup of v1
        └── public-v1.pem   # Backup of v1
```

**Verification:**
```bash
# Test that v2 key pair can sign and verify
echo "test payload" > /tmp/test.txt
openssl dgst -sha256 -sign config/keys/private-v2.pem -out /tmp/test.sig /tmp/test.txt
openssl dgst -sha256 -verify config/keys/public-v2.pem -signature /tmp/test.sig /tmp/test.txt
# Should output: Verified OK

# Clean up
rm /tmp/test.txt /tmp/test.sig
```

### Step 2: Update Service to Sign with v2

Update the keyManager service to load both v1 and v2 keys, and configure signing to use v2.

**Code Changes in `src/services/keyManager.ts`:**

```typescript
// Add version support
const PRIVATE_KEY_V1_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_V1_PATH = path.join(KEYS_DIR, 'public.pem');
const PRIVATE_KEY_V2_PATH = path.join(KEYS_DIR, 'private-v2.pem');
const PUBLIC_KEY_V2_PATH = path.join(KEYS_DIR, 'public-v2.pem');

// Cache for both key versions
let cachedPrivateKeyV1: string | null = null;
let cachedPublicKeyV1: string | null = null;
let cachedPrivateKeyV2: string | null = null;
let cachedPublicKeyV2: string | null = null;

// Load all keys on initialization
export function initialize(): void {
  try {
    // Load v1 keys (for validation only)
    cachedPrivateKeyV1 = loadPrivateKey(PRIVATE_KEY_V1_PATH);
    cachedPublicKeyV1 = loadPublicKey(PUBLIC_KEY_V1_PATH);

    // Load v2 keys (for signing and validation)
    cachedPrivateKeyV2 = loadPrivateKey(PRIVATE_KEY_V2_PATH);
    cachedPublicKeyV2 = loadPublicKey(PUBLIC_KEY_V2_PATH);

    // Verify both key pairs
    const isV1Valid = verifyKeyPair(cachedPrivateKeyV1, cachedPublicKeyV1);
    const isV2Valid = verifyKeyPair(cachedPrivateKeyV2, cachedPublicKeyV2);

    if (!isV1Valid || !isV2Valid) {
      throw new Error('Key pair verification failed');
    }

    console.log('Key Manager initialized with dual-key support');
    console.log('- v1 keys loaded (validation only)');
    console.log('- v2 keys loaded (signing and validation)');
  } catch (error) {
    throw new Error(`Key Manager initialization failed: ${error.message}`);
  }
}

// Use v2 for signing (latest version)
export function getPrivateKey(): string {
  if (!cachedPrivateKeyV2) {
    throw new Error('Private key v2 not initialized');
  }
  return cachedPrivateKeyV2;
}

// Return array of public keys for validation
export function getPublicKeys(): string[] {
  const keys: string[] = [];
  if (cachedPublicKeyV2) keys.push(cachedPublicKeyV2); // Try v2 first
  if (cachedPublicKeyV1) keys.push(cachedPublicKeyV1); // Fallback to v1
  return keys;
}

// Backward compatibility - returns v2 by default
export function getPublicKey(): string {
  if (!cachedPublicKeyV2) {
    throw new Error('Public key v2 not initialized');
  }
  return cachedPublicKeyV2;
}
```

**Code Changes in `src/services/licenseValidator.ts`:**

```typescript
/**
 * Verify JWT signature with multiple public key versions
 */
function verifySignature(jwtToken: string): LicensePayload {
  const publicKeys = keyManager.getPublicKeys();

  // Try each public key version
  for (const publicKey of publicKeys) {
    try {
      const decoded = jwt.verify(jwtToken, publicKey, {
        algorithms: ['RS256'],
      });

      if (typeof decoded === 'string') {
        continue; // Skip and try next key
      }

      return decoded as LicensePayload;
    } catch (error) {
      // If this is the last key and verification failed, throw
      if (publicKey === publicKeys[publicKeys.length - 1]) {
        if (error instanceof jwt.JsonWebTokenError) {
          throw new Error(`JWT signature verification failed: ${error.message}`);
        }
        if (error instanceof jwt.TokenExpiredError) {
          throw new Error('JWT token has expired');
        }
        throw error;
      }
      // Otherwise, continue to next key version
      continue;
    }
  }

  throw new Error('JWT signature verification failed with all key versions');
}
```

**Deployment:**
```bash
# Rebuild the service
cd ./server
docker compose build --no-cache license

# Recreate the container
docker compose up -d --force-recreate --no-deps license

# Verify service started successfully
docker compose logs -f license

# Check readiness probe
curl http://localhost:3210/ready
```

**Verification:**
```bash
# Test that service signs with v2 and validates both v1 and v2
# Generate a new license (should use v2)
curl -X POST http://localhost:3210/api/license/admin/generate \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "trial",
    "organizationId": "00000000-0000-0000-0000-000000000001",
    "userId": "00000000-0000-0000-0000-000000000002",
    "features": {"test": true},
    "limits": {"maxUsers": 1},
    "expiresAt": "2025-12-31T23:59:59Z"
  }'

# Validate an old license (signed with v1, should still work)
curl -X POST http://localhost:3210/api/license/validate \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "$OLD_LICENSE_KEY"}'

# Validate the new license (signed with v2, should work)
curl -X POST http://localhost:3210/api/license/validate \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "$NEW_LICENSE_KEY"}'
```

### Step 3: Keep v1 Public Key for Validating Old Licenses

This step is completed in Step 2 by implementing dual-key validation support. The service now:
- Signs new licenses with v2 private key
- Validates licenses with both v2 and v1 public keys
- Tries v2 first, falls back to v1 if signature doesn't match

**No additional action required.** The code changes in Step 2 ensure backward compatibility.

### Step 4: Set Expiry Dates on Old Licenses

Update existing licenses in the database to add expiration dates if they don't already have them. This ensures all v1-signed licenses eventually expire.

```sql
-- Connect to database
-- docker exec -it notely-postgres-v3 psql -U notely_v3_user -d notely_v3

-- Check licenses without expiration
SELECT
  subject,
  type,
  issued_at,
  expires_at,
  revoked_at
FROM license.licenses
WHERE expires_at IS NULL
ORDER BY issued_at DESC;

-- Set expiration for perpetual licenses (e.g., 2 years from now)
UPDATE license.licenses
SET expires_at = CURRENT_TIMESTAMP + INTERVAL '2 years'
WHERE expires_at IS NULL
  AND type = 'perpetual';

-- Set expiration for trial licenses (e.g., 90 days from issue date)
UPDATE license.licenses
SET expires_at = issued_at + INTERVAL '90 days'
WHERE expires_at IS NULL
  AND type = 'trial';

-- Verify updates
SELECT
  subject,
  type,
  issued_at,
  expires_at,
  expires_at - CURRENT_TIMESTAMP AS time_until_expiry
FROM license.licenses
WHERE expires_at IS NOT NULL
ORDER BY expires_at ASC
LIMIT 20;
```

**Migration Period Planning:**
- Perpetual licenses: 2-year migration window
- Subscription licenses: Natural renewal cycle
- Trial licenses: 90-day window
- Desktop clients: Update via auto-update mechanism
- Portal deployments: Update via Docker image refresh

**Notification Strategy:**
```sql
-- Identify licenses expiring soon (within 60 days)
SELECT
  l.subject,
  l.type,
  o.name AS organization_name,
  o.email AS contact_email,
  l.expires_at,
  EXTRACT(DAY FROM l.expires_at - CURRENT_TIMESTAMP) AS days_until_expiry
FROM license.licenses l
JOIN organizations o ON l.organization_id = o.id
WHERE l.expires_at BETWEEN CURRENT_TIMESTAMP AND CURRENT_TIMESTAMP + INTERVAL '60 days'
  AND l.revoked_at IS NULL
ORDER BY l.expires_at ASC;

-- Export for notification campaign
-- \copy (SELECT ...) TO '/tmp/expiring_licenses.csv' CSV HEADER;
```

### Step 5: After Migration Period, Retire v1

Once all old licenses have expired or been renewed, remove v1 key support from the codebase.

**Timeline Decision:**
```bash
# Check how many active licenses still use v1 signature
# This requires tracking key version used during signing (future enhancement)
# For now, wait until all pre-rotation licenses have expired

# Query database for oldest non-expired license
docker exec -it notely-postgres-v3 psql -U notely_v3_user -d notely_v3 -c \
  "SELECT MIN(expires_at) AS oldest_expiry
   FROM license.licenses
   WHERE revoked_at IS NULL
     AND expires_at > CURRENT_TIMESTAMP;"

# If oldest_expiry is in the past or NULL, all old licenses have expired
```

**Remove v1 Key Support:**

```bash
# Archive v1 keys permanently
mv config/keys/private.pem config/keys/archive/$(date +%Y-%m-%d)/private-v1-retired.pem
mv config/keys/public.pem config/keys/archive/$(date +%Y-%m-%d)/public-v1-retired.pem

# Promote v2 to current
mv config/keys/private-v2.pem config/keys/private.pem
mv config/keys/public-v2.pem config/keys/public.pem
```

**Revert Code to Single-Key:**

```typescript
// src/services/keyManager.ts - Simplified after v1 retirement
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

let cachedPrivateKey: string | null = null;
let cachedPublicKey: string | null = null;

export function initialize(): void {
  cachedPrivateKey = loadPrivateKey(PRIVATE_KEY_PATH);
  cachedPublicKey = loadPublicKey(PUBLIC_KEY_PATH);

  const isValid = verifyKeyPair(cachedPrivateKey, cachedPublicKey);
  if (!isValid) {
    throw new Error('Key pair verification failed');
  }

  console.log('Key Manager initialized successfully');
}

export function getPrivateKey(): string {
  if (!cachedPrivateKey) {
    throw new Error('Private key not initialized');
  }
  return cachedPrivateKey;
}

export function getPublicKey(): string {
  if (!cachedPublicKey) {
    throw new Error('Public key not initialized');
  }
  return cachedPublicKey;
}
```

**Deploy Simplified Code:**
```bash
# Rebuild and restart
docker compose build --no-cache license
docker compose up -d --force-recreate --no-deps license

# Verify
curl http://localhost:3210/ready
```

### Step 6: Update Public Key in Portal/Desktop Builds

Distribute the new public key (v2, now promoted to current) to all clients.

**Portal Docker Image Update:**

```bash
# Update portal Dockerfile to include new public key
cd ./server/services/portal

# Add public key to Docker image
# In Dockerfile:
# COPY ./config/license-public-key.pem /app/config/license-public-key.pem

# Copy latest public key
cp ../license/config/keys/public.pem ./config/license-public-key.pem

# Rebuild portal
docker compose build --no-cache portal
docker compose up -d --force-recreate --no-deps portal
```

**Desktop Client Update:**

```bash
# Navigate to desktop client repository
cd ./

# Update public key in client resources
cp ../notely-platform/server/services/license/config/keys/public.pem \
   src/resources/license-public-key.pem

# Update version number to trigger auto-update
# Edit package.json: "version": "1.2.0" -> "1.3.0"

# Build and sign new release
npm run build
npm run sign

# Publish to update server
# Desktop clients will auto-update and receive new public key
```

**API Endpoint Verification:**

The `GET /api/license/public-key` endpoint automatically serves the latest public key. Clients that fetch the key dynamically will automatically receive v2 after Step 5.

```bash
# Verify endpoint returns v2 public key
curl http://localhost:3210/api/license/public-key

# Output should match:
cat ./server/services/license/config/keys/public.pem
```

**Notification to Customers:**

Send notification to portal admins and desktop users:

> Subject: License Key System Update - Action Required
>
> We've upgraded our licensing system with enhanced security. To continue using Notely without interruption:
>
> **Portal Users:**
> - Pull the latest portal Docker image: `docker compose pull portal`
> - Restart your portal: `docker compose up -d portal`
>
> **Desktop Users:**
> - Update to version 1.3.0 or later (auto-update will download)
> - Or manually download from: https://yourdomain.com/downloads
>
> **Timeline:**
> - Old license keys remain valid until their expiration date
> - New license keys require the updated software
>
> If you experience any issues, contact support@example.com.

## Timeline

### Scheduled Annual Rotation

**Recommended Schedule:**
- Q4 (October-December): Plan rotation, generate new keys, test in staging
- Q1 (January-March): Deploy dual-key support, begin migration
- Q2 (April-June): Monitor adoption, send renewal notices
- Q3 (July-September): Retire old keys, complete migration

**Milestones:**
- **T-90 days:** Generate v2 keys, update staging environment
- **T-60 days:** Deploy dual-key support to production
- **T-30 days:** Send migration reminders to customers
- **T-day:** Begin issuing licenses with v2 only
- **T+180 days:** Retire v1 key support (all old licenses expired)

### Emergency Rotation Procedure

If a private key compromise is suspected, rotate immediately:

**Immediate Actions (Hour 0-4):**
1. Generate new key pair (v2) - 15 minutes
2. Deploy dual-key support - 30 minutes
3. Revoke all active licenses signed with v1 - 1 hour
4. Issue new licenses to affected customers - 2 hours
5. Notify security team and customers - ongoing

**Short-term Actions (Day 1-7):**
1. Investigate compromise source
2. Audit all license issuances during compromise window
3. Update all client deployments with new public key
4. Monitor for fraudulent license usage

**Recovery Actions (Day 7-30):**
1. Complete customer migration to v2
2. Retire v1 key immediately (no grace period)
3. Implement additional security controls
4. Post-mortem analysis and documentation

**Communication Template:**

> Subject: URGENT - Security Update Required
>
> We've detected a potential security issue with our license system and have implemented immediate protective measures.
>
> **Action Required:**
> - Your current license has been revoked as a precaution
> - A new license key has been generated: [NEW_KEY]
> - Update your software immediately to version [VERSION]
>
> **Timeline:**
> - Old license keys will stop working in 24 hours
> - Support team is available 24/7 for assistance
>
> We apologize for the disruption and appreciate your prompt attention to this matter.

## Verification Steps

After completing the rotation process, verify everything works correctly:

### 1. Key Pair Integrity

```bash
# Verify private key format
openssl rsa -in config/keys/private.pem -check -noout
# Should output: RSA key ok

# Verify public key format
openssl rsa -pubin -in config/keys/public.pem -text -noout | head -5
# Should display key details

# Verify key pair match
PRIVATE_MODULUS=$(openssl rsa -in config/keys/private.pem -noout -modulus | openssl sha256)
PUBLIC_MODULUS=$(openssl rsa -pubin -in config/keys/public.pem -noout -modulus | openssl sha256)
if [ "$PRIVATE_MODULUS" = "$PUBLIC_MODULUS" ]; then
  echo "✓ Key pair matches"
else
  echo "✗ Key pair mismatch"
fi
```

### 2. Service Health

```bash
# Check service is running
docker compose ps license

# Check readiness probe
curl http://localhost:3210/ready | jq
# Should return: {"status":"ready","checks":{...}}

# Check logs for key loading
docker compose logs license | grep -i "key"
# Should see: "Key Manager initialized successfully"
```

### 3. License Generation

```bash
# Generate test license
curl -X POST http://localhost:3210/api/license/admin/generate \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "trial",
    "organizationId": "00000000-0000-0000-0000-000000000001",
    "userId": "00000000-0000-0000-0000-000000000002",
    "features": {"test": true},
    "limits": {"maxUsers": 1},
    "expiresAt": "2025-12-31T23:59:59Z"
  }' | jq

# Should return license key starting with NOTELY-TRIAL-
```

### 4. License Validation

```bash
# Validate the test license
TEST_LICENSE="NOTELY-TRIAL-..." # From previous step

curl -X POST http://localhost:3210/api/license/validate \
  -H "Content-Type: application/json" \
  -d "{\"licenseKey\": \"$TEST_LICENSE\"}" | jq

# Should return: {"valid": true, "features": {...}, "limits": {...}}
```

### 5. Old License Validation (During Migration)

```bash
# If in dual-key mode, test v1 license still validates
OLD_LICENSE="NOTELY-..." # A license issued before rotation

curl -X POST http://localhost:3210/api/license/validate \
  -H "Content-Type: application/json" \
  -d "{\"licenseKey\": \"$OLD_LICENSE\"}" | jq

# Should return: {"valid": true, ...} if license not expired/revoked
```

### 6. Public Key Distribution

```bash
# Check public key endpoint
curl http://localhost:3210/api/license/public-key

# Should return PEM-formatted public key:
# -----BEGIN PUBLIC KEY-----
# ...
# -----END PUBLIC KEY-----

# Verify it matches the file
diff <(curl -s http://localhost:3210/api/license/public-key) \
     config/keys/public.pem
# Should return no differences
```

### 7. Client Integration Testing

**Desktop Client:**
```bash
# Start desktop client with new license
./notely-desktop --license="$NEW_LICENSE"

# Check client logs for validation success
# Should see: "License validation successful"
# Should see: "Features enabled: [...]"
```

**Portal Deployment:**
```bash
# Enter license in portal UI
# Navigate to Settings > License
# Paste license key
# Click Validate

# Should see: "License validated successfully"
# Should see feature list with enabled/disabled status
```

### 8. Database Verification

```bash
# Check license records
docker exec -it notely-postgres-v3 psql -U notely_v3_user -d notely_v3 -c \
  "SELECT subject, type, issued_at, expires_at, revoked_at
   FROM license.licenses
   ORDER BY issued_at DESC
   LIMIT 5;"

# Check validation attempts
docker exec -it notely-postgres-v3 psql -U notely_v3_user -d notely_v3 -c \
  "SELECT license_subject, result, validated_at
   FROM license.license_validations
   ORDER BY validated_at DESC
   LIMIT 5;"
```

## Distribution Checklist

Before completing key rotation, ensure new public key is distributed to all clients:

### Portal Docker Image
- [ ] Copy `public.pem` to portal service resources
- [ ] Update portal Dockerfile to include public key
- [ ] Rebuild portal Docker image
- [ ] Push image to registry
- [ ] Update deployment instructions in portal README
- [ ] Test portal license validation with new key
- [ ] Notify customers to pull latest portal image

### Desktop Client Builds
- [ ] Copy `public.pem` to desktop client resources
- [ ] Update public key file path in code if necessary
- [ ] Increment desktop client version number
- [ ] Build and sign new desktop release
- [ ] Upload release to distribution server
- [ ] Update auto-update manifest
- [ ] Test auto-update downloads new version
- [ ] Test offline validation with new public key
- [ ] Create release notes mentioning key rotation
- [ ] Send update notification to desktop users

### API Endpoint
- [ ] Verify `GET /api/license/public-key` endpoint active
- [ ] Test endpoint returns correct PEM format
- [ ] Verify rate limiting is working (100 req/min)
- [ ] Document endpoint in API documentation
- [ ] Add endpoint to client SDK examples
- [ ] Test clients can download key programmatically

### Documentation Updates
- [ ] Update ARCHITECTURE.md with rotation details
- [ ] Update README.md with current key version
- [ ] Update deployment docs with key locations
- [ ] Document key rotation schedule
- [ ] Create runbook for emergency rotation
- [ ] Update security policy with key requirements
- [ ] Add key rotation to operational calendar

### Communication
- [ ] Draft customer notification email
- [ ] Prepare support team with FAQs
- [ ] Update knowledge base articles
- [ ] Post announcement in customer portal
- [ ] Schedule webinar for major customers (optional)
- [ ] Update license agreement if needed
- [ ] Notify integrations/partners

### Monitoring
- [ ] Set up alerts for validation failures
- [ ] Monitor license validation success rate
- [ ] Track client version adoption
- [ ] Monitor rate of old license usage
- [ ] Set calendar reminder for next rotation
- [ ] Document lessons learned
- [ ] Update rotation procedures based on feedback

## Rollback Procedure

If rotation causes issues, rollback to v1 temporarily:

```bash
# Restore v1 keys as current
cp config/keys/archive/$(ls -t config/keys/archive | head -1)/private-v1.pem config/keys/private.pem
cp config/keys/archive/$(ls -t config/keys/archive | head -1)/public-v1.pem config/keys/public.pem

# Restart service
docker compose restart license

# Verify service using v1
curl http://localhost:3210/ready

# Investigate root cause
docker compose logs license | grep -i error

# Once resolved, re-attempt rotation from Step 2
```

## Best Practices

1. **Never Commit Private Keys:** Always add `config/keys/private*.pem` to `.gitignore`
2. **Secure Key Storage:** Use file permissions 600 for private keys, store in encrypted volume
3. **Test in Staging First:** Complete entire rotation process in staging environment before production
4. **Monitor Validation Rates:** Track validation success/failure rates during migration
5. **Maintain Archives:** Keep archived keys for at least 2 years for audit purposes
6. **Document Everything:** Record rotation dates, reasons, and outcomes in operational log
7. **Automate Where Possible:** Script key generation and verification steps
8. **Communicate Early:** Give customers 60+ days notice for scheduled rotations
9. **Have Rollback Plan:** Test rollback procedure before rotation
10. **Regular Audits:** Quarterly review of key permissions, access logs, and rotation schedule

## Security Considerations

- **Private Key Protection:** Private key compromise allows unlimited fraudulent license generation
- **Public Key Integrity:** Clients must verify public key source to prevent man-in-the-middle attacks
- **Rotation Timing:** Balance security (frequent rotation) vs. operational overhead (customer migration)
- **Emergency vs. Scheduled:** Have separate procedures for each scenario
- **Audit Trail:** Log all key operations for security forensics
- **Access Control:** Limit who can access private keys and perform rotations
- **Backup Strategy:** Encrypted backups of archived keys for disaster recovery
- **Compliance:** Meet regulatory requirements for key management (e.g., SOC 2, ISO 27001)

## Support Contacts

For questions or issues during key rotation:
- **Security Team:** security@example.com
- **Platform Team:** platform@example.com
- **Customer Support:** support@example.com (for customer-facing issues)
- **On-Call:** Refer to PagerDuty rotation for urgent issues
