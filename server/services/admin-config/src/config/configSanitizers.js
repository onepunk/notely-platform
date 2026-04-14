const {
  DEFAULT_GENERAL_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_AI_CONFIG,
  DEFAULT_TEAMS_CONFIG,
  DEFAULT_SYNC_CONFIG,
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_BACKUP_CONFIG,
  DEFAULT_NOTIFICATIONS_CONFIG,
  DEFAULT_RECORDING_QUOTAS_CONFIG
} = require('./configDefaults');

const shared = require('@notely/shared');
const { ValidationError } = shared.errors;

function sanitizeGeneralConfig(rawInput = {}, existingConfig = DEFAULT_GENERAL_CONFIG) {
  const values = {
    ...DEFAULT_GENERAL_CONFIG,
    ...(existingConfig || {})
  };

  const keys = [
    { key: 'adminPortalTimeout', min: 1, max: 4320 },
    { key: 'inactiveSessionTimeout', min: 1, max: 4320 },
    { key: 'maxConcurrentSessions', min: 1, max: 10000 },
    { key: 'sessionCleanupInterval', min: 1, max: 1440 }
  ];

  keys.forEach(({ key, min, max }) => {
    if (Object.prototype.hasOwnProperty.call(rawInput, key)) {
      const numeric = Number(rawInput[key]);
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
        throw new ValidationError(`${key} must be between ${min} and ${max}`);
      }
      values[key] = Math.floor(numeric);
    }
  });

  if (Object.prototype.hasOwnProperty.call(rawInput, 'signupsEnabled')) {
    if (typeof rawInput.signupsEnabled !== 'boolean') {
      throw new ValidationError('signupsEnabled must be a boolean');
    }
    values.signupsEnabled = rawInput.signupsEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'requireBetaToken')) {
    if (typeof rawInput.requireBetaToken !== 'boolean') {
      throw new ValidationError('requireBetaToken must be a boolean');
    }
    values.requireBetaToken = rawInput.requireBetaToken;
  }

  return values;
}

function sanitizeSecurityConfig(rawInput = {}, existingConfig = DEFAULT_SECURITY_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid security configuration payload');
  }

  const result = {
    ...DEFAULT_SECURITY_CONFIG,
    ...(existingConfig || {}),
    passwordComplexity: {
      ...DEFAULT_SECURITY_CONFIG.passwordComplexity,
      ...(existingConfig?.passwordComplexity || {})
    }
  };

  const booleanFields = ['sslEnabled', 'httpsRedirect', 'twoFactorAuth', 'localLoginEnabled'];
  booleanFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(rawInput, field)) {
      if (typeof rawInput[field] !== 'boolean') {
        throw new ValidationError(`${field} must be a boolean`);
      }
      result[field] = rawInput[field];
    }
  });

  if (Object.prototype.hasOwnProperty.call(rawInput, 'sessionTimeout')) {
    const numeric = Number(rawInput.sessionTimeout);
    if (!Number.isFinite(numeric) || numeric < 5 || numeric > 1440) {
      throw new ValidationError('sessionTimeout must be between 5 and 1440 minutes');
    }
    result.sessionTimeout = Math.floor(numeric);
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'maxLoginAttempts')) {
    const numeric = Number(rawInput.maxLoginAttempts);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 20) {
      throw new ValidationError('maxLoginAttempts must be between 1 and 20');
    }
    result.maxLoginAttempts = Math.floor(numeric);
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'apiRateLimit')) {
    const numeric = Number(rawInput.apiRateLimit);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 100000) {
      throw new ValidationError('apiRateLimit must be between 1 and 100000');
    }
    result.apiRateLimit = Math.floor(numeric);
  }

  const complexityInput =
    rawInput.passwordComplexity ||
    rawInput.password_complexity ||
    rawInput.passwordComplexitySettings;

  if (complexityInput !== undefined) {
    if (complexityInput === null || typeof complexityInput !== 'object' || Array.isArray(complexityInput)) {
      throw new ValidationError('passwordComplexity must be an object');
    }

    const merged = { ...result.passwordComplexity };

    if (Object.prototype.hasOwnProperty.call(complexityInput, 'minLength')) {
      const minLength = Number(complexityInput.minLength);
      if (!Number.isFinite(minLength) || minLength < 6 || minLength > 128) {
        throw new ValidationError('passwordComplexity.minLength must be between 6 and 128');
      }
      merged.minLength = Math.floor(minLength);
    }

    ['requireUppercase', 'requireLowercase', 'requireNumbers', 'requireSpecialChars'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(complexityInput, field)) {
        if (typeof complexityInput[field] !== 'boolean') {
          throw new ValidationError(`passwordComplexity.${field} must be a boolean`);
        }
        merged[field] = complexityInput[field];
      }
    });

    result.passwordComplexity = merged;
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'ipWhitelist')) {
    if (!Array.isArray(rawInput.ipWhitelist)) {
      throw new ValidationError('ipWhitelist must be an array');
    }

    const sanitized = rawInput.ipWhitelist
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    result.ipWhitelist = Array.from(new Set(sanitized));
  }

  if (!result.sslEnabled) {
    result.httpsRedirect = false;
  }

  return result;
}

