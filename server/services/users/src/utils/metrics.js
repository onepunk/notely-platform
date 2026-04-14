const client = require('prom-client');

const register = new client.Registry();
let initialised = false;

const profileRequestDuration = new client.Histogram({
  name: 'notely_users_profile_request_duration_seconds',
  help: 'Duration histogram for profile retrieval operations',
  labelNames: ['route', 'outcome'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register]
});

function initMetrics(serviceName = 'users') {
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

function observeProfileRequest(durationSeconds, outcome = 'success', route = '/api/users/me') {
  profileRequestDuration.observe({ route, outcome }, durationSeconds);
}

module.exports = {
  initMetrics,
  handleMetricsRequest,
  observeProfileRequest
};
