# ADR-003: Hardware Binding for Portal Licenses Only

## Status
Accepted

## Context
Notely licenses need to enforce appropriate usage restrictions based on deployment model:

**Portal Licenses** (Server/On-Premise):
- Deployed to specific servers/VMs
- One portal instance per organization
- Hardware bound to prevent license sharing
- Example: Customer deploys portal to their own infrastructure

**Desktop Licenses** (Client Application):
- Installed on user workstations
- Users often have multiple devices (work laptop, home laptop, tablet)
- Expect cross-device flexibility
- Example: User accesses Notely from office desktop, home laptop, and travel device

Current problem: A single hardware binding approach doesn't fit both use cases. Portal licenses should be tied to specific hardware, but desktop licenses should support multi-device usage.

## Decision
Implement **hardware binding (HWID) for portal licenses only**. Desktop licenses omit the `hwid` claim and allow usage across any device by the licensed user/organization.

**Portal License (with HWID):**
```json
{
  "orgId": "org_123",
  "type": "portal",
  "features": {
    "portal": true,
    "meetings": true,
    "storage": 1000
  },
  "hwid": "en0-00:11:22:33:11:22",  // MAC address of primary NIC
  "iat": 1731453600,
  "exp": 1762989600
}
```

**Desktop License (no HWID):**
```json
{
  "orgId": "org_123",
  "type": "desktop",
  "features": {
    "desktop": true,
    "meetings": true,
    "storage": 100
  },
  // No hwid claim - usable on any device
  "iat": 1731453600,
  "exp": 1762989600
}
```

**Validation Rules:**
- **Portal**: HWID must match current server's MAC address (primary network interface)
- **Desktop**: HWID not checked, validated by organization ID only
- **Type Enforcement**: License type claim prevents portal license use on desktop and vice versa

## Alternatives Considered

### 1. Hardware Binding for Both Portal and Desktop
**Pros:**
- Prevents license sharing completely
- Maximum license protection
- Simple uniform policy

**Cons:**
- Poor desktop user experience (can't use multiple devices)
- Users need multiple licenses for laptop + desktop + travel device
- Doesn't match industry norms (most software allows multi-device)
- Customer pushback likely

### 2. No Hardware Binding for Either
**Pros:**
- Maximum user convenience
- Simple implementation
- No hardware detection needed

**Cons:**
- Portal licenses could be shared across multiple servers
- No enforcement against copying portal to multiple environments
- Lost revenue from server proliferation
- Security risk (leaked portal licenses usable anywhere)

### 3. Device Count Limit (e.g., 3 devices per license)
**Pros:**
- Flexible multi-device support
- Still provides some enforcement
- Common pattern in consumer software

**Cons:**
- Requires server-side device registration
- Cannot work offline
- Complex implementation (device fingerprinting, rotation)
- Poor user experience (device limit reached errors)

### 4. User-Based Binding (username/email)
**Pros:**
- Natural for desktop licenses
- Works across devices
- Familiar pattern

**Cons:**
- Doesn't work for portal (servers don't have users)
- Requires online validation
- Username changes break licenses
- Privacy concerns (PII in license)

## Rationale

**Portal-only hardware binding chosen because:**

1. **Deployment Model Match**:
   - **Portals** are server-bound: One instance per organization, deployed to specific infrastructure
   - **Desktops** are user-bound: Users expect to work from multiple devices

2. **Customer Expectations**:
   - **Portal**: Customers expect server licenses to be tied to specific hardware (matches industry norms for server software)
   - **Desktop**: Customers expect flexibility to install on work laptop, home laptop, etc. (matches industry norms for client software)

3. **Technical Feasibility**:
   - **Portal**: Server MAC address is stable and deterministic
   - **Desktop**: Device fingerprinting is complex, unreliable (VMs, MAC spoofing, network changes)

4. **Revenue Protection**:
   - **Portal**: Hardware binding prevents one license from being used across multiple server deployments
   - **Desktop**: Organization-level licensing already provides revenue protection (users within org share license pool)

5. **Offline Operation**:
   - **Portal**: HWID validation works offline (check local MAC)
   - **Desktop**: No device registration server needed

6. **User Experience**:
   - **Portal**: IT teams provision servers, hardware binding is expected and acceptable
   - **Desktop**: End users want seamless multi-device access

## Consequences

### Positive
- **Portal Protection**: Cannot copy portal license to multiple servers
- **Desktop Flexibility**: Users work seamlessly across devices
- **Offline Validation**: Both models validate without server connection
- **Simple Implementation**: No device registration/tracking infrastructure needed
- **Industry Alignment**: Matches customer expectations for server vs client software

### Negative
- **Desktop Sharing Risk**: Desktop license could theoretically be shared across organizations (mitigated by organization ID binding)
- **Portal Migration**: Moving portal to new hardware requires new license or hwid update
- **Mixed Policies**: Two different validation paths to maintain and test

### Mitigation Strategies

**Desktop License Sharing Prevention:**
```typescript
// Organization ID binds license to specific customer
// Admin portal tracks which organizations have active desktop licenses
// Unusual usage patterns (100s of devices) trigger alerts
if (activeDeviceCount > expectedThreshold) {
  alertAdmins(`Organization ${orgId} has ${activeDeviceCount} active devices`);
}
```

**Portal Hardware Migration:**
```typescript
// Admin API endpoint to update hwid when server hardware changes
// Requires authentication and audit logging
POST /api/v1/admin/licenses/{licenseId}/update-hwid
{
  "oldHwid": "en0-00:11:22:33:11:22",
  "newHwid": "en0-aa:bb:cc:dd:ee:ff",
  "reason": "Server migration from AWS to Azure"
}
```

**HWID Detection (Portal):**
```typescript
import { networkInterfaces } from 'os';

function getPrimaryMAC(): string {
  const nets = networkInterfaces();
  // Find first non-internal, physical interface
  for (const name of Object.keys(nets)) {
    const net = nets[name]?.find(n => !n.internal && n.mac !== '00:00:00:00:00:00');
    if (net) return `${name}-${net.mac}`;
  }
  throw new Error('No valid network interface found');
}
```

**License Type Enforcement:**
```typescript
function validateLicenseType(license: License, environment: 'portal' | 'desktop') {
  if (license.type !== environment) {
    throw new Error(`License type ${license.type} cannot be used in ${environment}`);
  }
}
```

### Implementation Requirements

**License Service:**
- Include `type` and optional `hwid` claims in JWT payload
- Admin API validates hwid format (MAC address pattern)
- Support hwid updates for portal migration scenarios

**Portal Application:**
- Detect primary MAC address on startup
- Validate license hwid matches current server
- Log hwid mismatches for audit trail
- Provide clear error message if hwid mismatch occurs

**Desktop Application:**
- Ignore hwid claim if present (future-proofing)
- Validate organization ID binding
- No device fingerprinting required

**Admin Portal:**
- UI to generate portal licenses (requires hwid input)
- UI to generate desktop licenses (no hwid needed)
- License migration tool for portal hardware changes
- Usage analytics dashboard (device count per org for desktop licenses)

## Related
- [ADR-001: RSA-4096 + JWT for License Format](./ADR-001-rsa-4096-jwt-license-format.md)
- [ADR-004: Multi-Tenant Handling via organization_id](./ADR-004-multi-tenant-organization-id.md)
- Implementation: `/services/license/src/core/validator.ts`
- Portal Validation: `/services/portal/src/license/hwid-validator.ts`
- Desktop Client: `/notely-ai/src/license/validator.ts`
