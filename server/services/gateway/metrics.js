const client = require('prom-client');

const register = new client.Registry();
let initialised = false;

// HTTP request counter - tracks all requests through the gateway
const httpRequestsTotal = new client.Counter({
  name: 'notely_gateway_http_requests_total',
  help: 'Total number of HTTP requests processed by the gateway',
  labelNames: ['method', 'endpoint', 'service', 'status_code', 'source'],
  registers: [register]
});

// Defined API endpoints gauge - static list of all known endpoints for coverage tracking
const definedEndpointsGauge = new client.Gauge({
  name: 'notely_api_endpoint_defined',
  help: 'Static gauge indicating defined API endpoints (value=1 means endpoint is defined)',
  labelNames: ['method', 'endpoint', 'service', 'description'],
  registers: [register]
});

// HTTP request duration histogram
const httpRequestDuration = new client.Histogram({
  name: 'notely_gateway_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'endpoint', 'service'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

const authFailureCounter = new client.Counter({
  name: 'notely_gateway_auth_denied_total',
  help: 'Total number of requests denied by the gateway auth layer',
  labelNames: ['status', 'reason'],
  registers: [register]
});

const introspectionDuration = new client.Histogram({
  name: 'notely_gateway_introspection_duration_seconds',
  help: 'Duration of token introspection requests made by the gateway',
  labelNames: ['outcome'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register]
});

const circuitBreakerStateGauge = new client.Gauge({
  name: 'notely_gateway_circuit_breaker_state',
  help: 'Current state of gateway circuit breakers (0=closed, 1=half_open, 2=open)',
  labelNames: ['route'],
  registers: [register]
});

const circuitBreakerTransitions = new client.Counter({
  name: 'notely_gateway_circuit_breaker_transitions_total',
  help: 'Total number of circuit breaker state transitions',
  labelNames: ['route', 'from', 'to'],
  registers: [register]
});

const circuitBreakerFallbacks = new client.Counter({
  name: 'notely_gateway_circuit_breaker_fallbacks_total',
  help: 'Total number of fallback responses served due to open circuit breakers',
  labelNames: ['route'],
  registers: [register]
});

const circuitBreakerFailures = new client.Counter({
  name: 'notely_gateway_circuit_breaker_failures_total',
  help: 'Total number of upstream failures recorded by circuit breakers',
  labelNames: ['route', 'reason'],
  registers: [register]
});

const BREAKER_STATE_VALUE = {
  closed: 0,
  half_open: 1,
  open: 2
};

function initMetrics(serviceName = 'gateway') {
  if (initialised) {
    return;
  }

  register.setDefaultLabels({
    service: serviceName
  });

  client.collectDefaultMetrics({ register });
  initialised = true;
}

async function handleMetricsRequest(req, res) {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.status(200).send(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'metrics_collection_failed',
      message: error.message
    });
  }
}

function recordCircuitTransition(route, fromState, toState) {
  const numericState = BREAKER_STATE_VALUE[toState];
  if (numericState !== undefined) {
    circuitBreakerStateGauge.set({ route }, numericState);
  }
  circuitBreakerTransitions.inc({ route, from: fromState, to: toState });
}

function recordCircuitFallback(route) {
  circuitBreakerFallbacks.inc({ route });
}

function recordCircuitFailure(route, reason) {
  circuitBreakerFailures.inc({ route, reason });
}

/**
 * Normalize endpoint path for metrics to avoid high cardinality.
 * Replaces dynamic path segments (UUIDs, numeric IDs) with placeholders.
 */
function normalizeEndpoint(path) {
  if (!path) return 'unknown';

  // Normalize common patterns to reduce cardinality
  return path
    // Replace UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    // Replace numeric IDs
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    // Replace long alphanumeric IDs (like MongoDB ObjectIds)
    .replace(/\/[a-f0-9]{24}(?=\/|$)/gi, '/:id')
    // Normalize query strings
    .split('?')[0];
}

/**
 * Record an HTTP request metric
 * @param {string} method - HTTP method
 * @param {string} endpoint - Request path
 * @param {string} service - Target service name
 * @param {number} statusCode - HTTP response status code
 * @param {number} durationSeconds - Request duration in seconds
 * @param {string} source - Request source: 'external' (via nginx/cloudflare), 'internal' (prometheus/docker)
 */
function recordHttpRequest(method, endpoint, service, statusCode, durationSeconds, source = 'internal') {
  const normalizedEndpoint = normalizeEndpoint(endpoint);

  httpRequestsTotal.inc({
    method: method || 'UNKNOWN',
    endpoint: normalizedEndpoint,
    service: service || 'unknown',
    status_code: String(statusCode || 0),
    source: source
  });

  if (durationSeconds !== undefined && durationSeconds !== null) {
    httpRequestDuration.observe(
      {
        method: method || 'UNKNOWN',
        endpoint: normalizedEndpoint,
        service: service || 'unknown'
      },
      durationSeconds
    );
  }
}

/**
 * Register all defined API endpoints for coverage tracking.
 * This creates a static metric for each known endpoint so we can
 * compare against actual traffic to identify unused endpoints.
 */
function registerDefinedEndpoints(endpoints) {
  if (!Array.isArray(endpoints)) {
    return;
  }

  for (const ep of endpoints) {
    if (!ep.endpoint || !ep.method || !ep.service) {
      continue;
    }

    // Skip internal/local endpoints
    if (ep.security === 'INTERNAL' || ep.security === 'LOCAL' || ep.security === 'N/A') {
      continue;
    }

    definedEndpointsGauge.set(
      {
        method: ep.method,
        endpoint: ep.endpoint,
        service: ep.service.toLowerCase(),
        description: (ep.description || '').substring(0, 100)
      },
      1
    );
  }
}

module.exports = {
  initMetrics,
  register,
  handleMetricsRequest,
  httpRequestsTotal,
  httpRequestDuration,
  recordHttpRequest,
  normalizeEndpoint,
  definedEndpointsGauge,
  registerDefinedEndpoints,
  authFailureCounter,
  introspectionDuration,
  recordCircuitTransition,
  recordCircuitFallback,
  recordCircuitFailure,
  circuitBreakerStateGauge,
  circuitBreakerTransitions,
  circuitBreakerFallbacks,
  circuitBreakerFailures
};
