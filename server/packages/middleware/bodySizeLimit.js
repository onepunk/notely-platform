/**
 * Body Size Limit Middleware
 *
 * Provides configurable request body size limits to prevent DoS attacks.
 * Fetches configuration from admin-config service on initialization.
 *
 * Features:
 * - Centralized configuration via admin-config service
 * - Per-service limits for fine-grained control
 * - Graceful fallback to defaults if admin-config unavailable
 * - Dynamic middleware that uses current configuration
 *
 * @module middleware/bodySizeLimit
 */

const express = require('express');
const logger = require('../logger');

// Service name to config key mapping
const SERVICE_CONFIG_MAP = {
  'auth': 'auth',
  'users': 'users',
  'calendar': 'calendar',
  'support': 'support',
  'admin-config': 'adminConfig',
  'docker-manager': 'dockerManager',
  'sync': 'sync',
  'license': 'license',
  'portal-bff': 'portalBff',
  'admin-database': 'adminDatabase',
  'observability': 'observability',
  'gateway': 'gateway',
  'email': 'email'
};

// Default limits per service (in KB)
const DEFAULT_LIMITS = {
  gateway: 1024,       // 1MB - global gateway limit
  auth: 100,           // 100KB - auth payloads are small
  users: 512,          // 512KB - user profiles, preferences
  calendar: 256,       // 256KB - calendar events
  support: 512,        // 512KB - support tickets, messages
  adminConfig: 256,    // 256KB - configuration payloads
  dockerManager: 100,  // 100KB - container management commands
  sync: 5120,          // 5MB - document sync requires larger payloads
  license: 5120,       // 5MB - batch license operations
  portalBff: 5120,     // 5MB - aggregated portal requests
  adminDatabase: 1024, // 1MB - database operations
  observability: 1024, // 1MB - log ingestion
  email: 1024          // 1MB - email templates can be large HTML
};

// Store for current configuration
let currentConfig = null;
let configLoaded = false;

/**
 * Convert KB to express.json limit format string
 * @param {number} kb - Size in kilobytes
 * @returns {string} Express limit string (e.g., '1mb', '512kb')
 */
function kbToExpressLimit(kb) {
  if (kb >= 1024) {
    return `${Math.floor(kb / 1024)}mb`;
  }
  return `${kb}kb`;
}

/**
 * Get the limit for a specific service
 * @param {string} serviceName - Name of the service
 * @returns {string} Express limit string
 */
function getServiceLimit(serviceName) {
  const configKey = SERVICE_CONFIG_MAP[serviceName] || serviceName;

  // Check if we have loaded config and the service limit is defined
  if (currentConfig?.services?.[configKey]?.enabled !== false) {
    const limitKb = currentConfig?.services?.[configKey]?.limitKb;
    if (limitKb && limitKb > 0) {
      return kbToExpressLimit(limitKb);
    }
  }

  // Fall back to default
  const defaultKb = DEFAULT_LIMITS[configKey] || DEFAULT_LIMITS.gateway;
  return kbToExpressLimit(defaultKb);
}

/**
 * Get the gateway limit
 * @returns {string} Express limit string
 */
function getGatewayLimit() {
  if (currentConfig?.gateway?.enabled !== false) {
    const limitKb = currentConfig?.gateway?.limitKb;
    if (limitKb && limitKb > 0) {
      return kbToExpressLimit(limitKb);
    }
  }

  return kbToExpressLimit(DEFAULT_LIMITS.gateway);
}

/**
 * Fetch body size limit configuration from admin-config service
 *
 * @param {string} adminConfigUrl - URL of the admin-config service
 * @returns {Promise<Object|null>} Configuration or null if fetch failed
 */
async function fetchConfigFromService(adminConfigUrl) {
  if (!adminConfigUrl) {
    logger.debug('No admin-config URL provided for body size limits, using defaults');
    return null;
  }

  try {
    const url = `${adminConfigUrl}/api/admin/config/body-size-limit`;
    logger.info('Fetching body size limit config from admin-config service', { url });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service': 'body-size-limit'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('Failed to fetch body size limit config from admin-config', {
        status: response.status,
        statusText: response.statusText
      });
      return null;
    }

    const data = await response.json();

    if (data && data.config) {
      logger.info('Successfully loaded body size limit config from admin-config service', {
        gatewayLimit: data.config.gateway?.limitKb,
        gatewayEnabled: data.config.gateway?.enabled
      });
      return data.config;
    }

    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.warn('Timeout fetching body size limit config from admin-config service');
    } else {
      logger.warn('Error fetching body size limit config from admin-config service', {
        error: error.message
      });
    }
    return null;
  }
}

/**
 * Initialize body size limit configuration
 *
 * @param {Object} options - Initialization options
 * @param {string} options.adminConfigUrl - URL of admin-config service
 * @param {string} options.serviceName - Name of the current service
 * @returns {Promise<string>} The configured limit for this service
 */
async function initialize(options = {}) {
  const { adminConfigUrl, serviceName } = options;

  // Try to fetch config from admin-config service
  if (adminConfigUrl && !configLoaded) {
    const fetchedConfig = await fetchConfigFromService(adminConfigUrl);
    if (fetchedConfig) {
      currentConfig = fetchedConfig;
      configLoaded = true;
    }
  }

  const limit = serviceName === 'gateway' ? getGatewayLimit() : getServiceLimit(serviceName);

  logger.info('Body size limit initialized', {
    serviceName,
    limit,
    fromAdminConfig: configLoaded
  });

  return limit;
}

/**
 * Create body size limit middleware for a service
 *
 * This creates an Express middleware that applies the configured body size limit.
 * Call initialize() first to load configuration from admin-config.
 *
 * @param {string} serviceName - Name of the service
 * @returns {Function} Express middleware function
 */
function createMiddleware(serviceName) {
  const configKey = SERVICE_CONFIG_MAP[serviceName] || serviceName;
  const defaultKb = DEFAULT_LIMITS[configKey] || DEFAULT_LIMITS.gateway;
  const defaultLimit = kbToExpressLimit(defaultKb);

  // Return middleware that uses current config or default
  return (req, res, next) => {
    const limit = getServiceLimit(serviceName);
    express.json({ limit })(req, res, next);
  };
}

/**
 * Create body size limit middleware for the gateway
 *
 * @returns {Function} Express middleware function
 */
function createGatewayMiddleware() {
  return (req, res, next) => {
    const limit = getGatewayLimit();
    express.json({ limit })(req, res, next);
  };
}

/**
 * Get the current configuration (for debugging/logging)
 * @returns {Object|null} Current configuration or null
 */
function getConfig() {
  return currentConfig;
}

/**
 * Check if configuration has been loaded from admin-config
 * @returns {boolean} True if config was loaded from admin-config
 */
function isConfigLoaded() {
  return configLoaded;
}

module.exports = {
  initialize,
  createMiddleware,
  createGatewayMiddleware,
  getServiceLimit,
  getGatewayLimit,
  getConfig,
  isConfigLoaded,
  DEFAULT_LIMITS,
  SERVICE_CONFIG_MAP
};
