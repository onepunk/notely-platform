const { EventEmitter } = require('events');

const STATES = {
  CLOSED: 'closed',
  HALF_OPEN: 'half_open',
  OPEN: 'open'
};

class CircuitBreaker {
  constructor({
    name,
    route,
    logger,
    failureThreshold = 5,
    successThreshold = 2,
    cooldownPeriodMs = 15000,
    fallbackStatus = 503,
    fallbackBody = { error: 'service_unavailable', message: 'Upstream service temporarily unavailable.' }
  }) {
    if (!name) {
      throw new Error('CircuitBreaker requires a name');
    }

    this.name = name;
    this.route = route || name;
    this.logger = logger;
    this.failureThreshold = failureThreshold;
    this.successThreshold = successThreshold;
    this.cooldownPeriodMs = cooldownPeriodMs;
    this.fallbackStatus = fallbackStatus;
    this.fallbackBody = fallbackBody;

    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = 0;
    this.lastFailureAt = null;
    this.lastFailureReason = null;
    this.halfOpenProbeInFlight = false;

    this.events = new EventEmitter();
  }

  on(event, handler) {
    this.events.on(event, handler);
  }

  canRequest() {
    const now = Date.now();

    if (this.state === STATES.OPEN) {
      if (now >= this.nextAttemptAt) {
        this.transitionTo(STATES.HALF_OPEN);
        this.halfOpenProbeInFlight = false;
        this.successCount = 0;
        this.failureCount = 0;
      } else {
        return false;
      }
    }

    if (this.state === STATES.HALF_OPEN) {
      if (this.halfOpenProbeInFlight) {
        return false;
      }
      this.halfOpenProbeInFlight = true;
    }

    return true;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.lastFailureReason = null;

    if (this.state === STATES.HALF_OPEN) {
      this.successCount += 1;
      this.halfOpenProbeInFlight = false;

      if (this.successCount >= this.successThreshold) {
        this.close();
      }
    } else {
      this.successCount = 0;
    }

    this.events.emit('success', { route: this.route, timestamp: new Date().toISOString() });
  }

  recordFailure(reason = 'upstream_error', statusCode) {
    this.failureCount += 1;
    this.lastFailureAt = Date.now();
    this.lastFailureReason = reason;
    this.halfOpenProbeInFlight = false;
    this.successCount = 0;

    this.events.emit('failure', {
      route: this.route,
      reason,
      statusCode,
      state: this.state,
      timestamp: new Date(this.lastFailureAt).toISOString()
    });

    if (this.state === STATES.HALF_OPEN) {
      this.open();
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.open();
    }
  }

  getState() {
    return this.state;
  }

  getFallbackPayload() {
    const retryAfterMs = Math.max(0, this.nextAttemptAt - Date.now());
    return {
      status: this.fallbackStatus,
      body: {
        ...this.fallbackBody,
        // Only expose minimal circuit breaker info to clients
        // Sensitive details (lastFailureReason, internal state) are logged server-side only
        circuitBreaker: {
          state: this.state,
          retryAfterMs
        }
      }
    };
  }

  recordFallbackServed() {
    this.events.emit('fallback', {
      breaker: this.name,
      route: this.route,
      state: this.state,
      timestamp: new Date().toISOString()
    });
  }

  open() {
    if (this.state === STATES.OPEN) {
      return;
    }

    this.nextAttemptAt = Date.now() + this.cooldownPeriodMs;
    this.halfOpenProbeInFlight = false;
    this.transitionTo(STATES.OPEN);
  }

  close() {
    if (this.state === STATES.CLOSED) {
      return;
    }

    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenProbeInFlight = false;
    this.transitionTo(STATES.CLOSED);
  }

  transitionTo(newState) {
    const previousState = this.state;
    this.state = newState;

    if (this.logger) {
      this.logger.warn('Circuit breaker state change', {
        breaker: this.name,
        route: this.route,
        from: previousState,
        to: newState
      });
    }

    this.events.emit('stateChange', {
      breaker: this.name,
      route: this.route,
      from: previousState,
      to: newState,
      timestamp: new Date().toISOString()
    });
  }
}

CircuitBreaker.STATES = STATES;

module.exports = CircuitBreaker;