function isValidEmail(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(trimmed);
}

function sanitizeNotificationsConfig(rawInput = {}, existingConfig = DEFAULT_NOTIFICATIONS_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid notifications configuration payload');
  }

  const result = {
    registration: {
      ...DEFAULT_NOTIFICATIONS_CONFIG.registration,
      ...(existingConfig?.registration || {})
    }
  };

  const registrationInput =
    rawInput.registration ||
    rawInput.registrationNotifications ||
    rawInput.registration_notification ||
    rawInput.registrationNotification;

  if (registrationInput !== undefined) {
    if (registrationInput === null || typeof registrationInput !== 'object' || Array.isArray(registrationInput)) {
      throw new ValidationError('registration notifications must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(registrationInput, 'enabled')) {
      if (typeof registrationInput.enabled !== 'boolean') {
        throw new ValidationError('registration.enabled must be a boolean');
      }
      result.registration.enabled = registrationInput.enabled;
    }

    if (Object.prototype.hasOwnProperty.call(registrationInput, 'recipientEmail')) {
      const email = (registrationInput.recipientEmail || '').trim();
      if (email && !isValidEmail(email)) {
        throw new ValidationError('registration.recipientEmail must be a valid email address');
      }
      result.registration.recipientEmail = email;
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'registrationRecipientEmail')) {
    const email = (rawInput.registrationRecipientEmail || '').trim();
    if (email && !isValidEmail(email)) {
      throw new ValidationError('registrationRecipientEmail must be a valid email address');
    }
    result.registration.recipientEmail = email;
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'registrationNotificationsEnabled')) {
    if (typeof rawInput.registrationNotificationsEnabled !== 'boolean') {
      throw new ValidationError('registrationNotificationsEnabled must be a boolean');
    }
    result.registration.enabled = rawInput.registrationNotificationsEnabled;
  }

  if (result.registration.recipientEmail && !result.registration.enabled) {
    // Allow storing email even if disabled, but keep flag consistent
    result.registration.enabled = Boolean(result.registration.enabled);
  }

  return result;
}

function sanitizeAiConfig(rawInput = {}, existingConfig = DEFAULT_AI_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid AI configuration payload');
  }

  const result = {
    whisper: {
      ...DEFAULT_AI_CONFIG.whisper,
      ...(existingConfig?.whisper || {})
    },
    llm: {
      ...DEFAULT_AI_CONFIG.llm,
      ...(existingConfig?.llm || {})
    }
  };

  if (Object.prototype.hasOwnProperty.call(rawInput, 'whisper')) {
    const whisper = rawInput.whisper;
    if (whisper === null || typeof whisper !== 'object' || Array.isArray(whisper)) {
      throw new ValidationError('whisper must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(whisper, 'model')) {
      if (typeof whisper.model !== 'string' || whisper.model.trim() === '') {
        throw new ValidationError('whisper.model must be a non-empty string');
      }
      result.whisper.model = whisper.model.trim();
    }

    if (Object.prototype.hasOwnProperty.call(whisper, 'autoReload')) {
      if (typeof whisper.autoReload !== 'boolean') {
        throw new ValidationError('whisper.autoReload must be a boolean');
      }
      result.whisper.autoReload = whisper.autoReload;
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'llm')) {
    const llm = rawInput.llm;
    if (llm === null || typeof llm !== 'object' || Array.isArray(llm)) {
      throw new ValidationError('llm must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(llm, 'devicePreference')) {
      const preference = String(llm.devicePreference || '').toLowerCase();
      if (!['cpu', 'cuda', 'gpu'].includes(preference)) {
        throw new ValidationError('llm.devicePreference must be one of cpu|cuda|gpu');
      }
      result.llm.devicePreference = preference === 'gpu' ? 'cuda' : preference;
    }

    if (Object.prototype.hasOwnProperty.call(llm, 'autoReload')) {
      if (typeof llm.autoReload !== 'boolean') {
        throw new ValidationError('llm.autoReload must be a boolean');
      }
      result.llm.autoReload = llm.autoReload;
    }
  }

  return result;
}

function sanitizeTeamsConfig(rawInput = {}, existingConfig = DEFAULT_TEAMS_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid Teams configuration payload');
  }

  const result = {
    ...DEFAULT_TEAMS_CONFIG,
    ...(existingConfig || {})
  };

  const booleanFields = ['teams_enabled', 'teams_auto_join'];
  booleanFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(rawInput, field)) {
      if (typeof rawInput[field] !== 'boolean') {
        throw new ValidationError(`${field} must be a boolean`);
      }
      result[field] = rawInput[field];
    }
  });

  const stringFields = ['teams_bot_app_id', 'teams_tenant_id'];
  stringFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(rawInput, field)) {
      if (rawInput[field] !== null && typeof rawInput[field] !== 'string') {
        throw new ValidationError(`${field} must be a string`);
      }
      result[field] = (rawInput[field] || '').trim();
    }
  });

  if (Object.prototype.hasOwnProperty.call(rawInput, 'teams_email_recipients')) {
    const recipients = rawInput.teams_email_recipients;
    if (Array.isArray(recipients)) {
      const sanitized = recipients.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
      result.teams_email_recipients = sanitized.length > 0 ? sanitized : 'host_only';
    } else if (typeof recipients === 'string') {
      result.teams_email_recipients = recipients.trim() || 'host_only';
    } else {
      throw new ValidationError('teams_email_recipients must be a string or array of strings');
    }
  }

  return result;
}

