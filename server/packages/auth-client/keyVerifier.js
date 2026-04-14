"use strict";

const crypto = require('crypto');

class ApiKeyVerifier {
  constructor({
    authBaseUrl,
    serviceTokenClient,
    logger,
    cacheTtlMs = 60000,
    negativeCacheTtlMs = 5000,
    fetchImpl = global.fetch
  }) {
    if (!authBaseUrl) {
      throw new Error('ApiKeyVerifier requires authBaseUrl');
    }

    if (!serviceTokenClient || typeof serviceTokenClient.getToken !== 'function') {
      throw new Error('ApiKeyVerifier requires a serviceTokenClient with getToken()');
    }

    if (typeof fetchImpl !== 'function') {
      throw new Error('ApiKeyVerifier requires a fetch implementation');
    }

    this.authBaseUrl = authBaseUrl.replace(/\/$/, '');
    this.serviceTokenClient = serviceTokenClient;
    this.logger = logger || console;
    this.cacheTtlMs = cacheTtlMs;
    this.negativeCacheTtlMs = negativeCacheTtlMs;
    this.fetch = fetchImpl;

    this.cache = new Map();
    this.inflight = new Map();
  }

  async verify(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return { valid: false, reason: 'missing_key' };
    }

    const cacheKey = this.#hash(apiKey);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (this.inflight.has(cacheKey)) {
      return this.inflight.get(cacheKey);
    }

    const promise = this.#requestVerification(apiKey, cacheKey)
      .catch((error) => {
        this.logger?.error?.('API key verification request failed', {
          error: error.message
        });
        throw error;
      })
      .finally(() => {
        this.inflight.delete(cacheKey);
      });

    this.inflight.set(cacheKey, promise);
    return promise;
  }

  async #requestVerification(apiKey, cacheKey) {
    const start = Date.now();
    let token;

    try {
      token = await this.serviceTokenClient.getToken();
    } catch (error) {
      this.logger?.error?.('Failed to obtain service token for API key verification', {
        error: error.message
      });
      throw error;
    }

    const response = await this.fetch(`${this.authBaseUrl}/internal/api-keys/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ apiKey })
    });

    if (response.status === 401) {
      this.serviceTokenClient.invalidate?.();
      throw new Error('Service token rejected by Auth while verifying API key');
    }

    if (!response.ok) {
      throw new Error(`Auth API key verification failed: ${response.status}`);
    }

    const payload = await response.json();
    const duration = Date.now() - start;

    if (duration > 1000) {
      this.logger?.warn?.('Slow API key verification via Auth', { duration_ms: duration });
    }

    const result = {
      valid: Boolean(payload.valid),
      reason: payload.reason,
      key: payload.key || null
    };

    const ttl = result.valid ? this.cacheTtlMs : this.negativeCacheTtlMs;
    this.cache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + ttl
    });

    return result;
  }

  #hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}

module.exports = ApiKeyVerifier;
