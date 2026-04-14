/**
 * Prometheus metrics for Email service
 */

const client = require('prom-client');

let register;
let httpRequestDurationMicroseconds;
let emailSentCounter;
let emailFailedCounter;
let emailQueueSize;
let templateUsageCounter;

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

  // Email-specific metrics
  emailSentCounter = new client.Counter({
    name: 'email_sent_total',
    help: 'Total number of emails successfully sent',
    labelNames: ['template', 'recipient_type']
  });
  register.registerMetric(emailSentCounter);

  emailFailedCounter = new client.Counter({
    name: 'email_failed_total',
    help: 'Total number of failed email sends',
    labelNames: ['template', 'error_type']
  });
  register.registerMetric(emailFailedCounter);

  emailQueueSize = new client.Gauge({
    name: 'email_queue_size',
    help: 'Current number of emails in the queue'
  });
  register.registerMetric(emailQueueSize);

  templateUsageCounter = new client.Counter({
    name: 'email_template_usage_total',
    help: 'Total number of times each template has been used',
    labelNames: ['template_name']
  });
  register.registerMetric(templateUsageCounter);
}

async function handleMetricsRequest(req, res) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
}

function recordEmailSent(template, recipientType) {
  if (emailSentCounter) {
    emailSentCounter.inc({ template, recipient_type: recipientType });
  }
}

function recordEmailFailed(template, errorType) {
  if (emailFailedCounter) {
    emailFailedCounter.inc({ template, error_type: errorType });
  }
}

function setQueueSize(size) {
  if (emailQueueSize) {
    emailQueueSize.set(size);
  }
}

function recordTemplateUsage(templateName) {
  if (templateUsageCounter) {
    templateUsageCounter.inc({ template_name: templateName });
  }
}

module.exports = {
  initMetrics,
  handleMetricsRequest,
  recordEmailSent,
  recordEmailFailed,
  setQueueSize,
  recordTemplateUsage
};
