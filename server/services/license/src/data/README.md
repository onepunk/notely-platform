# License Service Data Access Layer

This directory contains the raw SQL data access layer for the license service.

## Architecture

- **No ORM**: Uses raw SQL queries with the `pg` library for maximum control and performance
- **Parameterized Queries**: All queries use `$1`, `$2`, etc. to prevent SQL injection
- **Singleton Pattern**: Each repository exports a singleton instance for easy importing
- **Type Safety**: Full TypeScript types matching the database schema

## Files

- `types.ts` - TypeScript interfaces matching the database schema
- `LicenseRepository.ts` - CRUD operations for licenses
- `ValidationRepository.ts` - Log and query validation attempts
- `FeatureRepository.ts` - Query feature definitions
- `SessionRepository.ts` - Track concurrent sessions
- `index.ts` - Barrel export for all repositories and types

## Usage Examples

### License Operations

```typescript
import { licenseRepository, License } from './data';

// Create a new license
const newLicense = await licenseRepository.create({
  license_key: 'ABC-DEF-GHI-JKL',
  license_type: 'portal',
  organization_id: 'org-uuid',
  user_id: null,
  features: ['feature1', 'feature2'],
  limits: { maxUsers: 100, maxStorage: 1000 },
  issued_at: new Date(),
  expires_at: new Date('2025-12-31'),
  revoked_at: null,
  revocation_reason: null,
  hardware_id: null,
  issued_by: 'admin-uuid',
  notes: 'Initial license',
});

// Find license by key
const license = await licenseRepository.findByKey('ABC-DEF-GHI-JKL');

// Find all licenses for an organization
const orgLicenses = await licenseRepository.findByOrganization('org-uuid');

// Revoke a license
await licenseRepository.revoke('license-uuid', 'Subscription expired');

// Find all active licenses
const activeLicenses = await licenseRepository.findActive();

// Update license features
await licenseRepository.updateFeatures('license-uuid', ['feature1', 'feature2', 'feature3']);

// Extend expiration
await licenseRepository.extendExpiration('license-uuid', new Date('2026-12-31'));
```

### Validation Logging

```typescript
import { validationRepository } from './data';
import crypto from 'crypto';

// Log a validation attempt
await validationRepository.logValidation({
  license_id: 'license-uuid',
  license_key_hash: crypto.createHash('sha256').update('ABC-DEF-GHI-JKL').digest('hex'),
  is_valid: true,
  validation_type: 'online',
  failure_reason: null,
  validated_by_service: 'license-service',
  client_version: '1.0.0',
  ip_address: '192.168.1.1',
  user_agent: 'Notely Desktop/1.0.0',
  request_metadata: { platform: 'darwin', arch: 'x64' },
});

// Get validation history
const history = await validationRepository.getValidationHistory('license-uuid', 50);

// Get validation statistics
const stats = await validationRepository.getValidationStats(new Date('2025-01-01'));
console.log(`Total: ${stats.total}, Success: ${stats.successful}, Failed: ${stats.failed}`);

// Get recent failures
const failures = await validationRepository.getRecentFailures(10);
```

### Feature Management

```typescript
import { featureRepository } from './data';

// Get all active features
const activeFeatures = await featureRepository.getAllActive();

// Validate feature keys
const isValid = await featureRepository.validateFeatures(['feature1', 'feature2']);

// Get invalid features from a list
const invalidKeys = await featureRepository.getInvalidFeatures(['feature1', 'feature2', 'invalid']);
console.log('Invalid features:', invalidKeys); // ['invalid']

// Get features by category
const desktopFeatures = await featureRepository.getByCategory('desktop');

// Create a new feature
const newFeature = await featureRepository.create({
  feature_key: 'advanced_analytics',
  display_name: 'Advanced Analytics',
  description: 'Access to advanced analytics dashboard',
  feature_category: 'portal',
  is_active: true,
  metadata: { tier: 'premium' },
});

// Update a feature
await featureRepository.update('feature-uuid', {
  display_name: 'Advanced Analytics Suite',
  description: 'Full access to analytics and reporting',
});

// Deactivate a feature
await featureRepository.deactivate('feature-uuid');
```

### Session Tracking

```typescript
import { sessionRepository } from './data';

// Upsert a session (create or update heartbeat)
const session = await sessionRepository.upsertSession({
  user_id: 'user-uuid',
  client_id: 'client-123',
  session_token: 'unique-session-token',
  license_id: 'license-uuid',
  organization_id: 'org-uuid',
  client_version: '1.0.0',
  platform: 'darwin',
  ip_address: '192.168.1.1',
  is_active: true,
  metadata: { device_name: 'MacBook Pro' },
});

// Record a heartbeat
await sessionRepository.recordHeartbeat('unique-session-token');

// Get active session count for an organization
const activeCount = await sessionRepository.getActiveCount('org-uuid');
console.log(`Active sessions: ${activeCount}`);

// Get all active sessions
const activeSessions = await sessionRepository.getActiveSessions('org-uuid');

// Deactivate a session
await sessionRepository.deactivateSession('unique-session-token');

// Clean up stale sessions (returns count of cleaned up sessions)
const cleanedUp = await sessionRepository.cleanupStaleSessions(30); // 30 minutes
console.log(`Cleaned up ${cleanedUp} stale sessions`);

// Get session statistics
const stats = await sessionRepository.getSessionStats('org-uuid');
console.log(`Total: ${stats.total}, Active: ${stats.active}, Inactive: ${stats.inactive}, Stale: ${stats.stale}`);

// Delete old sessions (for maintenance)
const deleted = await sessionRepository.deleteOldSessions(90); // 90 days
console.log(`Deleted ${deleted} old sessions`);
```

## Database Schema

The repositories work with the `licensing` schema:

- `licensing.licenses` - License records
- `licensing.license_validations` - Validation attempt logs
- `licensing.feature_definitions` - Available features
- `licensing.active_sessions` - Active client sessions

## Error Handling

All repository methods may throw errors. Wrap calls in try-catch blocks:

```typescript
try {
  const license = await licenseRepository.findById('invalid-uuid');
} catch (error) {
  console.error('Database error:', error);
  // Handle error appropriately
}
```

## Connection Management

The repositories use the pool from `../lib/database.ts`:

- Connection pooling is handled automatically
- Pool is created on first use
- Use `closePool()` for graceful shutdown if needed

## Best Practices

1. **Use singleton instances**: Import from `./data` rather than instantiating new repositories
2. **Parameterized queries**: Never concatenate user input into SQL strings
3. **Transaction support**: Use `withClient()` from `../lib/database.ts` for multi-step operations
4. **JSONB handling**: Features, limits, and metadata are automatically serialized/deserialized
5. **Date handling**: PostgreSQL timestamps are automatically converted to JavaScript Date objects

## Transaction Example

```typescript
import { withClient } from '../lib/database';
import { licenseRepository, validationRepository } from './data';

await withClient(async (client) => {
  await client.query('BEGIN');
  try {
    // Create license
    const license = await licenseRepository.create({...});

    // Log validation
    await validationRepository.logValidation({
      license_id: license.id,
      ...
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
});
```
