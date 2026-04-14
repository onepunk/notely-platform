"use strict";

module.exports = {
  cache: require('./cache/redis'),
  database: require('./database/pool'),
  errors: require('./errors/handler'),
  httpClient: require('./http-client'),
  logger: require('./logger'),
  authClient: require('./auth-client'),
  messaging: require('./messaging'),
  middleware: {
    rateLimiter: require('./middleware/rateLimiter'),
    bodySizeLimit: require('./middleware/bodySizeLimit'),
    requestId: require('./middleware/requestId'),
    requestLogging: require('./middleware/requestLogging'),
    security: require('./middleware/security')
  },
  utils: require('./utils'),
  constants: require('./constants')
};
