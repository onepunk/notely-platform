# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the Notely License Service. ADRs document significant architectural decisions, their context, alternatives considered, and consequences.

## Index

### [ADR-001: RSA-4096 + JWT for License Format](./ADR-001-rsa-4096-jwt-license-format.md)
**Decision**: Use RSA-4096 asymmetric encryption with JWT as the license format.

**Key Points**:
- Cryptographically secure, tamper-proof licenses
- Copy/paste friendly (Base64URL encoded)
- Self-contained with all license information
- Offline signature validation
- Industry-standard format

**Status**: Accepted

---

### [ADR-002: Offline Validation Strategy (7-Day Cache)](./ADR-002-offline-validation-strategy.md)
**Decision**: Implement 7-day offline validation cache for portal and desktop clients.

**Key Points**:
- Works offline for up to 7 days
- Balances user convenience with security
- Revoked licenses stop working within one week
- Cached validation results with server revalidation
- Clock manipulation protection

**Status**: Accepted

---

### [ADR-003: Hardware Binding for Portal Licenses Only](./ADR-003-hardware-binding-portal-only.md)
**Decision**: Portal licenses require hardware binding (MAC address), desktop licenses do not.

**Key Points**:
- Portal licenses tied to specific server hardware
- Desktop licenses support multi-device usage
- Matches deployment model expectations
- Prevents portal license sharing across servers
- Flexible desktop user experience

**Status**: Accepted

---

### [ADR-004: Multi-Tenant Handling via organization_id](./ADR-004-multi-tenant-organization-id.md)
**Decision**: Use `organization_id` as multi-tenancy boundary with deployment mode controlling authorization scope.

**Key Points**:
- Master portal manages all organizations
- Customer portals single-organization only
- Single codebase for both deployment modes
- Organization-level authorization enforcement
- Scalable from single customer to hundreds of orgs

**Status**: Accepted

---

### [ADR-005: Stateless Validation with Cached Public Key](./ADR-005-stateless-validation-cached-public-key.md)
**Decision**: Clients cache public key and perform stateless validation without server dependency.

**Key Points**:
- Zero network dependency for validation
- Public key safely embedded in applications
- High performance (microseconds)
- Supports key rotation with versioning
- No server state required

**Status**: Accepted

---

## ADR Relationships

```
ADR-001 (License Format)
    ├─> ADR-002 (Offline Validation)
    │       └─> ADR-005 (Stateless Validation)
    ├─> ADR-003 (Hardware Binding)
    └─> ADR-004 (Multi-Tenancy)
```

**Core Architecture**:
- **ADR-001** establishes the license format (RSA-4096 + JWT)
- **ADR-005** defines how licenses are validated (cached public key)
- **ADR-002** specifies offline operation strategy (7-day cache)

**Deployment Models**:
- **ADR-003** differentiates portal vs desktop license binding
- **ADR-004** handles multi-tenant scenarios (master vs customer portal)

## Reading Order

For new team members:
1. Start with **ADR-001** (License Format) to understand the foundation
2. Read **ADR-005** (Stateless Validation) to see how validation works
3. Review **ADR-002** (Offline Strategy) for cache behavior
4. Study **ADR-003** (Hardware Binding) for portal vs desktop differences
5. Finish with **ADR-004** (Multi-Tenancy) for deployment model understanding

## Contributing

When adding new ADRs:
1. Use the next sequential number (ADR-006, ADR-007, etc.)
2. Follow the template format (Status, Context, Decision, Alternatives, Rationale, Consequences, Related)
3. Update this README index
4. Cross-reference related ADRs
5. Use descriptive filenames: `ADR-XXX-short-title.md`

## Template

```markdown
# ADR-XXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-YYY]

## Context
[Background and problem statement]

## Decision
[What we decided to do]

## Alternatives Considered
[Other options we evaluated]

## Rationale
[Why we chose this approach]

## Consequences
[Trade-offs and implications]

## Related
[Links to other ADRs or documentation]
```
