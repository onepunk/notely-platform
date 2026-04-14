/**
 * JWT Validator for WebSocket Gateway
 *
 * Validates JWT tokens using JWKS from the auth service.
 * Uses jwks-rsa for robust caching, rate limiting, and error handling.
 * Supports token extraction from Sec-WebSocket-Protocol header.
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

class JwtValidator {
  constructor({ authServiceUrl, logger, metrics }) {
    this.logger = logger;
    this.metrics = metrics;

    // Configure jwks-rsa client with sensible defaults
    this.client = jwksClient({
      jwksUri: `${authServiceUrl}/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,           // Max number of keys to cache
      cacheMaxAge: 600000,          // 10 minutes cache TTL
      rateLimit: true,
      jwksRequestsPerMinute: 10,    // Rate limit JWKS fetches
      timeout: 5000,                // 5 second timeout for JWKS fetch
    });

    // Promisified getSigningKey for cleaner async/await
    this.getSigningKey = (kid) => {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();

        this.client.getSigningKey(kid, (err, key) => {
          const duration = Date.now() - startTime;

          if (err) {
            this.logger?.warn?.('JWKS key fetch failed', {
              kid,
              error: err.message,
              duration_ms: duration,
            });
            this.metrics?.jwksFetchErrors?.inc();
            reject(err);
            return;
          }

          this.logger?.debug?.('JWKS key fetched', {
            kid,
            duration_ms: duration,
            cached: duration < 10, // If < 10ms, likely from cache
          });
          this.metrics?.jwksFetchSuccess?.inc();
          resolve(key);
        });
      });
    };
  }

  /**
   * Parse authentication from Sec-WebSocket-Protocol header
   * Format: "Bearer.<base64-token>.<deviceId>"
   *
   * @param {string} protocol - The Sec-WebSocket-Protocol value
   * @returns {{ token: string, deviceId: string }}
   */
  parseAuthProtocol(protocol) {
    if (!protocol || !protocol.startsWith('Bearer.')) {
      throw new Error('Invalid auth protocol format');
    }

    const parts = protocol.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid auth protocol format: expected Bearer.<token>.<deviceId>');
    }

    const token = Buffer.from(parts[1], 'base64').toString('utf8');
    const deviceId = parts[2];

    if (!token || !deviceId) {
      throw new Error('Invalid auth protocol: missing token or deviceId');
    }

    return { token, deviceId };
  }

  /**
   * Validate a JWT token
   *
   * @param {string} token - JWT token to validate
   * @returns {Promise<{ userId: string, email: string, role: string, scopes: string[] }>}
   */
  async validate(token) {
    const startTime = Date.now();

    try {
      // Decode header to get kid
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || !decoded.header) {
        throw new Error('Invalid token format');
      }

      const kid = decoded.header.kid;
      if (!kid) {
        throw new Error('Token missing key identifier (kid)');
      }

      // Get signing key from JWKS (with caching/rate limiting)
      const key = await this.getSigningKey(kid);
      const publicKey = key.getPublicKey();

      // Verify token
      const payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
      });

      // Only allow user tokens (not service tokens)
      if (payload.tokenType !== 'user') {
        throw new Error('Only user tokens are allowed for WebSocket connections');
      }

      const duration = Date.now() - startTime;
      this.logger?.debug?.('Token validated', {
        userId: payload.sub || payload.userId,
        duration_ms: duration,
      });
      this.metrics?.tokenValidationSuccess?.inc();

      return {
        userId: payload.sub || payload.userId,
        email: payload.email,
        role: payload.role,
        scopes: payload.scopes || [],
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger?.warn?.('Token validation failed', {
        error: error.message,
        duration_ms: duration,
      });
      this.metrics?.tokenValidationErrors?.inc();
      throw error;
    }
  }

  /**
   * Pre-warm the JWKS cache by fetching keys
   * Call this at startup to avoid cold-start latency
   */
  async warmCache() {
    try {
      // jwks-rsa doesn't expose a direct "fetch all keys" method,
      // but we can trigger a fetch by requesting a dummy key
      // The cache will be populated with all keys from the JWKS response
      this.logger?.info?.('Warming JWKS cache...');

      // Create a minimal fetch to populate cache
      // This will fail with "key not found" but still cache the JWKS
      await new Promise((resolve) => {
        this.client.getSigningKey('_warmup_', (err) => {
          // Ignore error - we just want to populate the cache
          resolve();
        });
      });

      this.logger?.info?.('JWKS cache warmed');
    } catch (error) {
      this.logger?.warn?.('Failed to warm JWKS cache', {
        error: error.message,
      });
    }
  }
}

module.exports = JwtValidator;
