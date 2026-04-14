class AuthorizationError extends Error {
  constructor(message, { status = 401, reason } = {}) {
    super(message);
    this.name = 'AuthorizationError';
    this.status = status;
    this.reason = reason;
  }
}

class RecoverableIntrospectionError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'RecoverableIntrospectionError';
    this.recoverable = true;
    this.context = context;
  }
}

module.exports = {
  AuthorizationError,
  RecoverableIntrospectionError
};
