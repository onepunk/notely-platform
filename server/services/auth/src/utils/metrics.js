const client = require('prom-client');

const register = new client.Registry();
let initialised = false;

// API Key Verification Metrics
const apiKeyVerificationAttempts = new client.Counter({
  name: 'auth_api_key_verification_attempts_total',
  help: 'Total number of API key verification attempts',
  labelNames: ['key_type', 'status'], // key_type: service|client, status: success|failure
  registers: [register]
});

const apiKeyVerificationFailures = new client.Counter({
  name: 'auth_api_key_verification_failures_total',
  help: 'Total number of API key verification failures',
  labelNames: ['key_type', 'reason'], // reason: not_found|invalid_key|missing_key|inactive
  registers: [register]
});

const apiKeyVerificationLatency = new client.Histogram({
  name: 'auth_api_key_verification_duration_seconds',
  help: 'API key verification latency in seconds',
  labelNames: ['key_type'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register]
});

const apiKeyLastUsedUpdates = new client.Counter({
  name: 'auth_api_key_last_used_updates_total',
  help: 'Total number of successful API key last_used_at timestamp updates',
  labelNames: ['key_type'],
  registers: [register]
});

const oidcLoginResults = new client.Counter({
  name: 'auth_oidc_login_results_total',
  help: 'OIDC login results grouped by provider and outcome',
  labelNames: ['provider', 'result'],
  registers: [register]
});

const oidcLoginFailures = new client.Counter({
  name: 'auth_oidc_login_failures_total',
  help: 'OIDC login failure reasons grouped by provider',
  labelNames: ['provider', 'reason'],
  registers: [register]
});

function initMetrics(serviceName = 'auth') {
  if (initialised) {
    return;
  }

  register.setDefaultLabels({
    service: serviceName
  });

  client.collectDefaultMetrics({ register });
  initialised = true;
}

function recordApiKeyVerification(keyType, success, reason = null, durationSeconds = null) {
  const status = success ? 'success' : 'failure';
  apiKeyVerificationAttempts.inc({ key_type: keyType, status });

  if (!success && reason) {
    apiKeyVerificationFailures.inc({ key_type: keyType, reason });
  }

  if (durationSeconds !== null) {
    apiKeyVerificationLatency.observe({ key_type: keyType }, durationSeconds);
  }
}

function recordApiKeyLastUsedUpdate(keyType) {
  apiKeyLastUsedUpdates.inc({ key_type: keyType });
}

function recordOidcLoginResult(provider, success, reason = null) {
  const result = success ? 'success' : 'failure';
  oidcLoginResults.inc({ provider, result });

  if (!success && reason) {
    oidcLoginFailures.inc({ provider, reason });
  }
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

module.exports = {
  initMetrics,
  handleMetricsRequest,
  register,
  recordApiKeyVerification,
  recordApiKeyLastUsedUpdate,
  recordOidcLoginResult
};
