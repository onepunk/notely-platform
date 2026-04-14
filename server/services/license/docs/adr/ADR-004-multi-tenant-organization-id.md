# ADR-004: Multi-Tenant Handling via organization_id

## Status
Accepted

## Context
Notely operates in two distinct deployment models:

**1. Master Portal (Notely-Operated SaaS)**
- Single Notely-hosted platform serving multiple customer organizations
- Notely IT manages licenses for all customers
- Needs visibility and control across all organizations
- Example: `portal.yourdomain.com` with customers org_123, org_456, org_789

**2. Customer Portal (On-Premise/Private Cloud)**
- Customer deploys their own portal instance
- Customer IT manages licenses only for their organization
- Isolated from other organizations
- Example: Customer XYZ runs `notely.xyz-corp.com` for their employees only

**Challenges:**
- Master portal admin needs to view/manage licenses across all orgs
- Customer portal admin should only see/manage their own org's licenses
- License validation must enforce organization boundaries
- Same license service code must support both deployment models
- Security: Prevent cross-organization license access

## Decision
Use `organization_id` as the primary multi-tenancy boundary, with **deployment mode** determining authorization scope:

**License Structure:**
```json
{
  "orgId": "org_123",           // Organization identifier (required)
  "type": "portal",             // License type
  "features": {...},
  "iat": 1731453600,
  "exp": 1762989600
}
```

**Authorization Model:**

**Master Portal Mode:**
```typescript
interface MasterPortalConfig {
  mode: 'master';
  // Admin can access ALL organizations
  allowedOrganizations: '*';
}

// Admin API: Can view/manage any org's licenses
GET /api/v1/admin/licenses?organizationId=org_123
GET /api/v1/admin/licenses?organizationId=org_456
```

**Customer Portal Mode:**
```typescript
interface CustomerPortalConfig {
  mode: 'customer';
  // Portal is bound to single organization
  organizationId: 'org_123';
  // Admin can ONLY access this org
  allowedOrganizations: ['org_123'];
}

// Admin API: Can only view/manage own org
GET /api/v1/admin/licenses  // Implicitly filtered to org_123
// Attempting to access org_456 returns 403 Forbidden
```

**Environment Configuration:**
```bash
# Master Portal (portal.yourdomain.com)
DEPLOYMENT_MODE=master
ALLOWED_ORGANIZATIONS=*

# Customer Portal (notely.xyz-corp.com)
DEPLOYMENT_MODE=customer
ORGANIZATION_ID=org_123
```

## Alternatives Considered

### 1. Separate Codebases (Master vs Customer)
**Pros:**
- Complete isolation
- Simpler per-deployment logic
- No risk of cross-contamination

**Cons:**
- Duplicate code maintenance
- Feature parity challenges
- Bug fixes must be applied twice
- Deployment complexity (two release streams)

### 2. Database-Per-Tenant
**Pros:**
- Physical data isolation
- Better performance isolation
- Simpler backup/restore per customer

**Cons:**
- Infrastructure complexity (100s of databases)
- Schema migration nightmare
- Cannot efficiently query across tenants (analytics)
- Doesn't solve customer portal isolation

### 3. Row-Level Security (RLS) in Database
**Pros:**
- Database-enforced isolation
- Difficult to bypass accidentally
- No application-level filtering needed

**Cons:**
- Database-specific implementation
- Complex for master portal (needs bypass mechanism)
- Migration complexity
- Performance overhead

### 4. Separate License Services (Master vs Customer)
**Pros:**
- Service-level isolation
- Independent scaling
- Clear separation of concerns

**Cons:**
- License data fragmentation
- Master portal loses visibility into customer deployments
- Duplicate service infrastructure
- API contract divergence risk

## Rationale

**organization_id with deployment mode chosen because:**

1. **Single Codebase**: Same license service code runs in both master and customer portals, reducing maintenance burden

2. **Flexible Authorization**: Deployment mode controls access scope without code changes:
   - Master portal: Admin sees all orgs
   - Customer portal: Admin sees only their org

3. **Security**: Organization ID enforced at multiple layers:
   - License JWT validation
   - API endpoint authorization
   - Database query filtering

4. **Scalability**: Supports growth from single customer to hundreds of organizations without architectural changes

5. **Operational Simplicity**: One database, one service, one deployment pipeline

6. **Analytics**: Master portal can analyze license usage across all customers

7. **Customer Isolation**: Customer portals are configured for single-org mode, preventing cross-org access

## Consequences

