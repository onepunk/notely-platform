# ADR-002: Offline Validation Strategy (7-Day Cache)

## Status
Accepted

## Context
Notely customers need their portal and desktop applications to continue functioning even without constant internet connectivity. However, license enforcement must remain effective:
- **Portal deployments** may be in air-gapped environments or have unreliable network connections
- **Desktop clients** may be used on planes, in remote locations, or behind restrictive firewalls
- **Revoked licenses** should stop working within a reasonable timeframe for security
- **User experience** should not be disrupted by transient network issues

The challenge is balancing offline capability with timely license enforcement (revocations, expirations, feature changes).

## Decision
Implement a **7-day offline validation cache** for both portal and desktop clients:

**Cache Behavior:**
```typescript
interface LicenseCacheEntry {
  license: string;              // JWT license string
  lastValidation: number;       // Unix timestamp of last server check
  validationResult: {
    valid: boolean;
    features: FeatureFlags;
    expiresAt: number;
  };
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
```

**Validation Flow:**
1. **First Check**: Cryptographic signature validation (offline, instant)
2. **Cache Check**: If cached validation exists and is < 7 days old, use cached result
3. **Server Check**: If cache expired or missing, attempt server validation:
   - Success: Update cache, return result
   - Failure (network): Use cached result if available
   - Failure (revoked): Mark invalid, clear cache
4. **Fallback**: If no cache and no network, reject (fail closed)

**Server Validation Endpoint:**
```
POST /api/v1/licenses/validate
{
  "license": "eyJ...",
  "hwid": "en0-00:11:22:33:11:22"  // Portal only
}

Response:
{
  "valid": true,
  "revoked": false,
  "features": {...},
  "expiresAt": 1762989600
}
```

## Alternatives Considered

### 1. Always-Online Validation (No Cache)
**Pros:**
- Instant revocation enforcement
- Always up-to-date feature flags
- Simpler implementation

**Cons:**
- Cannot work offline
- Poor user experience during network issues
- Server dependency for basic operation
- Increased server load

### 2. Permanent Offline (No Server Check)
**Pros:**
- Works completely offline
- Zero server load
- Maximum user convenience

**Cons:**
- No revocation capability
- Cannot update features without new license
- Security risk (stolen licenses never expire)

### 3. 24-Hour Cache
**Pros:**
- Faster revocation enforcement
- More up-to-date status

**Cons:**
- Requires daily network connectivity
- Poor experience in air-gapped environments
- Minimal security benefit over 7-day cache

### 4. 30-Day Cache
**Pros:**
- Better offline experience
- Less server load

**Cons:**
- Revoked licenses work for up to a month
- Too long for security-sensitive scenarios

## Rationale

**7-day cache chosen because:**

1. **Balance**: Provides reasonable offline capability while ensuring revoked licenses stop working within one week

2. **Realistic Network Patterns**: Most customers will have network access at least weekly, even in air-gapped environments (maintenance windows, updates)

3. **Security Window**: 7 days is acceptable for most security scenarios:
   - Stolen licenses become useless quickly
   - Deactivated organizations cannot operate indefinitely
   - Non-payment enforcement happens within reasonable timeframe

4. **User Experience**: Users can work offline for a full business week without disruption

5. **Industry Standard**: Similar to certificate revocation checking (OCSP) and software activation patterns

6. **Testing Window**: Provides enough time for pilot deployments and testing before requiring revalidation

## Consequences

### Positive
- **Offline Operation**: Portal and desktop work for up to 7 days without network
- **Network Resilience**: Transient network failures don't disrupt operations
- **Reduced Server Load**: Validation requests only every 7 days per client
- **Better UX**: No interruptions during short network outages
- **Air-Gap Friendly**: Works in secure, isolated environments for reasonable periods

### Negative
- **Delayed Revocation**: Revoked licenses continue working for up to 7 days
- **Feature Lag**: Feature flag updates take up to 7 days to propagate
- **Storage Required**: Clients must persist cache to disk
- **Clock Dependency**: Relies on client system time (can be manipulated)

### Mitigation Strategies

**Clock Manipulation Protection:**
```typescript
// Detect time travel attacks
if (currentTime < lastValidationTime) {
  // Clock moved backward - force revalidation
  clearCache();
  requireServerValidation();
}
```

**Instant Revocation for Critical Cases:**
```typescript
// Admin portal can mark licenses for immediate kill
// Requires network check, bypasses cache
if (license.metadata.forceValidation) {
  return validateWithServer(license);
}
```

**Cache Persistence:**
```typescript
// Portal: Store in PostgreSQL
// Desktop: Store in encrypted local file
// Include integrity hash to detect tampering
```

**Grace Period Handling:**
```typescript
// Warn users 24 hours before cache expires
if (cacheAge > 6 * 24 * 60 * 60 * 1000) {
  showWarning("License validation required soon. Please connect to network.");
}
```

### Implementation Requirements

**Portal (Node.js):**
- Store cache in `license_validations` table
- Background job attempts revalidation every 24 hours
- UI warning when cache > 6 days old

**Desktop (Electron):**
- Store cache in encrypted local storage
- Background task checks cache age on startup
- System tray notification when cache > 6 days old

**License Service:**
- Track validation attempts in audit log
- Monitor cache hit rates and expiration patterns
- Alert on unusual validation patterns (possible abuse)

## Related
- [ADR-001: RSA-4096 + JWT for License Format](./ADR-001-rsa-4096-jwt-license-format.md)
- [ADR-005: Stateless Validation with Cached Public Key](./ADR-005-stateless-validation-cached-public-key.md)
- Implementation: `/services/license/src/core/validator.ts`
- Cache Management: `/services/portal/src/license/cache-manager.ts`
- Desktop Client: `/notely-ai/src/license/cache.ts`
