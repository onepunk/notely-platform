# ADR-005: Stateless Validation with Cached Public Key

## Status
Accepted

## Context
License validation must work reliably across multiple scenarios:
- **Offline Operation**: Portal and desktop may be disconnected from network for extended periods
- **High Performance**: Validation happens frequently (startup, feature checks, periodic revalidation)
- **Low Latency**: Users expect instant application launch, not waiting for server responses
- **Server Independence**: Clients shouldn't fail if license service is temporarily unavailable
- **Security**: Validation must be cryptographically secure and tamper-proof

Traditional approaches have limitations:
- **Online-only validation**: Fails when network unavailable, adds latency, creates server dependency
- **Shared secret validation**: Requires distributing private key to clients (security risk)
- **Certificate chains**: Complex PKI infrastructure, revocation challenges

## Decision
Implement **stateless validation with cached public key** using RSA asymmetric cryptography:

**Public Key Distribution:**
```typescript
// Public key embedded in application (portal and desktop)
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA...
-----END PUBLIC KEY-----`;

// Alternative: Download from license service on first run
const PUBLIC_KEY_URL = 'https://license.yourdomain.com/api/v1/public-key';
```

**Validation Flow:**
```typescript
import jwt from 'jsonwebtoken';

function validateLicense(licenseJWT: string): ValidationResult {
  try {
    // 1. Verify signature using cached public key (offline)
    const payload = jwt.verify(licenseJWT, PUBLIC_KEY, {
      algorithms: ['RS512']
    });

    // 2. Check expiration (offline)
    if (Date.now() / 1000 > payload.exp) {
      return { valid: false, reason: 'expired' };
    }

    // 3. Check hardware binding if portal license (offline)
    if (payload.type === 'portal' && payload.hwid) {
      const currentHwid = getPrimaryMAC();
      if (payload.hwid !== currentHwid) {
        return { valid: false, reason: 'hwid_mismatch' };
      }
    }

    // 4. Return validated features
    return {
      valid: true,
      organizationId: payload.orgId,
      features: payload.features,
      expiresAt: payload.exp
    };

  } catch (error) {
    return { valid: false, reason: 'invalid_signature' };
  }
}
```

**No Server Required for Basic Validation:**
- Signature verification: Uses cached public key (offline)
- Expiration check: Uses JWT `exp` claim (offline)
- Hardware binding: Uses local MAC address (offline)
- Feature extraction: Reads JWT payload (offline)

**Server Used Only For:**
- Revocation checks (can be cached for 7 days per ADR-002)
- License issuance
- Public key rotation
- Audit logging

## Alternatives Considered

### 1. Online Validation (Server Call Required)
**Pros:**
- Instant revocation enforcement
- Always up-to-date status
- Centralized control

**Cons:**
- Cannot work offline
- Network latency on every validation
- Server becomes single point of failure
- Poor user experience during network issues
- High server load

### 2. Certificate-Based Validation (PKI)
**Pros:**
- Industry-standard trust model
- Built-in revocation (CRL/OCSP)
- Hierarchical trust chains

**Cons:**
- Complex PKI infrastructure required
- Certificate lifecycle management
- CRL/OCSP still requires network
- Overkill for license validation use case
- Higher implementation complexity

### 3. HMAC with Shared Secret
**Pros:**
- Simple implementation
- Fast validation
- Smaller signatures

**Cons:**
- Symmetric key must be distributed to clients
- Key exposure risk (clients have signing capability)
- Key rotation requires updating all clients
- Cannot support offline validation without exposing signing key

### 4. Time-Limited Tokens with Server Refresh
**Pros:**
- Automatic expiration
- Server controls token lifetime
- Simple revocation (don't issue new tokens)

**Cons:**
- Requires periodic server contact
- Cannot work fully offline
- Token refresh logic adds complexity
- Poor offline experience

## Rationale

**Stateless validation with cached public key chosen because:**

1. **Offline Operation**: Public key allows signature verification without server connection. All validation logic runs locally.

2. **Performance**: No network round-trip required. Validation completes in milliseconds using local cryptographic operations.

3. **Security**: RSA-4096 provides strong asymmetric encryption. Public key can be safely embedded in clients without compromising private signing key.

4. **Stateless**: No session management, no server-side state. Each license is self-contained and independently verifiable.

5. **Server Independence**: License service downtime doesn't affect client validation (except for revocation checks, which have 7-day cache).

6. **Simple Distribution**: Public key can be:
   - Embedded in application code
   - Downloaded once on first run
   - Updated via application updates

7. **Key Rotation**: Public key rotation is straightforward:
   - Issue new licenses with new key
   - Support multiple public keys during transition period
   - Old licenses continue working until expiration

8. **Industry Standard**: Uses well-established JWT + RSA pattern with extensive library support

## Consequences

### Positive
- **Zero Network Dependency**: Validation works completely offline
- **High Performance**: Local cryptographic verification is fast (microseconds)
- **Scalability**: No server load from validation requests
- **Reliability**: No single point of failure for validation
- **Security**: Public key distribution is safe (cannot forge licenses)
- **Simplicity**: Standard JWT libraries handle all complexity

### Negative
- **Public Key Distribution**: Must ensure clients have correct public key
- **Key Rotation Complexity**: Changing signing key requires transitional support for old key
- **No Instant Revocation**: Revoked licenses work until cache expires (mitigated by ADR-002)
- **Public Key Size**: RSA-4096 public keys are ~550 bytes (acceptable for embedding)

### Mitigation Strategies

**Public Key Distribution:**
```typescript
// Embedded fallback (bundled with application)
const EMBEDDED_PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || `-----BEGIN...`;