### Positive
- **Code Reuse**: Same license service for master and customer portals
- **Simplified Maintenance**: Bug fixes and features benefit both deployment modes
- **Operational Efficiency**: Single database, monitoring, and backup strategy
- **Flexibility**: Easy to add new organizations or convert customer portal to master mode
- **Analytics**: Master portal has full visibility for business intelligence

### Negative
- **Complexity**: Authorization logic must handle both deployment modes
- **Testing Burden**: Must test both master and customer portal scenarios
- **Configuration Risk**: Misconfigured deployment mode could expose wrong data
- **Performance**: Master portal queries may scan many organizations

### Mitigation Strategies

**Authorization Middleware:**
```typescript
// services/license/src/middleware/organization-filter.ts
export function enforceOrganizationAccess(req: Request, res: Response, next: Next) {
  const deploymentMode = process.env.DEPLOYMENT_MODE || 'customer';
  const requestedOrgId = req.query.organizationId || req.body.organizationId;

  if (deploymentMode === 'master') {
    // Master portal: Allow any organization
    next();
  } else {
    // Customer portal: Only allow configured organization
    const allowedOrgId = process.env.ORGANIZATION_ID;
    if (requestedOrgId && requestedOrgId !== allowedOrgId) {
      return res.status(403).json({ error: 'Access denied to this organization' });
    }
    // Inject org filter for all queries
    req.organizationFilter = { organizationId: allowedOrgId };
    next();
  }
}
```

**Database Query Filtering:**
```typescript
// Automatic organization filtering
function buildLicenseQuery(filters: LicenseFilters, req: Request): Query {
  const query = db.from('licenses').select('*');

  // Apply deployment-mode organization filter
  if (req.organizationFilter) {
    query.where('organization_id', req.organizationFilter.organizationId);
  } else if (filters.organizationId) {
    query.where('organization_id', filters.organizationId);
  }

  return query;
}
```

**Configuration Validation:**
```typescript
// Startup validation
if (process.env.DEPLOYMENT_MODE === 'customer') {
  if (!process.env.ORGANIZATION_ID) {
    throw new Error('ORGANIZATION_ID required when DEPLOYMENT_MODE=customer');
  }
}
```

**Performance Optimization:**
```typescript
// Index on organization_id for fast filtering
CREATE INDEX idx_licenses_org_id ON licenses(organization_id);

// Partitioning for large master portal databases
CREATE TABLE licenses PARTITION BY HASH (organization_id);
```

**Audit Logging:**
```typescript
// Log all cross-organization access attempts
auditLog.log({
  action: 'license_access',
  userId: req.user.id,
  requestedOrgId: requestedOrgId,
  allowedOrgIds: getAllowedOrgs(req),
  deploymentMode: process.env.DEPLOYMENT_MODE,
  granted: true/false
});
```

### Implementation Requirements

**License Service:**
- Accept `DEPLOYMENT_MODE` and `ORGANIZATION_ID` environment variables
- Enforce organization filtering in all API endpoints
- Validate deployment mode configuration on startup
- Include organization ID in all audit logs

**Admin API Endpoints:**

**Master Portal:**
```typescript
// List all licenses (optionally filtered by org)
GET /api/v1/admin/licenses?organizationId=org_123

// Create license for any org
POST /api/v1/admin/licenses
{
  "organizationId": "org_456",
  "features": {...}
}
```

**Customer Portal:**
```typescript
// List licenses (automatically filtered to portal's org)
GET /api/v1/admin/licenses

// Create license (organizationId automatically set to portal's org)
POST /api/v1/admin/licenses
{
  "features": {...}  // organizationId injected by middleware
}
```

**Database Schema:**
```sql
CREATE TABLE licenses (
  id UUID PRIMARY KEY,
  organization_id VARCHAR(255) NOT NULL,
  license_key TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  features JSONB NOT NULL,
  hwid VARCHAR(255),
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  INDEX idx_org_id (organization_id),
  INDEX idx_org_type (organization_id, type)
);
```

**Frontend UI:**

**Master Portal:**
- Organization selector dropdown in admin UI
- License list shows organization column
- Analytics dashboard with per-org breakdown

**Customer Portal:**
- No organization selector (implicitly filtered)
- License list omits organization column (always same org)
- Analytics for single organization only

## Related
- [ADR-003: Hardware Binding for Portal Licenses Only](./ADR-003-hardware-binding-portal-only.md)
- [ADR-005: Stateless Validation with Cached Public Key](./ADR-005-stateless-validation-cached-public-key.md)
- Implementation: `/services/license/src/middleware/organization-filter.ts`
- Admin API: `/services/license/src/routes/admin.ts`
- Database Schema: `/services/license/migrations/001_licenses_table.sql`
