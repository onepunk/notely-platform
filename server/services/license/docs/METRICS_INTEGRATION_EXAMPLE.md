# Metrics Integration Examples

This document provides concrete examples of how to integrate the metrics functions into the existing license service code.

## Example 1: License Generator Service

Modify `/src/services/licenseGenerator.ts` to record license generation metrics:

```typescript
import {
  recordLicenseGeneration
} from '../utils/metrics';

export async function generateLicense(
  type: 'portal' | 'desktop',
  options: LicenseGenerationOptions
): Promise<string> {
  try {
    // ... existing license generation logic ...
    const licenseKey = createLicenseKey(payload);

    // Record successful generation
    recordLicenseGeneration(type, true);

    return licenseKey;
  } catch (error) {
    // Record failed generation
    recordLicenseGeneration(type, false);
    throw error;
  }
}
```

## Example 2: License Validator Service

Modify `/src/services/licenseValidator.ts` to record validation metrics:

```typescript
import {
  recordLicenseValidation
} from '../utils/metrics';

export async function validateLicense(
  licenseKey: string,
  hwid?: string
): Promise<ValidationResult> {
  try {
    // ... existing validation logic ...
    const result = performValidation(licenseKey, hwid);

    // Record validation result
    if (result.isValid) {
      recordLicenseValidation(result.type || 'unknown', true);
    } else {
      recordLicenseValidation(
        result.type || 'unknown',
        false,
        result.error?.code
      );
    }

    return result;
  } catch (error) {
    // Record validation error
    recordLicenseValidation('unknown', false, 'VALIDATION_ERROR');
    throw error;
  }
}
```

## Example 3: License Revocation

Add to the admin controller or service where revocation happens:

```typescript
import {
  recordLicenseRevocation
} from '../utils/metrics';

export async function revokeLicense(licenseId: string): Promise<void> {
  // ... existing revocation logic ...
  await db.query('UPDATE licenses SET revoked = true WHERE id = $1', [licenseId]);

  // Record revocation
  recordLicenseRevocation();
}
```

## Example 4: Redis Operations

If you're using Redis for caching, wrap operations with metrics:

```typescript
import {
  recordRedisOperation
} from '../utils/metrics';
import { getRedisClient } from '../lib/redis';

export async function cacheLicenseValidation(
  licenseKey: string,
  result: ValidationResult,
  ttlSeconds: number = 300
): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = `license:validation:${licenseKey}`;
    await redis.setEx(key, ttlSeconds, JSON.stringify(result));
    recordRedisOperation('set', true);
  } catch (error) {
    recordRedisOperation('set', false);
    throw error;
  }
}

export async function getCachedValidation(
  licenseKey: string
): Promise<ValidationResult | null> {
  try {
    const redis = getRedisClient();
    const key = `license:validation:${licenseKey}`;
    const cached = await redis.get(key);
    recordRedisOperation('get', true);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    recordRedisOperation('get', false);
    return null; // Fail gracefully on cache miss
  }
}
```

## Example 5: Admin Routes with Metrics

The admin routes will automatically have HTTP metrics tracked by the middleware, but you can add business logic metrics:

```typescript
import express from 'express';
import {
  recordLicenseGeneration,
  recordLicenseRevocation
} from '../utils/metrics';

const router = express.Router();

// Generate new license
router.post('/generate', async (req, res) => {
  try {
    const { type, customerId, features } = req.body;

    // Generate license
    const license = await generateLicense(type, { customerId, features });

    // Metrics are recorded inside generateLicense()

    res.status(201).json({ license });
  } catch (error) {
    // Error metrics are recorded inside generateLicense()
    res.status(500).json({ error: 'Failed to generate license' });
  }
});

// Revoke license
router.post('/:id/revoke', async (req, res) => {
  try {
    const { id } = req.params;

    await revokeLicense(id);
    recordLicenseRevocation();

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke license' });
  }
});

export default router;
```

## Testing Metrics

You can test metrics integration locally:

### 1. Start the service
```bash
npm run dev
```

### 2. Make some requests
```bash
# Generate a license
curl -X POST http://localhost:3005/api/license/admin/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"portal","customerId":"test-customer","features":["meetings"]}'

# Validate a license
curl -X POST http://localhost:3005/api/license/validate \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"NOTELY-PORTAL-..."}'
```

### 3. Check the metrics
```bash
curl http://localhost:3005/metrics
```

You should see output like:
```
license_http_requests_total{method="POST",path="/api/license/validate",status="200",service="license"} 1
license_validations_total{type="portal",valid="true",error_code="none",service="license"} 1
```

## Best Practices

1. **Always record both success and failure** - This helps track error rates
2. **Use meaningful error codes** - Pass specific error codes to validation metrics
3. **Record at the service layer** - Put metric recording in service functions, not controllers
4. **Don't block on metrics** - Metrics recording should never throw exceptions
5. **Use try-catch** - Wrap metrics in try-catch if calling from critical paths

## Common Patterns

### Pattern: Wrap with Metrics
```typescript
async function businessLogic(params: any) {
  try {
    const result = await performOperation(params);
    recordMetric(params.type, true);
    return result;
  } catch (error) {
    recordMetric(params.type, false);
    throw error;
  }
}
```

### Pattern: Conditional Metrics
```typescript
async function validate(license: string) {
  const result = await validateLicense(license);

  if (result.isValid) {
    recordMetric(result.type, true);
  } else {
    recordMetric(result.type, false, result.error?.code);
  }

  return result;
}
```

### Pattern: Optional Metrics (for non-critical paths)
```typescript
async function cacheData(key: string, value: any) {
  try {
    await redis.set(key, value);
    recordRedisOperation('set', true);
  } catch (error) {
    // Log error but don't fail the operation
    recordRedisOperation('set', false);
  }
}
```
