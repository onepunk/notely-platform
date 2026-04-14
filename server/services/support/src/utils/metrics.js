/**
 * Prometheus metrics for Support service
 */

const client = require('prom-client');

let register;
let httpRequestDurationMicroseconds;
let ticketCreatedCounter;
let ticketStatusChangeCounter;
let messageAddedCounter;

function initMetrics(serviceName) {
  register = new client.Registry();

  // Add default labels
  register.setDefaultLabels({
    service: serviceName
  });

  // Collect default metrics
  client.collectDefaultMetrics({ register });

  // HTTP request duration histogram
  httpRequestDurationMicroseconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
  });
  register.registerMetric(httpRequestDurationMicroseconds);

  // Support-specific metrics
  ticketCreatedCounter = new client.Counter({
    name: 'support_tickets_created_total',
    help: 'Total number of support tickets created',
    labelNames: ['source', 'category', 'priority']
  });
  register.registerMetric(ticketCreatedCounter);

  ticketStatusChangeCounter = new client.Counter({
    name: 'support_ticket_status_changes_total',
    help: 'Total number of ticket status changes',
    labelNames: ['from_status', 'to_status']
  });
  register.registerMetric(ticketStatusChangeCounter);

  messageAddedCounter = new client.Counter({
    name: 'support_messages_added_total',
    help: 'Total number of messages added to tickets',
    labelNames: ['source', 'is_internal']
  });
  register.registerMetric(messageAddedCounter);
}

async function handleMetricsRequest(req, res) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
}

function recordTicketCreated(source, category, priority) {
  if (ticketCreatedCounter) {
    ticketCreatedCounter.inc({ source, category, priority });
  }
}

function recordStatusChange(fromStatus, toStatus) {
  if (ticketStatusChangeCounter) {
    ticketStatusChangeCounter.inc({ from_status: fromStatus, to_status: toStatus });
  }
}

function recordMessageAdded(source, isInternal) {
  if (messageAddedCounter) {
    messageAddedCounter.inc({ source, is_internal: String(isInternal) });
  }
}

module.exports = {
  initMetrics,
  handleMetricsRequest,
  recordTicketCreated,
  recordStatusChange,
  recordMessageAdded
};
