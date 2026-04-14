const shared = require('@notely/shared');

const {
  DEFAULT_GENERAL_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_AI_CONFIG,
  DEFAULT_TEAMS_CONFIG,
  DEFAULT_SYNC_CONFIG,
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_BACKUP_CONFIG,
  DEFAULT_NOTIFICATIONS_CONFIG,
  DEFAULT_RECORDING_QUOTAS_CONFIG,
  DEFAULT_BODY_SIZE_LIMIT_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG
} = require('../config/configDefaults');
const {
  sanitizeGeneralConfig,
  sanitizeSecurityConfig,
  sanitizeAiConfig,
  sanitizeTeamsConfig,
  sanitizeSyncConfig,
  applySyncUpdates,
  sanitizeLoggingConfig,
  sanitizeBackupConfig,
  sanitizeNotificationsConfig,
  sanitizeRecordingQuotasConfig,
  sanitizeBodySizeLimitConfig,
  sanitizeRateLimitConfig
} = require('../config/configSanitizers');

const db = shared.database;
const logger = shared.logger.child({ module: 'admin-config-model' });

const CONFIG_DEFINITIONS = {
  general: {
    key: 'general_config',
    defaults: DEFAULT_GENERAL_CONFIG,
    description: 'General system configuration including session timeouts and signup settings',
    sanitize: sanitizeGeneralConfig
  },
  security: {
    key: 'security_config',
    defaults: DEFAULT_SECURITY_CONFIG,
    description: 'Security configuration including SSL/TLS, authentication, and rate limiting settings',
    sanitize: sanitizeSecurityConfig
  },
  ai: {
    key: 'ai_config',
    defaults: DEFAULT_AI_CONFIG,
    description: 'AI services configuration including Whisper and LLM settings',
    sanitize: sanitizeAiConfig
  },
  teams: {
    key: 'teams_config',
    defaults: DEFAULT_TEAMS_CONFIG,
    description: 'Microsoft Teams integration configuration',
    sanitize: sanitizeTeamsConfig
  },
  sync: {
    key: 'sync_config',
    defaults: DEFAULT_SYNC_CONFIG,
    description: 'Sync service configuration values and rate limits',
    sanitize: sanitizeSyncConfig
  },
  logging: {
    key: 'logging_config',
    defaults: DEFAULT_LOGGING_CONFIG,
    description: 'Logging retention and scheduler configuration',
    sanitize: sanitizeLoggingConfig
  },
  backup: {
    key: 'backup_config',
    defaults: DEFAULT_BACKUP_CONFIG,
    description: 'Backup and disaster recovery configuration defaults',
    sanitize: sanitizeBackupConfig
  },
  notifications: {
    key: 'notifications_config',
    defaults: DEFAULT_NOTIFICATIONS_CONFIG,
    description: 'Notification configuration including registration alerts',
    sanitize: sanitizeNotificationsConfig
  },
  recording_quotas: {
    key: 'recording_quotas_config',
    defaults: DEFAULT_RECORDING_QUOTAS_CONFIG,
    description: 'Recording upload quotas per tier, retention settings, and cleanup scheduler configuration',
    sanitize: sanitizeRecordingQuotasConfig
  },
  body_size_limit: {
    key: 'body_size_limit_config',
    defaults: DEFAULT_BODY_SIZE_LIMIT_CONFIG,
    description: 'Request body size limits for gateway and individual services to prevent DoS attacks',
    sanitize: sanitizeBodySizeLimitConfig
  },
  rate_limit: {
    key: 'rate_limit_config',
    defaults: DEFAULT_RATE_LIMIT_CONFIG,
    description: 'API rate limiting configuration for gateway and auth service endpoints',
    sanitize: sanitizeRateLimitConfig
  }
};

function parseValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (typeof rawValue === 'object') {
    return rawValue;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    logger.warn('Failed to parse JSON value from system_settings', {
      error: error.message
    });
    return null;
  }
}