function sanitizeSyncConfig(rawInput = DEFAULT_SYNC_CONFIG, existingConfig = DEFAULT_SYNC_CONFIG) {
  if (!Array.isArray(rawInput)) {
    throw new ValidationError('sync configuration payload must be an array');
  }

  const currentByKey = new Map((existingConfig || DEFAULT_SYNC_CONFIG).map((item) => [item.setting_key, item]));
  const sanitized = [];

  rawInput.forEach((item) => {
    if (item === null || typeof item !== 'object') {
      throw new ValidationError('Each sync configuration entry must be an object');
    }

    const base = currentByKey.get(item.setting_key) || null;
    if (!base) {
      throw new ValidationError(`Unknown sync configuration key: ${item.setting_key}`);
    }

    const merged = { ...base };

    if (Object.prototype.hasOwnProperty.call(item, 'setting_value')) {
      merged.setting_value = String(item.setting_value);
    }

    if (Object.prototype.hasOwnProperty.call(item, 'description')) {
      merged.description = String(item.description || base.description || '');
    }

    sanitized.push(merged);
  });

  const updatedKeys = new Set(sanitized.map((item) => item.setting_key));
  const untouched = (existingConfig || DEFAULT_SYNC_CONFIG).filter((item) => !updatedKeys.has(item.setting_key));

  return [...untouched, ...sanitized].sort((a, b) => a.setting_key.localeCompare(b.setting_key));
}

function applySyncUpdates(updates = [], existingConfig = DEFAULT_SYNC_CONFIG) {
  if (!Array.isArray(updates)) {
    throw new ValidationError('Updates must be an array');
  }

  const configByKey = new Map((existingConfig || DEFAULT_SYNC_CONFIG).map((item) => [item.setting_key, { ...item }]));
  const results = {
    updated: 0,
    failed: 0,
    errors: [],
    items: existingConfig
  };

  updates.forEach((update) => {
    if (!update || typeof update !== 'object') {
      results.failed += 1;
      results.errors.push({ error: 'Invalid update payload' });
      return;
    }

    const key = update.setting_key;
    const value = update.setting_value;

    if (!key || typeof key !== 'string') {
      results.failed += 1;
      results.errors.push({ error: 'Missing setting_key', setting_key: key });
      return;
    }

    const current = configByKey.get(key);
    if (!current) {
      results.failed += 1;
      results.errors.push({ error: 'Unknown sync configuration key', setting_key: key });
      return;
    }

    try {
      if (current.data_type === 'integer') {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          throw new ValidationError('Value must be a number');
        }
        if (Number.isFinite(current.min_value) && numeric < current.min_value) {
          throw new ValidationError(`Value must be >= ${current.min_value}`);
        }
        if (Number.isFinite(current.max_value) && numeric > current.max_value) {
          throw new ValidationError(`Value must be <= ${current.max_value}`);
        }
        current.setting_value = String(Math.floor(numeric));
      } else if (current.data_type === 'boolean') {
        if (typeof value === 'boolean') {
          current.setting_value = value ? 'true' : 'false';
        } else if (typeof value === 'string') {
          const normalized = value.toLowerCase();
          if (!['true', 'false', '1', '0'].includes(normalized)) {
            throw new ValidationError('Boolean values must be true/false');
          }
          current.setting_value = ['true', '1'].includes(normalized) ? 'true' : 'false';
        } else {
          throw new ValidationError('Value must be boolean');
        }
      } else {
        current.setting_value = String(value ?? '');
      }

      configByKey.set(key, current);
      results.updated += 1;
    } catch (error) {
      results.failed += 1;
      results.errors.push({ setting_key: key, error: error.message });
    }
  });

  results.items = Array.from(configByKey.values()).sort((a, b) => a.setting_key.localeCompare(b.setting_key));
  return results;
}

