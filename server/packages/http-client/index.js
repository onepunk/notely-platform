const axios = require('axios');
const logger = require('../logger');

/**
 * HTTP Client with Timeouts and Retry Logic
 *
 * Configured for resilience when calling external services:
 * - Microsoft Graph API
 * - Google Calendar API
 * - Whisper service
 * - LLM service
 *
 * Features:
 * - Configurable timeouts (prevents hanging requests)
 * - Automatic retry with exponential backoff
 * - Request/response logging
 * - Error transformation
 */

/**
 * Create HTTP client with default configuration
 *
 * @param {Object} config - Axios configuration
 * @returns {AxiosInstance} Configured Axios instance
 */
function createClient(config = {}) {
  const defaultConfig = {
    timeout: parseInt(process.env.HTTP_CLIENT_TIMEOUT_MS || '5000', 10),
    headers: {
      'User-Agent': 'Notely-Platform-V2',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    validateStatus: (status) => status < 500 // Don't reject on 4xx errors
  };

  const client = axios.create({
    ...defaultConfig,
    ...config
  });

  // Request interceptor for logging
  client.interceptors.request.use(
    (config) => {
      const requestId = logger.getRequestId();

      logger.debug('HTTP request', {
        request_id: requestId,
        method: config.method?.toUpperCase(),
        url: config.url,
        timeout: config.timeout
      });

      // Add request ID to headers if available
      if (requestId) {
        config.headers['X-Request-ID'] = requestId;
      }

      config.metadata = { startTime: Date.now() };
      return config;
    },
    (error) => {
      logger.error('HTTP request configuration error', {
        error: error.message
      });
      return Promise.reject(error);
    }
  );

  // Response interceptor for logging and retry logic
  client.interceptors.response.use(
    (response) => {
      const duration = Date.now() - response.config.metadata.startTime;

      logger.debug('HTTP response', {
        request_id: logger.getRequestId(),
        method: response.config.method?.toUpperCase(),
        url: response.config.url,
        status: response.status,
        duration_ms: duration
      });

      if (duration > 3000) {
        logger.warn('Slow HTTP request', {
          method: response.config.method?.toUpperCase(),
          url: response.config.url,
          duration_ms: duration
        });
      }

      return response;
    },
    async (error) => {
      const config = error.config;
      const duration = config?.metadata?.startTime
        ? Date.now() - config.metadata.startTime
        : 0;

      // Log error
      logger.error('HTTP request failed', {
        request_id: logger.getRequestId(),
        method: config?.method?.toUpperCase(),
        url: config?.url,
        error: error.message,
        code: error.code,
        status: error.response?.status,
        duration_ms: duration
      });

      // Retry logic
      if (config && shouldRetry(error, config)) {
        config.retryCount = config.retryCount || 0;
        const maxRetries = config.retry || parseInt(process.env.HTTP_CLIENT_RETRY_MAX || '3', 10);

        if (config.retryCount < maxRetries) {
          config.retryCount += 1;

          const delay = getRetryDelay(config.retryCount);

          logger.info('Retrying HTTP request', {
            request_id: logger.getRequestId(),
            method: config.method?.toUpperCase(),
            url: config.url,
            attempt: config.retryCount,
            max_attempts: maxRetries,
            delay_ms: delay
          });

          await sleep(delay);
          return client(config);
        }
      }

      return Promise.reject(error);
    }
  );

  return client;
}

/**
 * Determine if request should be retried
 *
 * @param {Error} error - Error object
 * @param {Object} config - Request configuration
 * @returns {boolean} True if should retry
 * @private
 */
function shouldRetry(error, config) {
  // Don't retry if retry is explicitly disabled
  if (config.retry === 0 || config.retry === false) {
    return false;
  }

  // Don't retry non-idempotent methods (POST, PATCH) by default
  if (!config.retryNonIdempotent && ['post', 'patch', 'put'].includes(config.method?.toLowerCase())) {
    return false;
  }

  // Retry on network errors
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
    return true;
  }

  // Retry on 5xx server errors
  if (error.response && error.response.status >= 500) {
    return true;
  }

  // Retry on 429 (rate limit) with backoff
  if (error.response && error.response.status === 429) {
    return true;
  }

  return false;
}

/**
 * Calculate retry delay with exponential backoff
 *
 * @param {number} retryCount - Current retry attempt
 * @returns {number} Delay in milliseconds
 * @private
 */
function getRetryDelay(retryCount) {
  const baseDelay = parseInt(process.env.HTTP_CLIENT_RETRY_DELAY_MS || '1000', 10);
  const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1);
  const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
  return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
}

/**
 * Sleep for specified duration
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 * @private
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Service-Specific Clients
// =============================================================================

/**
 * HTTP client for Microsoft Graph API
 */
const graphClient = createClient({
  baseURL: 'https://graph.microsoft.com/v1.0',
  timeout: parseInt(process.env.GRAPH_API_TIMEOUT_MS || '10000', 10),
  retry: parseInt(process.env.GRAPH_API_RETRY_MAX || '3', 10)
});

/**
 * HTTP client for Google Calendar API
 */
const googleClient = createClient({
  baseURL: 'https://www.googleapis.com/calendar/v3',
  timeout: parseInt(process.env.GOOGLE_API_TIMEOUT_MS || '10000', 10),
  retry: parseInt(process.env.GOOGLE_API_RETRY_MAX || '3', 10)
});

/**
 * HTTP client for Whisper service
 */
const whisperClient = createClient({
  baseURL: process.env.SERVICE_WHISPER_URL || 'http://notely-whisper:8001',
  timeout: parseInt(process.env.WHISPER_API_TIMEOUT_MS || '120000', 10), // 2 minutes for transcription
  retry: parseInt(process.env.WHISPER_API_RETRY_MAX || '1', 10)
});

/**
 * HTTP client for LLM service
 */
const llmClient = createClient({
  baseURL: process.env.SERVICE_LLM_URL || 'http://notely-llm:8002',
  timeout: parseInt(process.env.LLM_API_TIMEOUT_MS || '60000', 10), // 1 minute for summarization
  retry: parseInt(process.env.LLM_API_RETRY_MAX || '1', 10)
});

/**
 * Default HTTP client for general use
 */
const httpClient = createClient();

module.exports = {
  // Factory function
  createClient,

  // Pre-configured clients
  httpClient,
  graphClient,
  googleClient,
  whisperClient,
  llmClient
};
