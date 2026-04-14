"use strict";

const shared = require('@notely/shared');

const logger = shared.logger.child({ module: 'logs-authenticate' });
const { UnauthorizedError, ForbiddenError } = shared.errors;

const ALLOWED_ROLES = new Set(['admin', 'super_admin']);

function parseScopes(headerValue) {
  if (!headerValue) {
    return [];
  }

  return String(headerValue)
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

module.exports = function authenticate(req, res, next) {
  const authType = req.headers['x-auth-type'];
  const authSubject = req.headers['x-auth-subject'];
  const authEmail = req.headers['x-auth-email'];
  const authRole = req.headers['x-auth-role'];
  const scopeHeader = req.headers['x-auth-scopes'];

  if (!authType || authType !== 'user') {
    logger.warn('Request missing valid auth type header', { path: req.originalUrl });
    return next(new UnauthorizedError('Authentication required'));
  }

  if (!authRole || !ALLOWED_ROLES.has(authRole)) {
    logger.warn('Request from disallowed role', { role: authRole, path: req.originalUrl });
    return next(new ForbiddenError('Insufficient permissions'));
  }

  req.user = {
    id: authSubject || null,
    email: authEmail || null,
    role: authRole,
    scopes: parseScopes(scopeHeader)
  };

  return next();
};
