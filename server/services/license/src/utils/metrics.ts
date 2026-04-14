import { Request, Response } from 'express';
import * as client from 'prom-client';
import { getPool } from '../lib/database';
import { isInitialized as isKeyManagerInitialized } from '../services/keyManager';

const register = new client.Registry();
let initialized = false;

// HTTP Metrics
const httpRequestsTotal = new client.Counter({
  name: 'license_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'license_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});

// License Operation Metrics
const licenseGenerationsTotal = new client.Counter({
  name: 'license_generations_total',
  help: 'Total number of license generation attempts',
  labelNames: ['type', 'status'],
  registers: [register],
});

const licenseValidationsTotal = new client.Counter({
  name: 'license_validations_total',
  help: 'Total number of license validation attempts',
  labelNames: ['type', 'valid', 'error_code'],
  registers: [register],
});

const licenseRevocationsTotal = new client.Counter({
  name: 'license_revocations_total',
  help: 'Total number of license revocations',
  registers: [register],
});

// System Metrics
const activeConnections = new client.Gauge({
  name: 'license_active_connections',
  help: 'Number of active database connections',
  registers: [register],
  async collect() {
    try {
      const pool = getPool();
      this.set(pool.totalCount);
    } catch (error) {
      // If pool isn't initialized, set to 0
      this.set(0);
    }
  },
});

const redisOperationsTotal = new client.Counter({
  name: 'license_redis_operations_total',
  help: 'Total number of Redis operations',
  labelNames: ['operation', 'status'],
  registers: [register],
});

const keyManagerInitializedGauge = new client.Gauge({
  name: 'license_key_manager_initialized',
  help: 'Whether the license key manager is initialized (1 = yes, 0 = no)',
  registers: [register],
  collect() {
    this.set(isKeyManagerInitialized() ? 1 : 0);
  },
});

/**
 * Initialize metrics registry with default labels and collectors
 */
export function initMetrics(serviceName = 'license'): void {
  if (initialized) {
    return;
  }

  register.setDefaultLabels({
    service: serviceName,
  });

  // Collect default Node.js metrics (CPU, memory, event loop, etc.)
  client.collectDefaultMetrics({ register });

  initialized = true;
}

/**
 * Record an HTTP request
 */
export function recordHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  const status = statusCode.toString();
  httpRequestsTotal.inc({ method, path, status });
  httpRequestDuration.observe({ method, path }, durationMs / 1000);
}

/**
 * Record a license generation attempt
 */
export function recordLicenseGeneration(type: string, success: boolean): void {
  const status = success ? 'success' : 'failure';
  licenseGenerationsTotal.inc({ type, status });
}

/**
 * Record a license validation attempt
 */
export function recordLicenseValidation(
  type: string,
  isValid: boolean,
  errorCode?: string
): void {
  const valid = isValid ? 'true' : 'false';
  const error_code = errorCode || 'none';
  licenseValidationsTotal.inc({ type, valid, error_code });
}

/**
 * Record a license revocation
 */
export function recordLicenseRevocation(): void {
  licenseRevocationsTotal.inc();
}

/**
 * Record a Redis operation
 */
export function recordRedisOperation(operation: string, success: boolean): void {
  const status = success ? 'success' : 'failure';
  redisOperationsTotal.inc({ operation, status });
}

/**
 * Express handler for the /metrics endpoint
 */
export async function getMetricsHandler(_req: Request, res: Response): Promise<void> {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.status(200).send(metrics);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'metrics_collection_failed',
      message: errorMessage,
    });
  }
}

/**
 * Middleware to automatically record HTTP request metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: () => void): void {
  const startTime = Date.now();

  // Capture the original res.send to intercept response
  const originalSend = res.send;
  res.send = function (body: any): Response {
    const duration = Date.now() - startTime;
    const path = req.route?.path || req.path;
    recordHttpRequest(req.method, path, res.statusCode, duration);
    return originalSend.call(this, body);
  };

  next();
}