function sanitizeLoggingConfig(rawInput = {}, existingConfig = DEFAULT_LOGGING_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid logging configuration payload');
  }

  const result = {
    retention: {
      ...DEFAULT_LOGGING_CONFIG.retention,
      ...(existingConfig?.retention || {})
    },
    scheduler: {
      ...DEFAULT_LOGGING_CONFIG.scheduler,
      ...(existingConfig?.scheduler || {})
    }
  };

  if (Object.prototype.hasOwnProperty.call(rawInput, 'retention')) {
    const retention = rawInput.retention;
    if (retention === null || typeof retention !== 'object' || Array.isArray(retention)) {
      throw new ValidationError('retention must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(retention, 'retention_days')) {
      const numeric = Number(retention.retention_days);
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > 365) {
        throw new ValidationError('retention.retention_days must be between 1 and 365');
      }
      result.retention.retention_days = Math.floor(numeric);
    }

    if (Object.prototype.hasOwnProperty.call(retention, 'default_retention_days')) {
      const numeric = Number(retention.default_retention_days);
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > 365) {
        throw new ValidationError('retention.default_retention_days must be between 1 and 365');
      }
      result.retention.default_retention_days = Math.floor(numeric);
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'scheduler')) {
    const scheduler = rawInput.scheduler;
    if (scheduler === null || typeof scheduler !== 'object' || Array.isArray(scheduler)) {
      throw new ValidationError('scheduler must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(scheduler, 'enabled')) {
      if (typeof scheduler.enabled !== 'boolean') {
        throw new ValidationError('scheduler.enabled must be a boolean');
      }
      result.scheduler.enabled = scheduler.enabled;
    }

    if (Object.prototype.hasOwnProperty.call(scheduler, 'cron_expression')) {
      if (typeof scheduler.cron_expression !== 'string' || scheduler.cron_expression.trim() === '') {
        throw new ValidationError('scheduler.cron_expression must be a non-empty string');
      }
      result.scheduler.cron_expression = scheduler.cron_expression.trim();
    }

    if (Object.prototype.hasOwnProperty.call(scheduler, 'timezone')) {
      if (typeof scheduler.timezone !== 'string' || scheduler.timezone.trim() === '') {
        throw new ValidationError('scheduler.timezone must be a non-empty string');
      }
      result.scheduler.timezone = scheduler.timezone.trim();
    }
  }

  return result;
}

function sanitizeBackupConfig(rawInput = {}, existingConfig = DEFAULT_BACKUP_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid backup configuration payload');
  }

  const result = {
    options: {
      ...DEFAULT_BACKUP_CONFIG.options,
      ...(existingConfig?.options || {})
    },
    retentionDays: existingConfig?.retentionDays ?? DEFAULT_BACKUP_CONFIG.retentionDays,
    backupDirectory: existingConfig?.backupDirectory ?? DEFAULT_BACKUP_CONFIG.backupDirectory,
    scheduler: {
      ...DEFAULT_BACKUP_CONFIG.scheduler,
      ...(existingConfig?.scheduler || {})
    }
  };

  if (Object.prototype.hasOwnProperty.call(rawInput, 'options')) {
    const options = rawInput.options;
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new ValidationError('options must be an object');
    }

    ['includeUserData', 'includeMerkleState', 'includeMetrics', 'compressionEnabled'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(options, field)) {
        if (typeof options[field] !== 'boolean') {
          throw new ValidationError(`options.${field} must be a boolean`);
        }
        result.options[field] = options[field];
      }
    });

    if (Object.prototype.hasOwnProperty.call(options, 'maxUsers')) {
      if (options.maxUsers === null) {
        result.options.maxUsers = null;
      } else {
        const numeric = Number(options.maxUsers);
        if (!Number.isFinite(numeric) || numeric < 1 || numeric > 1000000) {
          throw new ValidationError('options.maxUsers must be between 1 and 1000000 or null');
        }
        result.options.maxUsers = Math.floor(numeric);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'retentionDays')) {
    const numeric = Number(rawInput.retentionDays);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 365) {
      throw new ValidationError('retentionDays must be between 1 and 365');
    }
    result.retentionDays = Math.floor(numeric);
  }

  if (Object.prototype.hasOwnProperty.call(rawInput, 'backupDirectory')) {
    if (typeof rawInput.backupDirectory !== 'string' || rawInput.backupDirectory.trim() === '') {
      throw new ValidationError('backupDirectory must be a non-empty string');
    }
    result.backupDirectory = rawInput.backupDirectory.trim();
  }

  // Validate scheduler configuration
  if (Object.prototype.hasOwnProperty.call(rawInput, 'scheduler')) {
    const scheduler = rawInput.scheduler;
    if (scheduler === null || typeof scheduler !== 'object' || Array.isArray(scheduler)) {
      throw new ValidationError('scheduler must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(scheduler, 'enabled')) {
      if (typeof scheduler.enabled !== 'boolean') {
        throw new ValidationError('scheduler.enabled must be a boolean');
      }
      result.scheduler.enabled = scheduler.enabled;
    }

    if (Object.prototype.hasOwnProperty.call(scheduler, 'cronExpression')) {
      if (typeof scheduler.cronExpression !== 'string' || scheduler.cronExpression.trim() === '') {
        throw new ValidationError('scheduler.cronExpression must be a non-empty string');
      }
      // Basic validation: cron should have 5 or 6 parts separated by spaces
      const parts = scheduler.cronExpression.trim().split(/\s+/);
      if (parts.length < 5 || parts.length > 6) {
        throw new ValidationError('scheduler.cronExpression must be a valid cron expression (5 or 6 parts)');
      }
      result.scheduler.cronExpression = scheduler.cronExpression.trim();
    }

    if (Object.prototype.hasOwnProperty.call(scheduler, 'timezone')) {
      if (typeof scheduler.timezone !== 'string' || scheduler.timezone.trim() === '') {
        throw new ValidationError('scheduler.timezone must be a non-empty string');
      }
      result.scheduler.timezone = scheduler.timezone.trim();
    }
  }

  return result;
}

