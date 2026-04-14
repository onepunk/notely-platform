const { createPublicKey } = require('crypto');

class JwksClient {
  constructor({ jwksUri, cacheTtlMs = 300000, logger }) {
    this.jwksUri = jwksUri;
    this.cacheTtlMs = cacheTtlMs;
    this.logger = logger;
    this.cache = new Map();
    this.expiresAt = 0;
  }

  async getKey(kid) {
    if (!kid) {
      throw new Error('Token missing key identifier (kid)');
    }

    const cached = this.cache.get(kid);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    await this.refresh();

    const refreshed = this.cache.get(kid);
    if (!refreshed) {
      throw new Error(`JWKS does not contain key id ${kid}`);
    }

    return refreshed;
  }

  async refresh(force = false) {
    if (!force && this.expiresAt > Date.now()) {
      return;
    }

    const response = await fetch(this.jwksUri, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS: ${response.status}`);
    }

    const body = await response.json();

    if (!Array.isArray(body.keys)) {
      throw new Error('JWKS response missing keys array');
    }

    this.cache.clear();

    for (const key of body.keys) {
      if (!key.kid) {
        continue;
      }

      try {
        const publicKey = createPublicKey({ key, format: 'jwk' });
        const pem = publicKey.export({ type: 'spki', format: 'pem' });
        this.cache.set(key.kid, {
          kid: key.kid,
          alg: key.alg || 'RS256',
          pem,
          expiresAt: Date.now() + this.cacheTtlMs
        });
      } catch (error) {
        this.logger?.warn?.('Failed to import JWKS key', {
          kid: key.kid,
          error: error.message
        });
      }
    }

    this.expiresAt = Date.now() + this.cacheTtlMs;
  }
}

module.exports = JwksClient;
