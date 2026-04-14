const { AuthorizationError } = require('./errors');
const metrics = require('../metrics');

function recordAuthFailure(status, reason) {
  metrics.authFailureCounter.inc({
    status: String(status || 401),
    reason: reason || 'unknown'
  });
}

function createAuthMiddleware({ tokenValidator, apiKeyVerifier, logger, anonymousRoutes = [] }) {
  const allowlist = anonymousRoutes.map((entry) => normalizeRule(entry));

  return async (req, res, next) => {
    try {
      // Debug logging
      const fullPath = `${req.baseUrl || ''}${req.path}`;
      logger.info(`Auth middleware processing: ${req.method} ${fullPath}`, {
        baseUrl: req.baseUrl,
        path: req.path,
        url: req.url,
        fullPath: fullPath
      });

      const inboundServiceName = req.headers['x-service-name'];

      delete req.headers['x-auth-subject'];
      delete req.headers['x-auth-email'];
      delete req.headers['x-auth-role'];
      delete req.headers['x-auth-scopes'];
      delete req.headers['x-service-scopes'];
      delete req.headers['x-api-key-name'];
      delete req.headers['x-api-key-scopes'];

      if (shouldBypass(req, allowlist)) {
        logger.info(`Request bypassed auth: ${req.method} ${fullPath}`);
        return next();
      }

      if (req.method === 'OPTIONS') {
        return next();
      }

      logger.info(`Auth check required for: ${req.method} ${fullPath}`);

      const apiKeyValue = req.headers['x-api-key'];
      if (apiKeyValue) {
        const verification = await apiKeyVerifier.verify(apiKeyValue);

        if (!verification || !verification.valid) {
          const failureReason = verification?.reason ? `api_key_${verification.reason}` : 'api_key';
          throw new AuthorizationError('Invalid API key', { reason: failureReason });
        }

        delete req.headers['x-api-key'];

        req.auth = {
          tokenType: 'api-key',
          keyName: verification.key?.name || verification.name,
          scopes: verification.key?.scopes || verification.scopes || []
        };
        return next();
      }

      const header = req.headers.authorization || '';
      let token;

      // Try Authorization header first (Bearer token)
      if (header.startsWith('Bearer ')) {
        token = header.slice('Bearer '.length);
      }
      // Fall back to cookies for OAuth/OIDC sessions
      else if (req.cookies && req.cookies.access_token) {
        token = req.cookies.access_token;
        logger.debug('Using token from cookie', { hasCookie: !!token });
      }
      // No authentication found
      else {
        throw new AuthorizationError('Missing Authorization header or cookie', { reason: 'missing_header' });
      }
      const verification = await tokenValidator.verify(token);
      const payload = verification.payload;

      if (payload.tokenType === 'service') {
        const headerServiceName = (inboundServiceName || '').toLowerCase();
        const tokenServiceName = String(payload.serviceName || '').toLowerCase();

        if (!headerServiceName) {
          throw new AuthorizationError('Missing X-Service-Name header', { reason: 'missing_service_name' });
        }

        if (headerServiceName !== tokenServiceName) {
          throw new AuthorizationError('Service identity mismatch', { reason: 'service_name_mismatch' });
        }

        delete req.headers['x-service-name'];

        req.auth = {
          tokenType: 'service',
          serviceName: payload.serviceName,
          scopes: payload.scopes || [],
          source: verification.source
        };
      } else if (payload.tokenType === 'user' || !payload.tokenType) {
        req.auth = {
          tokenType: 'user',
          userId: payload.userId || payload.sub,
          email: payload.email,
          role: payload.role,
          scopes: payload.scopes || [],
          source: verification.source
        };
      } else {
        throw new AuthorizationError('Unsupported token type', { reason: 'unsupported' });
      }

      return next();
    } catch (error) {
      if (!(error instanceof AuthorizationError)) {
        logger.error('Gateway authorization failure', {
          error: error.message,
          stack: error.stack
        });
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to authorize request'
        });
      }

      recordAuthFailure(error.status, error.reason);

      logger.warn('Authorization rejected', {
        event: 'auth_failure',
        reason: error.reason,
        status: error.status,
        path: req.originalUrl,
        method: req.method,
        requestId: req.requestId,
        clientIp: req.ip
      });
      // Return generic error to client - detailed info logged server-side above
      return res.status(error.status).json({
        error: 'Unauthorized'
      });
    }
  };
}

function shouldBypass(req, rules) {
  const path = `${req.baseUrl || ''}${req.path}`;

  return rules.some((rule) => {
    if (rule.method !== '*' && rule.method !== req.method) {
      return false;
    }

    return rule.matcher.test(path);
  });
}

function normalizeRule(rule) {
  if (rule instanceof RegExp) {
    return { method: '*', matcher: rule };
  }

  if (typeof rule === 'string') {
    return { method: '*', matcher: new RegExp(`^${rule}$`) };
  }

  return {
    method: rule.method || '*',
    matcher: rule.matcher instanceof RegExp ? rule.matcher : new RegExp(`^${rule.path}$`)
  };
}

module.exports = createAuthMiddleware;