function sanitizeRecordingQuotasConfig(rawInput = {}, existingConfig = DEFAULT_RECORDING_QUOTAS_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid recording quotas configuration payload');
  }

  const result = {
    quotas: {
      free: {
        ...DEFAULT_RECORDING_QUOTAS_CONFIG.quotas.free,
        ...(existingConfig?.quotas?.free || {})
      },
      professional: {
        ...DEFAULT_RECORDING_QUOTAS_CONFIG.quotas.professional,
        ...(existingConfig?.quotas?.professional || {})
      },
      enterprise: {
        ...DEFAULT_RECORDING_QUOTAS_CONFIG.quotas.enterprise,
        ...(existingConfig?.quotas?.enterprise || {})
      }
    },
    retentionCleanup: {
      ...DEFAULT_RECORDING_QUOTAS_CONFIG.retentionCleanup,
      ...(existingConfig?.retentionCleanup || {})
    },
    allowedMimeTypes: existingConfig?.allowedMimeTypes || DEFAULT_RECORDING_QUOTAS_CONFIG.allowedMimeTypes
  };

  // Validate quotas for each tier
  if (Object.prototype.hasOwnProperty.call(rawInput, 'quotas')) {
    const quotas = rawInput.quotas;
    if (quotas === null || typeof quotas !== 'object' || Array.isArray(quotas)) {
      throw new ValidationError('quotas must be an object');
    }

    const tiers = ['free', 'professional', 'enterprise'];
    tiers.forEach((tier) => {
      if (Object.prototype.hasOwnProperty.call(quotas, tier)) {
        const tierConfig = quotas[tier];
        if (tierConfig === null || typeof tierConfig !== 'object' || Array.isArray(tierConfig)) {
          throw new ValidationError(`quotas.${tier} must be an object`);
        }

        // Validate enabled flag
        if (Object.prototype.hasOwnProperty.call(tierConfig, 'enabled')) {
          if (typeof tierConfig.enabled !== 'boolean') {
            throw new ValidationError(`quotas.${tier}.enabled must be a boolean`);
          }
          result.quotas[tier].enabled = tierConfig.enabled;
        }

        // Validate maxFileSizeMB (0-10240 MB = 10GB max)
        if (Object.prototype.hasOwnProperty.call(tierConfig, 'maxFileSizeMB')) {
          const numeric = Number(tierConfig.maxFileSizeMB);
          if (!Number.isFinite(numeric) || numeric < 0 || numeric > 10240) {
            throw new ValidationError(`quotas.${tier}.maxFileSizeMB must be between 0 and 10240`);
          }
          result.quotas[tier].maxFileSizeMB = Math.floor(numeric);
        }

        // Validate retentionDays (0-365 days)
        if (Object.prototype.hasOwnProperty.call(tierConfig, 'retentionDays')) {
          const numeric = Number(tierConfig.retentionDays);
          if (!Number.isFinite(numeric) || numeric < 0 || numeric > 365) {
            throw new ValidationError(`quotas.${tier}.retentionDays must be between 0 and 365`);
          }
          result.quotas[tier].retentionDays = Math.floor(numeric);
        }
      }
    });
  }

  // Validate retention cleanup settings
  if (Object.prototype.hasOwnProperty.call(rawInput, 'retentionCleanup')) {
    const cleanup = rawInput.retentionCleanup;
    if (cleanup === null || typeof cleanup !== 'object' || Array.isArray(cleanup)) {
      throw new ValidationError('retentionCleanup must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(cleanup, 'enabled')) {
      if (typeof cleanup.enabled !== 'boolean') {
        throw new ValidationError('retentionCleanup.enabled must be a boolean');
      }
      result.retentionCleanup.enabled = cleanup.enabled;
    }

    if (Object.prototype.hasOwnProperty.call(cleanup, 'cronExpression')) {
      if (typeof cleanup.cronExpression !== 'string' || cleanup.cronExpression.trim() === '') {
        throw new ValidationError('retentionCleanup.cronExpression must be a non-empty string');
      }
      // Basic cron validation: should have 5 or 6 parts
      const parts = cleanup.cronExpression.trim().split(/\s+/);
      if (parts.length < 5 || parts.length > 6) {
        throw new ValidationError('retentionCleanup.cronExpression must be a valid cron expression (5 or 6 parts)');
      }
      result.retentionCleanup.cronExpression = cleanup.cronExpression.trim();
    }

    if (Object.prototype.hasOwnProperty.call(cleanup, 'timezone')) {
      if (typeof cleanup.timezone !== 'string' || cleanup.timezone.trim() === '') {
        throw new ValidationError('retentionCleanup.timezone must be a non-empty string');
      }
      result.retentionCleanup.timezone = cleanup.timezone.trim();
    }

    if (Object.prototype.hasOwnProperty.call(cleanup, 'batchSize')) {
      const numeric = Number(cleanup.batchSize);
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > 1000) {
        throw new ValidationError('retentionCleanup.batchSize must be between 1 and 1000');
      }
      result.retentionCleanup.batchSize = Math.floor(numeric);
    }
  }

  // Validate allowed MIME types
  if (Object.prototype.hasOwnProperty.call(rawInput, 'allowedMimeTypes')) {
    if (!Array.isArray(rawInput.allowedMimeTypes)) {
      throw new ValidationError('allowedMimeTypes must be an array');
    }

    const sanitized = rawInput.allowedMimeTypes
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0 && entry.includes('/'));

    if (sanitized.length === 0) {
      throw new ValidationError('allowedMimeTypes must contain at least one valid MIME type');
    }

    result.allowedMimeTypes = Array.from(new Set(sanitized));
  }

  return result;
}

