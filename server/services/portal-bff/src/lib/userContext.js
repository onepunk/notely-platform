const shared = require('@notely/shared');

const logger = shared.logger.child({ scope: 'portal-bff-user-context' });

const ORG_HEADERS = [
  'x-auth-organization-id',
  'x-auth-org-id',
  'x-organization-id',
  'x-org-id'
];

function getUserContext(req) {
  const headers = req.headers || {};
  const userId = headers['x-auth-subject'] || headers['x-user-id'];
  const email = headers['x-auth-email'];
  const role = headers['x-auth-role'];

  if (!userId) {
    logger.warn('Missing authentication context for request', {
      path: req.path,
      method: req.method
    });
    const error = new Error('Authentication context missing');
    error.status = 401;
    error.code = 'missing_auth_context';
    throw error;
  }

  const organizationHeader = ORG_HEADERS.find((key) => headers[key]);
  const organizationId = organizationHeader ? headers[organizationHeader] : undefined;

  return {
    userId,
    email,
    role,
    organizationId
  };
}

module.exports = {
  getUserContext
};
