const { UnauthorizedError } = require('@notely/shared').errors;

function hydrateUserContext(req, res, next) {
  const subject = req.headers['x-auth-subject'];

  if (!subject) {
    return next(new UnauthorizedError('Missing authentication context'));
  }

  const scopes = (req.headers['x-auth-scopes'] || '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

  req.user = {
    id: subject,
    email: req.headers['x-auth-email'] || null,
    role: req.headers['x-auth-role'] || null,
    scopes
  };

  return next();
}

module.exports = hydrateUserContext;
