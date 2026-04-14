const { RecoverableIntrospectionError } = require('./errors');
const metrics = require('../metrics');

class IntrospectionClient {
  constructor({ authBaseUrl, serviceTokenClient, logger }) {
    this.authBaseUrl = authBaseUrl.replace(/\/$/, '');
    this.serviceTokenClient = serviceTokenClient;
    this.logger = logger;
  }

  async introspect(token) {
    const serviceToken = await this.serviceTokenClient.getToken();

    const endTimer = (() => {
      const stop = metrics.introspectionDuration.startTimer();
      let ended = false;
      return (labels) => {
        if (!ended) {
          stop(labels);
          ended = true;
        }
      };
    })();

    try {
      const response = await fetch(`${this.authBaseUrl}/internal/tokens/introspect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceToken}`
        },
        body: JSON.stringify({ token })
      });

      if (response.status === 401) {
        this.serviceTokenClient.invalidate();
        endTimer({ outcome: 'error' });
        throw new RecoverableIntrospectionError('Service token rejected, will retry', { status: 401 });
      }

      if (!response.ok) {
        endTimer({ outcome: 'error' });
        throw new Error(`Introspection endpoint error: ${response.status}`);
      }

      const body = await response.json();
      endTimer({ outcome: 'success' });
      return body;
    } catch (error) {
      endTimer({ outcome: 'error' });
      if (error instanceof RecoverableIntrospectionError) {
        throw error;
      }

      if (error.name === 'FetchError') {
        throw new RecoverableIntrospectionError('Introspection request failed', { error: error.message });
      }

      throw error;
    }
  }
}

module.exports = IntrospectionClient;
