"use strict";

const axios = require('axios');

const shared = require('@notely/shared');
const configStore = require('./configStore');
const metrics = require('../utils/metrics');

const logger = shared.logger.child({ module: 'logs-loki-client' });

const LOKI_BASE_URL = process.env.LOKI_BASE_URL || 'http://loki:3100';
const MAX_LIMIT = 1000;

const loki = axios.create({
  baseURL: LOKI_BASE_URL,
  timeout: parseInt(process.env.LOKI_HTTP_TIMEOUT_MS || '15000', 10)
});

let lastRetentionCheck = null;
let lastCheckResult = null;
let lastCheckError = null;
let checkInProgress = false;

const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

function toNano(epochMs) {
  return (BigInt(epochMs) * 1000000n).toString();
}

function fromNano(nanoString) {
  try {
    return new Date(Number(BigInt(nanoString) / 1000000n)).toISOString();
  } catch (error) {
    logger.warn('Failed to convert Loki timestamp', { nanoString, error: error.message });
    return new Date().toISOString();
  }
}

function buildSelector({ service, level }) {
  const labels = ['project="notely"'];

  if (service) {
    labels.push(`service="${service}"`);
  }

  if (level && LOG_LEVELS.includes(level.toUpperCase())) {
    labels.push(`level="${level.toUpperCase()}"`);
  }

  return `{${labels.join(',')}}`;
}

function sanitizeSearchTerm(term) {
  if (!term) {
    return null;
  }

  return String(term).replace(/["\n\r]/g, ' ').trim();
}

async function queryLogs(options = {}) {
  const {
    service,
    level,
    search,
    limit = 200,
    start,
    end,
    direction = 'backward'
  } = options;

  const endTime = end ? new Date(end).getTime() : Date.now();
  const startTime = start ? new Date(start).getTime() : endTime - 60 * 60 * 1000;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), MAX_LIMIT);

  const params = {
    query: buildSelector({ service, level }),
    limit: safeLimit,
    direction: direction === 'forward' ? 'forward' : 'backward',
    start: toNano(startTime),
    end: toNano(endTime)
  };

  const sanitizedSearch = sanitizeSearchTerm(search);
  if (sanitizedSearch) {
    params.query = `${params.query} |= "${sanitizedSearch}"`;
  }

  const started = process.hrtime.bigint();

  try {
    const response = await loki.get('/loki/api/v1/query_range', { params });
    const result = response.data?.data?.result || [];
    const entries = [];

    for (const stream of result) {
      const labels = stream.stream || {};
      for (const value of stream.values || []) {
        const [ts, message] = value;
        entries.push({
          id: `${labels.service || 'log'}-${ts}`,
          timestamp: fromNano(ts),
          tsNano: ts,
          message,
          level: labels.level || null,
          service: labels.service || null,
          container: labels.container || null,
          composeService: labels.compose_service || null,
          labels
        });
      }
    }

    entries.sort((a, b) => (a.tsNano > b.tsNano ? -1 : a.tsNano < b.tsNano ? 1 : 0));

    const nextCursor = entries.length > 0 ? entries[entries.length - 1].timestamp : null;

    const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    metrics.observeQuery(durationSeconds, 'success', 'query');

    return {
      entries,
      meta: {
        count: entries.length,
        limit: safeLimit,
        start: new Date(startTime).toISOString(),
        end: new Date(endTime).toISOString(),
        nextCursor
      }
    };
  } catch (error) {
    const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    metrics.observeQuery(durationSeconds, 'error', 'query');

    logger.error('Failed to query Loki logs', {
      error: error.message,
      status: error.response?.status,
      service,
      level,
      search: sanitizedSearch
    });
    throw error;
  }
}

async function listServices() {
  try {
    const response = await loki.get('/loki/api/v1/label/service/values');
    const values = response.data?.data || [];
    return values.sort((a, b) => a.localeCompare(b));
  } catch (error) {
    logger.error('Failed to list Loki services', { error: error.message });
    return [];
  }
}

async function getStatus() {
  const status = {
    healthy: false,
    build: null,
    runtime: null,
    retention: {
      ...configStore.getRetentionSettings(),
      last_checked_at: lastRetentionCheck,
      last_check_result: lastCheckResult,
      last_check_error: lastCheckError,
      compactor_note: 'Loki compactor enforces retention automatically'
    }
  };

  try {
    const [buildInfoResponse, runtimeInfoResponse] = await Promise.all([
      loki.get('/loki/api/v1/status/buildinfo').catch(() => null),
      loki.get('/loki/api/v1/status/runtimeinfo').catch(() => null)
    ]);

    status.build = buildInfoResponse?.data?.data || null;
    status.runtime = runtimeInfoResponse?.data?.data || null;
    status.healthy = true;
  } catch (error) {
    status.healthy = false;
    status.error = error.message;
  }

  return status;
}

