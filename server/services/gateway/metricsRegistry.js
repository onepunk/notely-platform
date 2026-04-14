class MetricsRegistry {
  constructor() {
    this.services = new Map();
  }

  registerService(name, { path = '/metrics', port, enabled = false } = {}) {
    if (!port) {
      throw new Error(`metrics registry requires a port for service "${name}"`);
    }
    this.services.set(name, { path, port, enabled: Boolean(enabled) });
  }

  enable(name) {
    if (!this.services.has(name)) {
      throw new Error(`Unknown service "${name}". Define it in metricsRegistry before enabling.`);
    }

    const current = this.services.get(name);
    this.services.set(name, { ...current, enabled: true });
  }

  disable(name) {
    if (!this.services.has(name)) {
      throw new Error(`Unknown service "${name}". Define it in metricsRegistry before disabling.`);
    }
    const current = this.services.get(name);
    this.services.set(name, { ...current, enabled: false });
  }

  list() {
    return Array.from(this.services.entries()).map(([name, config]) => ({
      name,
      path: config.path,
      port: config.port,
      enabled: config.enabled
    }));
  }
}

const registry = new MetricsRegistry();

registry.registerService('gateway', { port: 3200, enabled: true });
registry.registerService('auth', { port: 3201, enabled: true });
registry.registerService('users', { port: 3202, enabled: false });
registry.registerService('calendar', { port: 3203, enabled: false });
registry.registerService('meetings', { port: 3204, enabled: false });
registry.registerService('transcripts', { port: 3205, enabled: false });
registry.registerService('notes', { port: 3206, enabled: false });
registry.registerService('summaries', { port: 3207, enabled: true });
registry.registerService('admin', { port: 3208, enabled: false });
registry.registerService('actions', { port: 3209, enabled: false });

module.exports = registry;
