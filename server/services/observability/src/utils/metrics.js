"use strict";

const client = require('prom-client');

const register = new client.Registry();
let initialized = false;

const lokiQueryHistogram = new client.Histogram({
  name: 'notely_logs_query_duration_seconds',
  help: 'Histogram of Loki query durations',
  labelNames: ['operation', 'outcome'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register]
});

const retentionCounter = new client.Counter({
  name: 'notely_logs_retention_runs_total',
  help: 'Count of log retention enforcement runs',
  labelNames: ['trigger', 'result'],
  registers: [register]
});

function initMetrics(serviceName = 'logs') {
  if (initialized) {
    return;
  }

  register.setDefaultLabels({
    service: serviceName
  });

  client.collectDefaultMetrics({ register });
  initialized = true;
}

async function handleMetricsRequest(_req, res) {
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

function observeQuery(durationSeconds, outcome = 'success', operation = 'query') {
  lokiQueryHistogram.observe({ operation, outcome }, durationSeconds);
}

function incrementRetention(trigger, result) {
  retentionCounter.inc({ trigger: trigger || 'unknown', result: result || 'unknown' });
}

module.exports = {
  initMetrics,
  handleMetricsRequest,
  observeQuery,
  incrementRetention
};
