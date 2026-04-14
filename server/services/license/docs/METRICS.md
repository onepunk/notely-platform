# License Service Metrics

The license service implements Prometheus metrics to track HTTP requests, license operations, and system health.

## Metrics Endpoint

Metrics are exposed at `GET /metrics` in Prometheus format. This endpoint can be scraped by Prometheus or similar monitoring tools.

## Available Metrics

### HTTP Metrics

**`license_http_requests_total`** (Counter)
- Total number of HTTP requests
- Labels: `method`, `path`, `status`
- Automatically tracked by middleware

**`license_http_request_duration_seconds`** (Histogram)
- HTTP request duration in seconds
- Labels: `method`, `path`
- Buckets: 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2
- Automatically tracked by middleware

### License Operation Metrics

**`license_generations_total`** (Counter)
- Total number of license generation attempts
- Labels: `type` (portal/desktop), `status` (success/failure)
- Usage: Call `recordLicenseGeneration(type, success)` after generation

**`license_validations_total`** (Counter)
- Total number of license validation attempts
- Labels: `type` (portal/desktop), `valid` (true/false), `error_code`
- Usage: Call `recordLicenseValidation(type, isValid, errorCode?)` after validation

**`license_revocations_total`** (Counter)
- Total number of license revocations
- Usage: Call `recordLicenseRevocation()` when revoking a license

### System Metrics

**`license_active_connections`** (Gauge)
- Number of active database connections from the connection pool
- Automatically collected when metrics are scraped

**`license_redis_operations_total`** (Counter)
- Total number of Redis operations
- Labels: `operation` (get/set/del/etc), `status` (success/failure)
- Usage: Call `recordRedisOperation(operation, success)` after Redis operations

**`license_key_manager_initialized`** (Gauge)
- Whether the license key manager is initialized
- Value: 1 if initialized, 0 if not
- Automatically collected when metrics are scraped

### Default Node.js Metrics

The service also exposes standard Node.js metrics including:
- `process_cpu_*` - CPU usage
- `process_resident_memory_bytes` - Memory usage
- `nodejs_eventloop_lag_*` - Event loop lag
- `nodejs_heap_*` - Heap statistics
- And more...

## Using Metrics in Code

### Automatic HTTP Tracking

HTTP requests are automatically tracked by the metrics middleware. No manual instrumentation needed for basic HTTP metrics.

### Recording License Operations

```typescript
import {
  recordLicenseGeneration,
  recordLicenseValidation,
  recordLicenseRevocation
} from '../utils/metrics';

// Example: Recording license generation
async function generateLicense(type: string, options: any) {
  try {
    const license = await createLicense(type, options);
    recordLicenseGeneration(type, true);
    return license;
  } catch (error) {
    recordLicenseGeneration(type, false);
    throw error;
  }
}

// Example: Recording license validation
async function validateLicense(licenseKey: string, hwid?: string) {
  try {
    const result = await performValidation(licenseKey, hwid);
    if (result.isValid) {
      recordLicenseValidation(result.type, true);
    } else {
      recordLicenseValidation(result.type, false, result.error?.code);
    }
    return result;
  } catch (error) {
    recordLicenseValidation('unknown', false, 'VALIDATION_ERROR');
    throw error;
  }
}

// Example: Recording license revocation
async function revokeLicense(licenseId: string) {
  await performRevocation(licenseId);
  recordLicenseRevocation();
}
```

### Recording Redis Operations

```typescript
import { recordRedisOperation } from '../utils/metrics';
import { getRedisClient } from '../lib/redis';

async function cacheData(key: string, value: any) {
  try {
    const redis = getRedisClient();
    await redis.set(key, JSON.stringify(value));
    recordRedisOperation('set', true);
  } catch (error) {
    recordRedisOperation('set', false);
    throw error;
  }
}

async function getCachedData(key: string) {
  try {
    const redis = getRedisClient();
    const value = await redis.get(key);
    recordRedisOperation('get', true);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    recordRedisOperation('get', false);
    throw error;
  }
}
```

## Example Metrics Output

```
# HELP license_http_requests_total Total number of HTTP requests
# TYPE license_http_requests_total counter
license_http_requests_total{method="GET",path="/api/license/validate",status="200",service="license"} 42

# HELP license_http_request_duration_seconds HTTP request duration in seconds
# TYPE license_http_request_duration_seconds histogram
license_http_request_duration_seconds_bucket{le="0.005",method="GET",path="/api/license/validate",service="license"} 35
license_http_request_duration_seconds_bucket{le="0.01",method="GET",path="/api/license/validate",service="license"} 40
license_http_request_duration_seconds_sum{method="GET",path="/api/license/validate",service="license"} 0.234
license_http_request_duration_seconds_count{method="GET",path="/api/license/validate",service="license"} 42

# HELP license_generations_total Total number of license generation attempts
# TYPE license_generations_total counter
license_generations_total{type="portal",status="success",service="license"} 15
license_generations_total{type="desktop",status="success",service="license"} 8

# HELP license_validations_total Total number of license validation attempts
# TYPE license_validations_total counter
license_validations_total{type="portal",valid="true",error_code="none",service="license"} 120
license_validations_total{type="portal",valid="false",error_code="LICENSE_EXPIRED",service="license"} 3

# HELP license_active_connections Number of active database connections
# TYPE license_active_connections gauge
license_active_connections{service="license"} 5

# HELP license_key_manager_initialized Whether the license key manager is initialized (1 = yes, 0 = no)
# TYPE license_key_manager_initialized gauge
license_key_manager_initialized{service="license"} 1
```

## Prometheus Configuration

Add the license service to your Prometheus scrape configuration:

```yaml
scrape_configs:
  - job_name: 'license-service'
    static_configs:
      - targets: ['license:3005']
    scrape_interval: 15s
    metrics_path: /metrics
```

## Grafana Dashboards

You can create Grafana dashboards using these metrics. Example queries:

**Request Rate:**
```promql
rate(license_http_requests_total[5m])
```

**Request Duration (p95):**
```promql
histogram_quantile(0.95, rate(license_http_request_duration_seconds_bucket[5m]))
```

**License Generation Success Rate:**
```promql
sum(rate(license_generations_total{status="success"}[5m])) /
sum(rate(license_generations_total[5m]))
```

**License Validation Success Rate:**
```promql
sum(rate(license_validations_total{valid="true"}[5m])) /
sum(rate(license_validations_total[5m]))
```

**Active Database Connections:**
```promql
license_active_connections
```

## Health Check Integration

The `/metrics` endpoint is separate from health checks:
- `/health` - Liveness probe (always returns 200 if service is running)
- `/ready` - Readiness probe (checks database, Redis, and key manager)
- `/metrics` - Prometheus metrics endpoint

All three endpoints should be considered when setting up monitoring and alerting.
