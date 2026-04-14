# Notely License Service API Documentation

## Overview

The Notely License Service provides comprehensive license generation, validation, and management capabilities for the Notely platform. It uses RSA-4096 cryptographic signing to create JWT-based licenses that can be validated both online and offline.

**Version:** 1.0.0
**Base URL:** `http://localhost:3210` (development)
**API Documentation:** Available at `/api/license/docs` (Swagger UI)

## Table of Contents

1. [Authentication](#authentication)
2. [Rate Limiting](#rate-limiting)
3. [API Endpoints](#api-endpoints)
   - [Health & Monitoring](#health--monitoring)
   - [Validation (Public)](#validation-public)
   - [Admin - License Management](#admin---license-management)
4. [Error Handling](#error-handling)
5. [Testing](#testing)
6. [Integration Guide](#integration-guide)

---

## Authentication

### Admin Endpoints

Admin endpoints require JWT Bearer token authentication with the `admin` role.

**Header Format:**
```
Authorization: Bearer <jwt-token>
```

**Example:**
```bash
curl -H "Authorization: Bearer eyJhbGc..." \
  https://api.yourdomain.com/api/license/admin/generate
```

### Public Endpoints

The following endpoints do not require authentication:
- `/api/license/validate` - License validation
- `/api/license/public-key` - Public key retrieval
- `/health` - Health check
- `/ready` - Readiness check
- `/metrics` - Prometheus metrics

---

## Rate Limiting

Rate limits are enforced per IP address:

| Endpoint Category | Rate Limit | Window |
|------------------|------------|--------|
| Admin endpoints | 50 requests | 1 minute |
| Validation endpoint | 100 requests | 1 minute |
| Public key endpoint | 10 requests | 1 minute |
| Health endpoints | Unlimited | - |

**Rate Limit Response:**
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later."
}
```

---

## API Endpoints

### Health & Monitoring

#### Health Check
**Endpoint:** `GET /health`
**Authentication:** None
**Rate Limit:** Unlimited

Simple liveness probe that returns service status.

**Response:**
```json
{
  "status": "ok"
}
```

---

#### Readiness Check
**Endpoint:** `GET /ready`
**Authentication:** None
**Rate Limit:** Unlimited

Checks if service is ready to handle requests by verifying:
- Database connectivity
- Redis connectivity
- License keys availability

**Response (Ready):**
```json
{
  "status": "ready",
  "checks": {
    "database_connected": true,
    "redis_connected": true,
    "keys_loaded": true
  }
}
```

**Response (Not Ready):**
```json
{
  "status": "unhealthy",
  "checks": {
    "database_connected": true,
    "redis_connected": false,
    "keys_loaded": true
  },
  "error": "Redis connection failed"
}
```

---

#### Metrics
**Endpoint:** `GET /metrics`
**Authentication:** None
**Rate Limit:** Unlimited

Returns Prometheus-formatted metrics for monitoring.

**Response:** `text/plain` format
```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/health",status="200"} 42
...
```

---

### Validation (Public)

#### Validate License
**Endpoint:** `POST /api/license/validate`
**Authentication:** None
**Rate Limit:** 100 requests/minute

Validates a license key and returns license details if valid.

**Request Body:**
```json
{
  "licenseKey": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "hardwareId": "ABC123-DEF456-GHI789"  // Optional
}
```

**Response (Valid License):**
```json
{
  "valid": true,
  "licenseId": "123e4567-e89b-12d3-a456-426614174002",
  "type": "subscription",
  "organizationId": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "features": {
    "meetings": true,
    "recording": false,
    "transcription": true
  },
  "limits": {
    "maxUsers": 100,
    "maxStorage": 1000
  },
  "issuedAt": "2025-11-13T14:30:00Z",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

**Response (Invalid License):**
```json
{
  "valid": false,
  "reason": "License key is invalid or has been tampered with"
}
```

**Response (Expired License):**
```json
{
  "valid": false,
  "reason": "License has expired"
}
```

**Response (Hardware Mismatch):**
```json
{
  "valid": false,
  "reason": "Hardware ID mismatch"
}
```

**Example cURL:**
```bash
curl -X POST https://api.yourdomain.com/api/license/validate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "eyJhbGc...",
    "hardwareId": "ABC123"
  }'
```

---

#### Get Public Key
**Endpoint:** `GET /api/license/public-key`
**Authentication:** None
**Rate Limit:** 10 requests/minute

Returns the RSA-4096 public key in PEM format for offline license validation.

**Response:** `text/plain`
```
-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA3QKj7qHPZGN8mKZQh...
-----END PUBLIC KEY-----
```

**Example cURL:**
```bash
curl https://api.yourdomain.com/api/license/public-key
```

**Offline Validation Example (Node.js):**
```javascript
const jwt = require('jsonwebtoken');
const fs = require('fs');

// Get and cache the public key
const publicKey = fs.readFileSync('public.key', 'utf8');

// Validate license offline
try {
  const decoded = jwt.verify(licenseKey, publicKey, { algorithms: ['RS256'] });
  console.log('License valid:', decoded);
} catch (error) {
  console.error('License invalid:', error.message);
}
```

---

### Admin - License Management

All admin endpoints require authentication with an admin-role JWT token.

#### Generate License
**Endpoint:** `POST /api/license/admin/generate`
**Authentication:** Admin Bearer token required
**Rate Limit:** 50 requests/minute

Generates a new cryptographically signed license key.

**Request Body:**
```json
{
  "type": "perpetual | subscription | trial",
  "organizationId": "uuid",
  "userId": "uuid",
  "hardwareId": "string (optional)",
  "features": {
    "featureName": true/false
  },
  "limits": {
    "limitName": number
  },
  "expiresAt": "ISO 8601 datetime (required for subscription/trial)"
}
```

**Example - Perpetual License:**
```json
{
  "type": "perpetual",
  "organizationId": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "features": {
    "meetings": true,
    "recording": true,
    "transcription": true,
    "analytics": true
  },
  "limits": {
    "maxUsers": 500,
    "maxStorage": 10000,
    "maxMeetingDuration": 480
  }
}
```

**Example - Subscription License:**
```json
{
  "type": "subscription",
  "organizationId": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "features": {
    "meetings": true,
    "recording": false
  },
  "limits": {
    "maxUsers": 100,
    "maxStorage": 1000
  },
  "expiresAt": "2026-01-31T23:59:59Z"
}
```

**Example - Trial License with Hardware Binding:**
```json
{
  "type": "trial",
  "organizationId": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "hardwareId": "ABC123-DEF456-GHI789",
  "features": {
    "meetings": true
  },
  "limits": {
    "maxUsers": 10,
    "maxStorage": 100
  },
  "expiresAt": "2025-12-13T23:59:59Z"
}
```

**Success Response (201):**
```json
{
  "licenseKey": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "licenseId": "123e4567-e89b-12d3-a456-426614174002",
  "type": "subscription",
  "organizationId": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "features": {
    "meetings": true,
    "recording": false
  },
  "limits": {
    "maxUsers": 100,
    "maxStorage": 1000
  },
  "issuedAt": "2025-11-13T14:30:00Z",
  "expiresAt": "2026-01-31T23:59:59Z"
}
```

**Example cURL:**
```bash
curl -X POST https://api.yourdomain.com/api/license/admin/generate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "subscription",
    "organizationId": "123e4567-e89b-12d3-a456-426614174000",
    "userId": "123e4567-e89b-12d3-a456-426614174001",
    "features": {"meetings": true},
    "limits": {"maxUsers": 100},
    "expiresAt": "2026-01-31T23:59:59Z"
  }'
```

---

#### Get License Info
**Endpoint:** `GET /api/license/admin/info/:licenseKey`
**Authentication:** Admin Bearer token required
**Rate Limit:** 50 requests/minute

Retrieves detailed information about a specific license.

**Response (200):**
```json
{
  "licenseId": "123e4567-e89b-12d3-a456-426614174002",
  "type": "subscription",
  "organizationId": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "features": {
    "meetings": true,
    "recording": false,
    "transcription": true
  },
  "limits": {
    "maxUsers": 100,
    "maxStorage": 1000
  },
  "issuedAt": "2025-11-13T14:30:00Z",
  "expiresAt": "2025-12-31T23:59:59Z",
  "hardwareId": "ABC123-DEF456-GHI789",
  "issuer": "notely-license-service"
}
```

**Example cURL:**
```bash
curl -X GET https://api.yourdomain.com/api/license/admin/info/eyJhbGc... \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

#### Revoke License
**Endpoint:** `POST /api/license/admin/revoke/:licenseKey`
**Authentication:** Admin Bearer token required
**Rate Limit:** 50 requests/minute

Permanently revokes a license key.

**Response (200):**
```json
{
  "success": true,
  "message": "License revoked successfully",
  "licenseKey": "eyJhbGc...",
  "revokedAt": "2025-11-13T15:30:00Z"
}
```

**Example cURL:**
```bash
curl -X POST https://api.yourdomain.com/api/license/admin/revoke/eyJhbGc... \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

## Error Handling

All errors follow a consistent format:

### Standard Error Response
```json
{
  "error": "Error Type",
  "message": "Human-readable error message"
}
```

### Validation Error Response
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "organizationId",
      "message": "Organization ID must be a valid UUID"
    }
  ]
}
```

### Common HTTP Status Codes

| Status Code | Meaning | Example |
|-------------|---------|---------|
| 200 | Success | Successful validation or info retrieval |
| 201 | Created | License generated successfully |
| 400 | Bad Request | Invalid input data |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions (not admin) |
| 404 | Not Found | Endpoint or resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server-side error |
| 503 | Service Unavailable | Service not ready (dependencies down) |

### Error Examples

**Validation Error:**
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "type",
      "message": "Type must be one of: perpetual, subscription, trial"
    },
    {
      "field": "organizationId",
      "message": "Organization ID must be a valid UUID"
    }
  ]
}
```

**Authentication Error:**
```json
{
  "error": "Unauthorized",
  "message": "Authentication token is required"
}
```

**Authorization Error:**
```json
{
  "error": "Forbidden",
  "message": "Admin role is required"
}
```

**Rate Limit Error:**
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many validation requests. Please try again later."
}
```

---

## Testing

### Postman Collection

A complete Postman collection is available at `postman_collection.json`.

**Import Steps:**
1. Open Postman
2. Click "Import" → "Upload Files"
3. Select `postman_collection.json`
4. Set environment variables:
   - `baseUrl`: API base URL (e.g., `http://localhost:3210`)
   - `adminToken`: Your admin JWT token

### Integration Tests

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run integration tests only
npm run test:integration

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Manual Testing with cURL

**Generate a License:**
```bash
curl -X POST http://localhost:3210/api/license/admin/generate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "perpetual",
    "organizationId": "123e4567-e89b-12d3-a456-426614174000",
    "userId": "123e4567-e89b-12d3-a456-426614174001",
    "features": {"meetings": true},
    "limits": {"maxUsers": 100}
  }'
```

**Validate a License:**
```bash
curl -X POST http://localhost:3210/api/license/validate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "eyJhbGc..."
  }'
```

**Get Public Key:**
```bash
curl http://localhost:3210/api/license/public-key
```

---

## Integration Guide

### Portal Frontend Integration

**Example: Validate License in React**

```typescript
import axios from 'axios';

interface ValidateLicenseResponse {
  valid: boolean;
  licenseId?: string;
  type?: string;
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
  reason?: string;
}

export async function validateLicense(
  licenseKey: string,
  hardwareId?: string
): Promise<ValidateLicenseResponse> {
  try {
    const response = await axios.post<ValidateLicenseResponse>(
      '/api/license/validate',
      { licenseKey, hardwareId }
    );
    return response.data;
  } catch (error) {
    console.error('License validation failed:', error);
    return { valid: false, reason: 'Validation request failed' };
  }
}

// Usage
const result = await validateLicense(licenseKey);
if (result.valid) {
  console.log('License features:', result.features);
} else {
  console.error('Invalid license:', result.reason);
}
```

### Desktop Client Integration

**Example: Offline Validation (Electron)**

```javascript
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

class LicenseValidator {
  constructor() {
    this.publicKey = null;
  }

  async initialize() {
    // Fetch and cache public key
    const response = await fetch('https://api.yourdomain.com/api/license/public-key');
    this.publicKey = await response.text();

    // Save to local file for offline use
    fs.writeFileSync(
      path.join(__dirname, 'public.key'),
      this.publicKey
    );
  }

  validateOffline(licenseKey) {
    try {
      if (!this.publicKey) {
        this.publicKey = fs.readFileSync(
          path.join(__dirname, 'public.key'),
          'utf8'
        );
      }

      const decoded = jwt.verify(licenseKey, this.publicKey, {
        algorithms: ['RS256']
      });

      return {
        valid: true,
        license: decoded
      };
    } catch (error) {
      return {
        valid: false,
        reason: error.message
      };
    }
  }
}

// Usage
const validator = new LicenseValidator();
await validator.initialize();

const result = validator.validateOffline(licenseKey);
if (result.valid) {
  console.log('License valid:', result.license);
}
```

---

## SDK Generation (Optional)

Generate a TypeScript SDK from the OpenAPI specification:

```bash
# Install generator
npm install -g @openapitools/openapi-generator-cli

# Generate SDK
openapi-generator-cli generate \
  -i src/api/openapi.yaml \
  -g typescript-axios \
  -o sdk/typescript

# Use generated SDK
import { LicenseServiceApi } from './sdk/typescript';

const api = new LicenseServiceApi({
  basePath: 'https://api.yourdomain.com'
});

const result = await api.validateLicense({
  licenseKey: 'eyJhbGc...'
});
```

---

## Support

For questions or issues:
1. Review this documentation
2. Check the OpenAPI spec at `/api/license/docs`
3. Review integration tests in `tests/integration/`
4. Contact platform team

---

**Last Updated:** November 13, 2025
**Service Version:** 1.0.0
**API Version:** 1.0.0