function toJsonb(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

class ConfigModel {
  async getByKey(key) {
    const result = await db.query(
      `SELECT id, key, value, description, created_at, updated_at
       FROM admin_settings.system_settings
       WHERE key = $1`,
      [key]
    );

    return result.rows[0] || null;
  }

  async upsert(key, value, description = null) {
    const jsonValue = toJsonb(value);

    const result = await db.query(
      `INSERT INTO admin_settings.system_settings (key, value, description)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key)
       DO UPDATE SET
         value = EXCLUDED.value,
         description = COALESCE(EXCLUDED.description, admin_settings.system_settings.description),
         updated_at = NOW()
       RETURNING id, key, value, description, created_at, updated_at`,
      [key, jsonValue, description]
    );

    return result.rows[0];
  }

  async ensureConfig(namespace) {
    const definition = CONFIG_DEFINITIONS[namespace];

    if (!definition) {
      throw new Error(`Unknown configuration namespace: ${namespace}`);
    }

    const existing = await this.getByKey(definition.key);
    if (!existing) {
      await this.upsert(definition.key, definition.defaults, definition.description);
      return definition.defaults;
    }

    const parsed = parseValue(existing.value);
    return definition.sanitize(parsed || definition.defaults, definition.defaults);
  }

  async getConfig(namespace) {
    const definition = CONFIG_DEFINITIONS[namespace];

    if (!definition) {
      throw new Error(`Unknown configuration namespace: ${namespace}`);
    }

    const existing = await this.getByKey(definition.key);
    if (!existing) {
      await this.upsert(definition.key, definition.defaults, definition.description);
      return definition.defaults;
    }

    const parsed = parseValue(existing.value);
    return definition.sanitize(parsed || definition.defaults, definition.defaults);
  }

  async updateConfig(namespace, payload) {
    const definition = CONFIG_DEFINITIONS[namespace];

    if (!definition) {
      throw new Error(`Unknown configuration namespace: ${namespace}`);
    }

    const current = await this.getConfig(namespace);
    const sanitized = definition.sanitize(payload || {}, current);

    const updated = await this.upsert(definition.key, sanitized, definition.description);
    return parseValue(updated.value) || sanitized;
  }

  async getGeneralConfig() {
    return this.getConfig('general');
  }

  async updateGeneralConfig(payload) {
    return this.updateConfig('general', payload);
  }

  async getSecurityConfig() {
    return this.getConfig('security');
  }

  async updateSecurityConfig(payload) {
    return this.updateConfig('security', payload);
  }

  async getAiConfig() {
    return this.getConfig('ai');
  }

  async updateAiConfig(payload) {
    return this.updateConfig('ai', payload);
  }

  async getTeamsConfig() {
    return this.getConfig('teams');
  }

  async updateTeamsConfig(payload) {
    return this.updateConfig('teams', payload);
  }

  async getSyncConfig() {
    return this.getConfig('sync');
  }

  async replaceSyncConfig(payload) {
    const sanitized = sanitizeSyncConfig(payload, await this.getSyncConfig());
    const updated = await this.upsert(
      CONFIG_DEFINITIONS.sync.key,
      sanitized,
      CONFIG_DEFINITIONS.sync.description
    );
    return parseValue(updated.value) || sanitized;
  }

  async bulkUpdateSyncConfig(updates = []) {
    const current = await this.getSyncConfig();
    const results = applySyncUpdates(updates, current);

    const updated = await this.upsert(
      CONFIG_DEFINITIONS.sync.key,
      results.items,
      CONFIG_DEFINITIONS.sync.description
    );

    results.items = parseValue(updated.value) || results.items;
    return results;
  }

  async getLoggingConfig() {
    return this.getConfig('logging');
  }

  async updateLoggingConfig(payload) {
    return this.updateConfig('logging', payload);
  }

  async getBackupConfig() {
    return this.getConfig('backup');
  }

  async updateBackupConfig(payload) {
    return this.updateConfig('backup', payload);
  }

  async getNotificationsConfig() {
    return this.getConfig('notifications');
  }

  async updateNotificationsConfig(payload) {
    return this.updateConfig('notifications', payload);
  }

  async getRecordingQuotasConfig() {
    return this.getConfig('recording_quotas');
  }

  async updateRecordingQuotasConfig(payload) {
    const updated = await this.updateConfig('recording_quotas', payload);

    // Sync tier metadata with the updated quotas
    await this.syncTierRecordingQuotas(updated);

    return updated;
  }

  async getBodySizeLimitConfig() {
    return this.getConfig('body_size_limit');
  }

  async updateBodySizeLimitConfig(payload) {
    return this.updateConfig('body_size_limit', payload);
  }

  async getRateLimitConfig() {
    return this.getConfig('rate_limit');
  }

  async updateRateLimitConfig(payload) {
    return this.updateConfig('rate_limit', payload);
  }

  /**
   * Syncs recording quota settings to the licensing.tiers metadata.
   * This ensures the database tier metadata matches the admin config.
   */
  async syncTierRecordingQuotas(config) {
    const tiers = ['free', 'professional', 'enterprise'];

    for (const tier of tiers) {
      const quotaConfig = config.quotas[tier];
      if (!quotaConfig) continue;

      const maxFileSizeBytes = quotaConfig.maxFileSizeMB * 1024 * 1024;

      try {
        await db.query(`
          UPDATE licensing.tiers
          SET
            metadata = metadata || $1::jsonb,
            updated_at = NOW()
          WHERE tier_key = $2
        `, [
          JSON.stringify({
            max_recording_file_size_bytes: maxFileSizeBytes,
            recording_retention_days: quotaConfig.retentionDays,
            recordings_enabled: quotaConfig.enabled
          }),
          tier
        ]);

        logger.info('Synced recording quotas to tier metadata', {
          tier,
          maxFileSizeBytes,
          retentionDays: quotaConfig.retentionDays,
          enabled: quotaConfig.enabled
        });
      } catch (error) {
        logger.error('Failed to sync recording quotas to tier', {
          tier,
          error: error.message
        });
        // Don't throw - we've already saved the admin config
      }
    }
  }

  async ensureDefaultConfigs() {
    const namespaces = Object.keys(CONFIG_DEFINITIONS);
    for (const namespace of namespaces) {
      try {
        await this.ensureConfig(namespace);
      } catch (error) {
        logger.error('Failed to ensure default configuration', {
          namespace,
          error: error.message
        });
        throw error;
      }
    }
  }

  /**
   * Count admin users who have OAuth credentials (Microsoft login).
   * Used to safeguard disabling local login - there must be at least one
   * OAuth admin user before local login can be disabled.
   */
  async countOAuthAdminUsers() {
    try {
      // Query to count admin users who have linked Microsoft OAuth credentials
      const result = await db.query(`
        SELECT COUNT(DISTINCT uc.id) as count
        FROM global_auth.user_credentials uc
        INNER JOIN global_auth.oauth_tokens ot ON uc.id = ot.user_id
        WHERE uc.role = 'admin'
          AND uc.is_active = TRUE
          AND ot.provider = 'microsoft'
      `);

      const count = parseInt(result.rows[0]?.count || '0', 10);
      logger.info('Counted OAuth admin users', { count });
      return count;
    } catch (error) {
      logger.error('Failed to count OAuth admin users', { error: error.message });
      // On error, return 0 to be safe (prevents disabling local login)
      return 0;
    }
  }
}

module.exports = new ConfigModel();