// Online fetch with fallback (first run only)
async function getPublicKey(): Promise<string> {
  try {
    const response = await fetch('https://license.yourdomain.com/api/v1/public-key', {
      timeout: 5000
    });
    const key = await response.text();
    // Cache for future use
    await cache.set('license_public_key', key);
    return key;
  } catch (error) {
    // Fall back to embedded key
    return EMBEDDED_PUBLIC_KEY;
  }
}
```

**Key Rotation Strategy:**
```typescript
// Support multiple public keys during transition
const PUBLIC_KEYS = {
  'v1': process.env.LICENSE_PUBLIC_KEY_V1,
  'v2': process.env.LICENSE_PUBLIC_KEY_V2,  // New key
};

function validateWithKeyRotation(licenseJWT: string): ValidationResult {
  // Extract key version from JWT header
  const header = jwt.decode(licenseJWT, { complete: true })?.header;
  const keyVersion = header?.kid || 'v1';  // kid = Key ID

  const publicKey = PUBLIC_KEYS[keyVersion];
  if (!publicKey) {
    return { valid: false, reason: 'unknown_key_version' };
  }

  return jwt.verify(licenseJWT, publicKey, { algorithms: ['RS512'] });
}
```

**Key Rotation Process:**
```
1. Generate new RSA-4096 key pair
2. Add new public key (v2) to clients via application update
3. License service signs new licenses with new private key (v2), sets kid=v2
4. Grace period: Both v1 and v2 keys accepted (e.g., 90 days)
5. Stop issuing v1 licenses, only issue v2
6. After all v1 licenses expired, remove v1 public key from clients
```

**Public Key Integrity:**
```typescript
// Verify public key hasn't been tampered with
const PUBLIC_KEY_HASH = 'sha256:a1b2c3d4e5f6...';

function verifyPublicKey(key: string): boolean {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return `sha256:${hash}` === PUBLIC_KEY_HASH;
}
```

**Graceful Degradation:**
```typescript
// If public key unavailable, fall back to server validation
async function validateLicense(license: string): Promise<ValidationResult> {
  try {
    // Try offline validation first
    return validateOffline(license);
  } catch (error) {
    // Fall back to online validation
    console.warn('Offline validation failed, trying server', error);
    return await validateOnline(license);
  }
}
```

### Implementation Requirements

**License Service:**
- Generate RSA-4096 key pair on initialization
- Store private key securely (environment variable, KMS)
- Expose public key via API endpoint: `GET /api/v1/public-key`
- Sign licenses with `kid` (Key ID) header for version tracking
- Support multiple private keys during rotation

**Portal Application:**
- Embed public key at build time (environment variable)
- Cache downloaded public key in database
- Implement fallback chain: cached → embedded → download
- Verify public key integrity using hash

**Desktop Application:**
- Embed public key at build time (environment variable)
- Cache downloaded public key in local storage
- Auto-update public key on application updates
- Handle key rotation gracefully

**Monitoring:**
```typescript
// Track validation metrics
metrics.increment('license_validation', {
  result: 'success' | 'failure',
  reason: 'expired' | 'invalid_signature' | 'hwid_mismatch',
  keyVersion: 'v1' | 'v2',
  offline: true | false
});

// Alert on unusual patterns
if (failureRate > 0.05) {
  alert('High license validation failure rate');
}
```

**Testing:**
```typescript
describe('Stateless Validation', () => {
  it('validates license offline with cached public key', () => {
    const result = validateLicense(validLicense);
    expect(result.valid).toBe(true);
    expect(networkCalls).toBe(0);  // No network required
  });

  it('handles key rotation gracefully', () => {
    const oldLicense = signWithKey(payload, PRIVATE_KEY_V1, 'v1');
    const newLicense = signWithKey(payload, PRIVATE_KEY_V2, 'v2');

    expect(validateLicense(oldLicense).valid).toBe(true);
    expect(validateLicense(newLicense).valid).toBe(true);
  });

  it('rejects license signed with unknown key', () => {
    const fakeLicense = signWithKey(payload, FAKE_PRIVATE_KEY, 'v999');
    expect(validateLicense(fakeLicense).valid).toBe(false);
  });
});
```

## Related
- [ADR-001: RSA-4096 + JWT for License Format](./ADR-001-rsa-4096-jwt-license-format.md)
- [ADR-002: Offline Validation Strategy (7-Day Cache)](./ADR-002-offline-validation-strategy.md)
- Implementation: `/services/license/src/core/validator.ts`
- Key Management: `/services/license/src/core/key-manager.ts`
- Public Key API: `/services/license/src/routes/public-key.ts`
