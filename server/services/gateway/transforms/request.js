const SCOPE_HEADER = 'X-Platform-Scopes';
const SERVICE_HEADER = 'X-Gateway-Service';
const REQUEST_ID_HEADER = 'X-Request-ID';

function extractScopes(req) {
  const scopes = new Set();
  if (req?.auth && Array.isArray(req.auth.scopes)) {
    req.auth.scopes.forEach((scope) => scopes.add(scope));
  }

  if (req?.auth?.tokenType === 'service' && Array.isArray(req.auth.serviceScopes)) {
    req.auth.serviceScopes.forEach((scope) => scopes.add(scope));
  }

  return Array.from(scopes);
}

function buildPlatformContext(req, serviceName) {
  return {
    requestId: req.requestId,
    service: serviceName,
    authType: req.auth?.tokenType || 'anonymous',
    subject: req.auth?.userId || req.auth?.serviceName || null,
    scopes: extractScopes(req)
  };
}

function applyRequestTransforms({ proxyReq, req, serviceName, config = {} }) {
  if (!config.enrichContext) {
    return;
  }

  const context = buildPlatformContext(req, serviceName);
  req.platformContext = context;

  if (context.requestId) {
    proxyReq.setHeader(REQUEST_ID_HEADER, context.requestId);
  }

  proxyReq.setHeader(SERVICE_HEADER, context.service);

  if (context.scopes.length > 0) {
    proxyReq.setHeader(SCOPE_HEADER, context.scopes.join(','));
  } else {
    proxyReq.removeHeader(SCOPE_HEADER);
  }
}

module.exports = {
  applyRequestTransforms,
  buildPlatformContext,
  extractScopes
};