async function enforceRetention(retentionDays, { dryRun = false, service } = {}) {
  if (checkInProgress) {
    return {
      status: 'skipped',
      reason: 'check_already_running'
    };
  }

  checkInProgress = true;

  const parsedRetention = Number(retentionDays);
  const effectiveRetention = Number.isFinite(parsedRetention)
    ? Math.max(1, Math.min(365, Math.floor(parsedRetention)))
    : configStore.getRetentionSettings().retention_days;
  const cutoffDate = new Date(Date.now() - effectiveRetention * 24 * 60 * 60 * 1000);
  const selectors = [service ? `{project="notely",service="${service}"}` : '{project="notely"}'];

  try {
    // Scheduled retention check - monitoring only
    // Loki's compactor handles actual deletion based on retention_period configuration
    lastRetentionCheck = new Date().toISOString();
    lastCheckResult = {
      status: 'monitored',
      retention_days: effectiveRetention,
      cutoff: cutoffDate.toISOString(),
      selectors,
      note: 'Loki compactor handles retention enforcement automatically',
      dry_run: dryRun
    };
    lastCheckError = null;

    logger.info('Log retention check completed (monitoring only)', lastCheckResult);

    return lastCheckResult;
  } catch (error) {
    lastCheckError = {
      message: error.message,
      timestamp: new Date().toISOString()
    };

    logger.error('Failed to perform retention check', {
      retention_days: effectiveRetention,
      error: error.message
    });
    throw error;
  } finally {
    checkInProgress = false;
  }
}

async function manualEnforceRetention(retentionDays, { dryRun = false, service } = {}) {
  // Manual enforcement via admin "Run Cleanup Now" button
  // This provides an override option for admins to manually trigger deletion
  if (checkInProgress) {
    return {
      status: 'skipped',
      reason: 'operation_already_running'
    };
  }

  checkInProgress = true;

  const parsedRetention = Number(retentionDays);
  const effectiveRetention = Number.isFinite(parsedRetention)
    ? Math.max(1, Math.min(365, Math.floor(parsedRetention)))
    : configStore.getRetentionSettings().retention_days;
  const cutoffDate = new Date(Date.now() - effectiveRetention * 24 * 60 * 60 * 1000);
  const selectors = [service ? `{project="notely",service="${service}"}` : '{project="notely"}'];

  if (dryRun) {
    checkInProgress = false;
    return {
      status: 'dry-run',
      retention_days: effectiveRetention,
      cutoff: cutoffDate.toISOString(),
      selectors,
      note: 'Manual enforcement dry run - no deletion performed'
    };
  }

  try {
    const payload = {
      start: '1970-01-01T00:00:00Z',
      end: cutoffDate.toISOString(),
      selectors
    };

    const response = await loki.post('/loki/api/v1/delete', payload);
    lastRetentionCheck = new Date().toISOString();
    lastCheckResult = {
      status: response.data?.status || 'success',
      retention_days: effectiveRetention,
      cutoff: cutoffDate.toISOString(),
      selectors,
      note: 'Manual enforcement via admin override'
    };
    lastCheckError = null;

    logger.info('Manual log retention enforcement completed', lastCheckResult);

    return lastCheckResult;
  } catch (error) {
    const status = error.response?.status;
    const responseData = error.response?.data;
    const message = responseData?.message || responseData?.error || error.message;

    const logPayload = {
      status,
      retention_days: effectiveRetention,
      selectors,
      response: responseData
    };

    if (status === 400) {
      const skippedResult = {
        status: 'skipped',
        reason: 'bad_request',
        error: message,
        retention_days: effectiveRetention,
        selectors,
        response: responseData
      };

      lastRetentionCheck = new Date().toISOString();
      lastCheckResult = skippedResult;
      lastCheckError = null;

      logger.warn('Loki rejected manual retention delete request', {
        ...logPayload,
        error: message
      });

      return skippedResult;
    }

    lastCheckError = {
      message,
      status,
      payload: responseData,
      timestamp: new Date().toISOString()
    };

    logger.error('Failed to manually enforce log retention', {
      ...logPayload,
      error: message
    });
    throw error;
  } finally {
    checkInProgress = false;
  }
}

async function healthCheck() {
  try {
    const response = await loki.get('/ready', { timeout: 3000 });
    return {
      healthy: response.status === 200,
      status: response.status === 200 ? 'healthy' : 'unhealthy'
    };
  } catch (error) {
    return {
      healthy: false,
      status: 'unreachable',
      error: error.message
    };
  }
}

function getEnforcementState() {
  return {
    last_checked_at: lastRetentionCheck,
    last_check_result: lastCheckResult,
    last_check_error: lastCheckError,
    in_progress: checkInProgress
  };
}

module.exports = {
  queryLogs,
  listServices,
  getStatus,
  enforceRetention,
  manualEnforceRetention,
  healthCheck,
  getEnforcementState,
  LOG_LEVELS
};