const { DEFAULT_RATE_LIMIT_CONFIG, DEFAULT_BODY_SIZE_LIMIT_CONFIG } = require('./configDefaults');

/**
 * Sanitize a single body size limit rule
 * @param {Object} rule - The rule to sanitize
 * @param {Object} defaultRule - Default values for the rule
 * @param {string} path - Path for error messages
 * @returns {Object} Sanitized rule
 */
function sanitizeBodySizeLimitRule(rule, defaultRule, path) {
  const result = { ...defaultRule };

  if (rule === null || typeof rule !== 'object') {
    return result;
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'enabled')) {
    if (typeof rule.enabled !== 'boolean') {
      throw new ValidationError(`${path}.enabled must be a boolean`);
    }
    result.enabled = rule.enabled;
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'limitKb')) {
    const numeric = Number(rule.limitKb);
    // Allow 1KB to 50MB (51200KB)
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 51200) {
      throw new ValidationError(`${path}.limitKb must be between 1 and 51200 (50MB)`);
    }
    result.limitKb = Math.floor(numeric);
  }

  return result;
}

/**
 * Sanitize body size limit configuration
 * @param {Object} rawInput - Input configuration
 * @param {Object} existingConfig - Existing configuration to merge with
 * @returns {Object} Sanitized configuration
 */
function sanitizeBodySizeLimitConfig(rawInput = {}, existingConfig = DEFAULT_BODY_SIZE_LIMIT_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid body size limit configuration payload');
  }

  // Build result with defaults and existing values
  const result = {
    gateway: {
      ...DEFAULT_BODY_SIZE_LIMIT_CONFIG.gateway,
      ...(existingConfig?.gateway || {})
    },
    services: {}
  };

  // Initialize all service defaults
  const serviceNames = Object.keys(DEFAULT_BODY_SIZE_LIMIT_CONFIG.services);
  for (const serviceName of serviceNames) {
    result.services[serviceName] = {
      ...DEFAULT_BODY_SIZE_LIMIT_CONFIG.services[serviceName],
      ...(existingConfig?.services?.[serviceName] || {})
    };
  }

  // Sanitize gateway limit
  if (Object.prototype.hasOwnProperty.call(rawInput, 'gateway')) {
    result.gateway = sanitizeBodySizeLimitRule(
      rawInput.gateway,
      result.gateway,
      'gateway'
    );
  }

  // Sanitize service-specific limits
  if (Object.prototype.hasOwnProperty.call(rawInput, 'services')) {
    const services = rawInput.services;
    if (services === null || typeof services !== 'object' || Array.isArray(services)) {
      throw new ValidationError('services must be an object');
    }

    for (const serviceName of serviceNames) {
      if (Object.prototype.hasOwnProperty.call(services, serviceName)) {
        result.services[serviceName] = sanitizeBodySizeLimitRule(
          services[serviceName],
          result.services[serviceName],
          `services.${serviceName}`
        );
      }
    }
  }

  return result;
}

/**
 * Sanitize a rate limit rule object
 * @param {Object} rule - The rule to sanitize
 * @param {Object} defaultRule - Default values for the rule
 * @param {string} path - Path for error messages
 * @returns {Object} Sanitized rule
 */
