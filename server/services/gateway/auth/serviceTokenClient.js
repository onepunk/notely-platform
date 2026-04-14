const { AuthorizationError } = require('./errors');

class ServiceTokenClient {
  constructor({ authBaseUrl, serviceName, apiKey, logger, defaultScopes = [] }) {
    if (!apiKey) {
      throw new Error('Gateway service API key is required');
    }

    this.authBaseUrl = authBaseUrl.replace(/\/$/, '');
    this.serviceName = serviceName;
    this.apiKey = apiKey;
    this.logger = logger;
    this.defaultScopes = defaultScopes;
    this.token = null;
    this.expiresAt = 0;
    this.refreshPromise = null;
    this.refreshBufferMs = 30000;
  }

  async getToken() {
    if (this.token && this.expiresAt - this.refreshBufferMs > Date.now()) {
      return this.token;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.requestNewToken()
        .catch((error) => {
          this.logger?.error?.('Failed to mint gateway service token', { error: error.message });
          throw error;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    await this.refreshPromise;
    return this.token;
  }

  invalidate() {
    this.token = null;
    this.expiresAt = 0;
  }

  async requestNewToken() {
    const response = await fetch(`${this.authBaseUrl}/internal/service-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': this.serviceName,
        'X-Service-Key': this.apiKey
      },
      body: JSON.stringify({ scopes: this.defaultScopes })
    });

    if (response.status === 401) {
      throw new AuthorizationError('Gateway service API key rejected');
    }

    if (!response.ok) {
      throw new Error(`Failed to obtain service token: ${response.status}`);
    }

    const body = await response.json();

    this.token = body.token;
    this.expiresAt = body.expiresAt ? Date.parse(body.expiresAt) : Date.now() + 300000;

    this.logger?.info?.('Obtained gateway service token', {
      expiresAt: new Date(this.expiresAt).toISOString(),
      scopes: body.scopes
    });
  }
}

module.exports = ServiceTokenClient;
