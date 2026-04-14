const shared = require('@notely/shared');
const logger = shared.logger;
const authService = require('../services/authService');

function requireServiceAuth(requiredScopes = []) {
  const expectedScopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      if (!header.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing service authorization token'
        });
      }

      const token = header.slice('Bearer '.length);
      const verification = await authService.verifyServiceToken(token);

      if (!verification.valid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: verification.reason || 'Invalid service token'
        });
      }

      if (expectedScopes.length > 0) {
        const scopes = verification.scopes || [];
        const hasScope = scopes.includes('*') || expectedScopes.every(scope => scopes.includes(scope));

        if (!hasScope) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Missing required service scope'
          });
        }
      }

      req.serviceAuth = verification;
      return next();
    } catch (error) {
      logger.error('Service auth middleware error', { error: error.message });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Service authentication failed'
      });
    }
  };
}

module.exports = requireServiceAuth;
