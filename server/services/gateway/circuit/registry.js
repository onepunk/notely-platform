const CircuitBreaker = require('./breaker');

class CircuitBreakerRegistry {
  constructor({ logger, metrics }) {
    this.logger = logger;
    this.metrics = metrics;
    this.breakers = new Map();
  }

  get(route, config) {
    const key = route;

    if (this.breakers.has(key)) {
      return this.breakers.get(key);
    }

    const breaker = new CircuitBreaker({
      name: key,
      route: key,
      logger: this.logger,
      failureThreshold: config.failureThreshold,
      successThreshold: config.successThreshold,
      cooldownPeriodMs: config.cooldownPeriodMs,
      fallbackStatus: config.fallbackStatus,
      fallbackBody: config.fallbackBody
    });

    breaker.on('stateChange', ({ from, to, route: breakerRoute }) => {
      if (this.metrics?.recordCircuitTransition) {
        this.metrics.recordCircuitTransition(breakerRoute, from || 'unknown', to);
      }
    });

    breaker.on('failure', ({ route: breakerRoute, reason }) => {
      if (this.metrics?.recordCircuitFailure) {
        this.metrics.recordCircuitFailure(breakerRoute, reason || 'unknown');
      }
    });

    breaker.on('fallback', ({ route: breakerRoute }) => {
      if (this.metrics?.recordCircuitFallback) {
        this.metrics.recordCircuitFallback(breakerRoute);
      }
    });

    // Initialise the state gauge
    if (this.metrics?.recordCircuitTransition) {
      this.metrics.recordCircuitTransition(key, 'unknown', breaker.getState());
    }

    this.breakers.set(key, breaker);
    return breaker;
  }
}

module.exports = CircuitBreakerRegistry;