function sanitizeRateLimitRule(rule, defaultRule, path) {
  const result = { ...defaultRule };

  if (rule === null || typeof rule !== 'object') {
    return result;
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'enabled')) {
    if (typeof rule.enabled !== 'boolean') {
      throw new ValidationError(`${path}.enabled must be a boolean`);
    }
    result.enabled = rule.enabled;
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'points')) {
    const numeric = Number(rule.points);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 100000) {
      throw new ValidationError(`${path}.points must be between 1 and 100000`);
    }
    result.points = Math.floor(numeric);
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'duration')) {
    const numeric = Number(rule.duration);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 86400) {
      throw new ValidationError(`${path}.duration must be between 1 and 86400 seconds`);
    }
    result.duration = Math.floor(numeric);
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'blockDuration')) {
    const numeric = Number(rule.blockDuration);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 86400) {
      throw new ValidationError(`${path}.blockDuration must be between 0 and 86400 seconds`);
    }
    result.blockDuration = Math.floor(numeric);
  }

  return result;
}

/**
 * Sanitize rate limit configuration
 * @param {Object} rawInput - Input configuration
 * @param {Object} existingConfig - Existing configuration to merge with
 * @returns {Object} Sanitized configuration
 */
function sanitizeRateLimitConfig(rawInput = {}, existingConfig = DEFAULT_RATE_LIMIT_CONFIG) {
  if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new ValidationError('Invalid rate limit configuration payload');
  }

  const result = {
    global: {
      ...DEFAULT_RATE_LIMIT_CONFIG.global,
      ...(existingConfig?.global || {})
    },
    auth: {
      login: {
        ip: {
          ...DEFAULT_RATE_LIMIT_CONFIG.auth.login.ip,
          ...(existingConfig?.auth?.login?.ip || {})
        },
        email: {
          ...DEFAULT_RATE_LIMIT_CONFIG.auth.login.email,
          ...(existingConfig?.auth?.login?.email || {})
        },
        consecutiveFails: {
          ...DEFAULT_RATE_LIMIT_CONFIG.auth.login.consecutiveFails,
          ...(existingConfig?.auth?.login?.consecutiveFails || {})
        }
      },
      register: {
        ip: {
          ...DEFAULT_RATE_LIMIT_CONFIG.auth.register.ip,
          ...(existingConfig?.auth?.register?.ip || {})
        }
      },
      changePassword: {
        user: {
          ...DEFAULT_RATE_LIMIT_CONFIG.auth.changePassword.user,
          ...(existingConfig?.auth?.changePassword?.user || {})
        }
      },
      validate: {
        ip: {
          ...DEFAULT_RATE_LIMIT_CONFIG.auth.validate.ip,
          ...(existingConfig?.auth?.validate?.ip || {})
        }
      },
      passwordReset: {
        ip: {
          ...DEFAULT_RATE_LIMIT_CONFIG.auth.passwordReset.ip,
          ...(existingConfig?.auth?.passwordReset?.ip || {})
        },
        email: {
          ...DEFAULT_RATE_LIMIT_CONFIG.auth.passwordReset.email,
          ...(existingConfig?.auth?.passwordReset?.email || {})
        }
      }
    },
    downloads: {
      ...DEFAULT_RATE_LIMIT_CONFIG.downloads,
      ...(existingConfig?.downloads || {})
    },
    downloadTracking: {
      ...DEFAULT_RATE_LIMIT_CONFIG.downloadTracking,
      ...(existingConfig?.downloadTracking || {})
    }
  };

  // Sanitize global rate limit
  if (Object.prototype.hasOwnProperty.call(rawInput, 'global')) {
    result.global = sanitizeRateLimitRule(
      rawInput.global,
      result.global,
      'global'
    );
  }

  // Sanitize auth rate limits
  if (Object.prototype.hasOwnProperty.call(rawInput, 'auth')) {
    const auth = rawInput.auth;
    if (auth === null || typeof auth !== 'object' || Array.isArray(auth)) {
      throw new ValidationError('auth must be an object');
    }

    // Login rate limits
    if (Object.prototype.hasOwnProperty.call(auth, 'login')) {
      const login = auth.login;
      if (login === null || typeof login !== 'object' || Array.isArray(login)) {
        throw new ValidationError('auth.login must be an object');
      }

      if (Object.prototype.hasOwnProperty.call(login, 'ip')) {
        result.auth.login.ip = sanitizeRateLimitRule(
          login.ip,
          result.auth.login.ip,
          'auth.login.ip'
        );
      }

      if (Object.prototype.hasOwnProperty.call(login, 'email')) {
        result.auth.login.email = sanitizeRateLimitRule(
          login.email,
          result.auth.login.email,
          'auth.login.email'
        );
      }

      if (Object.prototype.hasOwnProperty.call(login, 'consecutiveFails')) {
        result.auth.login.consecutiveFails = sanitizeRateLimitRule(
          login.consecutiveFails,
          result.auth.login.consecutiveFails,
          'auth.login.consecutiveFails'
        );
      }
    }

    // Register rate limits
    if (Object.prototype.hasOwnProperty.call(auth, 'register')) {
      const register = auth.register;
      if (register === null || typeof register !== 'object' || Array.isArray(register)) {
        throw new ValidationError('auth.register must be an object');
      }

      if (Object.prototype.hasOwnProperty.call(register, 'ip')) {
        result.auth.register.ip = sanitizeRateLimitRule(
          register.ip,
          result.auth.register.ip,
          'auth.register.ip'
        );
      }
    }

    // Change password rate limits
    if (Object.prototype.hasOwnProperty.call(auth, 'changePassword')) {
      const changePassword = auth.changePassword;
      if (changePassword === null || typeof changePassword !== 'object' || Array.isArray(changePassword)) {
        throw new ValidationError('auth.changePassword must be an object');
      }

      if (Object.prototype.hasOwnProperty.call(changePassword, 'user')) {
        result.auth.changePassword.user = sanitizeRateLimitRule(
          changePassword.user,
          result.auth.changePassword.user,
          'auth.changePassword.user'
        );
      }
    }

    // Validate rate limits
    if (Object.prototype.hasOwnProperty.call(auth, 'validate')) {
      const validate = auth.validate;
      if (validate === null || typeof validate !== 'object' || Array.isArray(validate)) {
        throw new ValidationError('auth.validate must be an object');
      }

      if (Object.prototype.hasOwnProperty.call(validate, 'ip')) {
        result.auth.validate.ip = sanitizeRateLimitRule(
          validate.ip,
          result.auth.validate.ip,
          'auth.validate.ip'
        );
      }
    }

    // Password reset rate limits
    if (Object.prototype.hasOwnProperty.call(auth, 'passwordReset')) {
      const passwordReset = auth.passwordReset;
      if (passwordReset === null || typeof passwordReset !== 'object' || Array.isArray(passwordReset)) {
        throw new ValidationError('auth.passwordReset must be an object');
      }

      if (Object.prototype.hasOwnProperty.call(passwordReset, 'ip')) {
        result.auth.passwordReset.ip = sanitizeRateLimitRule(
          passwordReset.ip,
          result.auth.passwordReset.ip,
          'auth.passwordReset.ip'
        );
      }

      if (Object.prototype.hasOwnProperty.call(passwordReset, 'email')) {
        result.auth.passwordReset.email = sanitizeRateLimitRule(
          passwordReset.email,
          result.auth.passwordReset.email,
          'auth.passwordReset.email'
        );
      }
    }
  }

  // Sanitize downloads rate limit (nginx-level for get.yourdomain.com)
  if (Object.prototype.hasOwnProperty.call(rawInput, 'downloads')) {
    const downloads = rawInput.downloads;
    if (downloads === null || typeof downloads !== 'object' || Array.isArray(downloads)) {
      throw new ValidationError('downloads must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(downloads, 'enabled')) {
      result.downloads.enabled = Boolean(downloads.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(downloads, 'requestsPerMinute')) {
      const val = Number(downloads.requestsPerMinute);
      if (!Number.isFinite(val) || val < 1 || val > 60) {
        throw new ValidationError('downloads.requestsPerMinute must be between 1 and 60');
      }
      result.downloads.requestsPerMinute = Math.floor(val);
    }
    if (Object.prototype.hasOwnProperty.call(downloads, 'burstSize')) {
      const val = Number(downloads.burstSize);
      if (!Number.isFinite(val) || val < 1 || val > 20) {
        throw new ValidationError('downloads.burstSize must be between 1 and 20');
      }
      result.downloads.burstSize = Math.floor(val);
    }
    if (Object.prototype.hasOwnProperty.call(downloads, 'maxConcurrentDownloads')) {
      const val = Number(downloads.maxConcurrentDownloads);
      if (!Number.isFinite(val) || val < 1 || val > 10) {
        throw new ValidationError('downloads.maxConcurrentDownloads must be between 1 and 10');
      }
      result.downloads.maxConcurrentDownloads = Math.floor(val);
    }
    if (Object.prototype.hasOwnProperty.call(downloads, 'bandwidthLimitMbps')) {
      const val = Number(downloads.bandwidthLimitMbps);
      if (!Number.isFinite(val) || val < 1 || val > 100) {
        throw new ValidationError('downloads.bandwidthLimitMbps must be between 1 and 100');
      }
      result.downloads.bandwidthLimitMbps = Math.floor(val);
    }
  }

  // Sanitize download tracking rate limit (portal-bff analytics endpoint)
  if (Object.prototype.hasOwnProperty.call(rawInput, 'downloadTracking')) {
    result.downloadTracking = sanitizeRateLimitRule(
      rawInput.downloadTracking,
      result.downloadTracking,
      'downloadTracking'
    );
  }

  return result;
}

module.exports = {
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
};
