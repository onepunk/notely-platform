const jwt = require('jsonwebtoken');
const { LRUCache } = require('lru-cache');
const { AuthorizationError, RecoverableIntrospectionError } = require('./errors');

// Maximum number of tokens to cache (prevents memory exhaustion)
const MAX_CACHE_SIZE = parseInt(process.env.TOKEN_CACHE_MAX_SIZE) || 100000;

class TokenValidator {
  constructor({ jwksClient, introspectionClient, logger, sessionCacheTtlMs = 60000 }) {
    this.jwksClient = jwksClient;
    this.introspectionClient = introspectionClient;
    this.logger = logger;
    this.sessionCacheTtlMs = sessionCacheTtlMs;
    this.sessionCache = new LRUCache({
      max: MAX_CACHE_SIZE,
      ttl: sessionCacheTtlMs
    });
  }

  async verify(token) {
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || !decoded.header) {
      throw new AuthorizationError('Malformed token', { reason: 'malformed' });
    }

    try {
      const key = await this.jwksClient.getKey(decoded.header.kid);
      const payload = jwt.verify(token, key.pem, { algorithms: [key.alg || 'RS256'] });

      if (payload.tokenType === 'user') {
        await this.ensureActiveSession(token, payload);
      }

      return { payload, header: decoded.header, source: 'jwt' };
    } catch (error) {
      this.logger?.warn?.('JWT verification failed, attempting introspection', {
        error: error.message
      });

      const introspection = await this.fetchIntrospection(token);

      if (!introspection.active) {
        throw new AuthorizationError('Token inactive', { reason: introspection.reason });
      }

      const payload = this.mapIntrospection(introspection);
      return { payload, header: decoded.header, source: 'introspection' };
    }
  }

  async ensureActiveSession(token, payload) {
    const cached = this.sessionCache.get(token);
    if (cached && cached > Date.now()) {
      return;
    }

    try {
      const introspection = await this.fetchIntrospection(token);

      if (!introspection.active) {
        throw new AuthorizationError('Session inactive', { reason: introspection.reason });
      }

      const ttl = this.calculateCacheTtl(introspection.exp);
      this.sessionCache.set(token, Date.now() + ttl);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw error;
      }

      if (error instanceof RecoverableIntrospectionError) {
        this.logger?.warn?.('Introspection degraded, trusting JWT signature', {
          reason: error.message
        });
        this.sessionCache.set(token, Date.now() + 15000);
        return;
      }

      throw error;
    }
  }

  async fetchIntrospection(token) {
    try {
      return await this.introspectionClient.introspect(token);
    } catch (error) {
      if (error instanceof RecoverableIntrospectionError) {
        throw error;
      }

      this.logger?.error?.('Introspection request failed', { error: error.message });
      throw error;
    }
  }

  mapIntrospection(introspection) {
    if (introspection.tokenType === 'service') {
      return {
        tokenType: 'service',
        serviceName: introspection.serviceName,
        scopes: introspection.scopes || []
      };
    }

    if (introspection.tokenType === 'user') {
      return {
        tokenType: 'user',
        userId: introspection.userId,
        email: introspection.email,
        role: introspection.role,
        scopes: introspection.scopes || []
      };
    }

    throw new AuthorizationError('Unsupported token type', { reason: 'unsupported' });
  }

  invalidateSession(token) {
    this.sessionCache.delete(token);
  }

  calculateCacheTtl(expirySeconds) {
    if (!expirySeconds) {
      return this.sessionCacheTtlMs;
    }

    const millisToExpiry = expirySeconds * 1000 - Date.now();
    return Math.max(5000, Math.min(this.sessionCacheTtlMs, millisToExpiry));
  }
}

module.exports = TokenValidator;
