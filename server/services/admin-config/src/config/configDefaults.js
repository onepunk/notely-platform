const DEFAULT_GENERAL_CONFIG = {
  adminPortalTimeout: 60,
  inactiveSessionTimeout: 60,
  maxConcurrentSessions: 100,
  sessionCleanupInterval: 15,
  signupsEnabled: true,
  requireBetaToken: true
};

const DEFAULT_SECURITY_CONFIG = {
  sslEnabled: true,
  httpsRedirect: true,
  sessionTimeout: 30,
  maxLoginAttempts: 5,
  passwordComplexity: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true
  },
  twoFactorAuth: false,
  ipWhitelist: [],
  apiRateLimit: 100,
  localLoginEnabled: true
};

const DEFAULT_AI_CONFIG = {
  whisper: {
    model: 'base',
    autoReload: true
  },
  llm: {
    devicePreference: 'cpu',
    autoReload: true
  }
};

const DEFAULT_TEAMS_CONFIG = {
  teams_enabled: false,
  teams_auto_join: false,
  teams_bot_app_id: '',
  teams_tenant_id: '',
  teams_email_recipients: 'host_only'
};

const DEFAULT_SYNC_CONFIG = [
  {
    setting_key: 'sync.rate_limit.requests_per_hour',
    setting_value: '100',
    data_type: 'integer',
    description: 'Maximum sync requests per user per hour',
    category: 'rate_limiting',
    min_value: 1,
    max_value: 10000,
    default_value: '100'
  },
  {
    setting_key: 'sync.rate_limit.burst_size',
    setting_value: '10',
    data_type: 'integer',
    description: 'Burst size for rate limiting (requests that can exceed hourly limit)',
    category: 'rate_limiting',
    min_value: 1,
    max_value: 100,
    default_value: '10'
  },
  {
    setting_key: 'sync.pull.default_page_size',
    setting_value: '250',
    data_type: 'integer',
    description: 'Default number of entities returned per pull request',
    category: 'c_sync_operations',
    min_value: 1,
    max_value: 1000,
    default_value: '250'
  },
  {
    setting_key: 'sync.pull.max_page_size',
    setting_value: '1000',
    data_type: 'integer',
    description: 'Maximum page size allowed for pull requests',
    category: 'c_sync_operations',
    min_value: 1,
    max_value: 5000,
    default_value: '1000'
  },
  {
    setting_key: 'sync.push.max_batch_size',
    setting_value: '500',
    data_type: 'integer',
    description: 'Maximum number of entities allowed per push batch',
    category: 'c_sync_operations',
    min_value: 1,
    max_value: 2000,
    default_value: '500'
  },
  {
    setting_key: 'sync.push.max_request_size_mb',
    setting_value: '50',
    data_type: 'integer',
    description: 'Maximum total request size in MB for push operations',
    category: 'c_sync_operations',
    min_value: 1,
    max_value: 500,
    default_value: '50'
  },
  {
    setting_key: 'sync.blob.max_file_size_gb',
    setting_value: '1',
    data_type: 'integer',
    description: 'Maximum file size for blob uploads in GB',
    category: 'blob_uploads',
    min_value: 1,
    max_value: 50,
    default_value: '1'
  },
  {
    setting_key: 'sync.blob.default_chunk_size_mb',
    setting_value: '8',
    data_type: 'integer',
    description: 'Default chunk size for blob uploads in MB',
    category: 'blob_uploads',
    min_value: 1,
    max_value: 100,
    default_value: '8'
  },
  {
    setting_key: 'sync.blob.min_chunk_size_kb',
    setting_value: '1',
    data_type: 'integer',
    description: 'Minimum chunk size for blob uploads in KB',
    category: 'blob_uploads',
    min_value: 1,
    max_value: 1024,
    default_value: '1'
  },
  {
    setting_key: 'sync.blob.max_chunk_size_mb',
    setting_value: '10',
    data_type: 'integer',
    description: 'Maximum chunk size for blob uploads in MB',
    category: 'blob_uploads',
    min_value: 1,
    max_value: 100,
    default_value: '10'
  },
  {
    setting_key: 'sync.blob.session_expiry_hours',
    setting_value: '24',
    data_type: 'integer',
    description: 'Blob upload session expiry time in hours',
    category: 'blob_uploads',
    min_value: 1,
    max_value: 168,
    default_value: '24'
  },
  {
    setting_key: 'sync.blob.cleanup_interval_hours',
    setting_value: '4',
    data_type: 'integer',
    description: 'How often to cleanup expired blob sessions in hours',
    category: 'blob_uploads',
    min_value: 1,
    max_value: 72,
    default_value: '4'
  },
  {
    setting_key: 'sync.blob.max_concurrent_uploads',
    setting_value: '5',
    data_type: 'integer',
    description: 'Maximum concurrent blob uploads per user',
    category: 'blob_uploads',
    min_value: 1,
    max_value: 20,
    default_value: '5'
  },
  {
    setting_key: 'sync.session.max_duration_minutes',
    setting_value: '30',
    data_type: 'integer',
    description: 'Maximum duration for a sync session in minutes',
    category: 'sessions',
    min_value: 1,
    max_value: 180,
    default_value: '30'
  },
  {
    setting_key: 'sync.session.idle_timeout_minutes',
    setting_value: '10',
    data_type: 'integer',
    description: 'Idle timeout for sync sessions in minutes',
    category: 'sessions',
    min_value: 1,
    max_value: 60,
    default_value: '10'
  },
  {
    setting_key: 'sync.session.max_retries',
    setting_value: '3',
    data_type: 'integer',
    description: 'Maximum number of retries for failed operations',
    category: 'sessions',
    min_value: 1,
    max_value: 10,
    default_value: '3'
  },
  {
    setting_key: 'sync.idempotency.cache_ttl_hours',
    setting_value: '1',
    data_type: 'integer',
    description: 'Time to live for idempotency cache in hours',
    category: 'caching',
    min_value: 1,
    max_value: 24,
    default_value: '1'
  },
  {
    setting_key: 'sync.idempotency.max_cache_size',
    setting_value: '10000',
    data_type: 'integer',
    description: 'Maximum number of idempotency keys to cache',
    category: 'caching',
    min_value: 100,
    max_value: 100000,
    default_value: '10000'
  },
  {
    setting_key: 'sync.cleanup.tombstone_retention_days',
    setting_value: '60',
    data_type: 'integer',
    description: 'How long to keep soft-deleted records in days',
    category: 'cleanup',
    min_value: 7,
    max_value: 365,
    default_value: '60'
  },
  {
    setting_key: 'sync.cleanup.blob_cleanup_delay_hours',
    setting_value: '48',
    data_type: 'integer',
    description: 'Delay before cleaning up completed blob uploads in hours',
    category: 'cleanup',
    min_value: 1,
    max_value: 720,
    default_value: '48'
  },
  {
    setting_key: 'sync.cleanup.session_cleanup_days',
    setting_value: '30',
    data_type: 'integer',
    description: 'How long to keep sync session records in days',
    category: 'cleanup',
    min_value: 1,
    max_value: 365,
    default_value: '30'
  },
  {
    setting_key: 'sync.features.blob_uploads_enabled',
    setting_value: 'true',
    data_type: 'boolean',
    description: 'Enable/disable blob upload functionality',
    category: 'features',
    min_value: null,
    max_value: null,
    default_value: 'true'
  },
  {
    setting_key: 'sync.features.compression_enabled',
    setting_value: 'true',
    data_type: 'boolean',
    description: 'Enable/disable gzip compression for sync responses',
    category: 'features',
    min_value: null,
    max_value: null,
    default_value: 'true'
  },
  {
    setting_key: 'sync.features.debug_logging',
    setting_value: 'false',
    data_type: 'boolean',
    description: 'Enable detailed debug logging for sync operations',
    category: 'features',
    min_value: null,
    max_value: null,
    default_value: 'false'
  },
  {
    setting_key: 'sync.features.metrics_collection',
    setting_value: 'true',
    data_type: 'boolean',
    description: 'Enable sync metrics collection',
    category: 'features',
    min_value: null,
    max_value: null,
    default_value: 'true'
  },
  {
    setting_key: 'sync.performance.connection_pool_size',
    setting_value: '20',
    data_type: 'integer',
    description: 'Database connection pool size for sync operations',
    category: 'performance',
    min_value: 5,
    max_value: 100,
    default_value: '20'
  },
  {
    setting_key: 'sync.performance.query_timeout_seconds',
    setting_value: '30',
    data_type: 'integer',
    description: 'Database query timeout in seconds',
    category: 'performance',
    min_value: 5,
    max_value: 300,
    default_value: '30'
  },
  {
    setting_key: 'sync.performance.batch_insert_size',
    setting_value: '100',
    data_type: 'integer',
    description: 'Number of records to insert in a single batch operation',
    category: 'performance',
    min_value: 10,
    max_value: 1000,
    default_value: '100'
  }
];

const DEFAULT_LOGGING_CONFIG = {
  retention: {
    retention_days: 30,
    default_retention_days: 30
  },
  scheduler: {
    enabled: true,
    cron_expression: '0 3 * * *',
    timezone: 'UTC'
  }
};

const DEFAULT_BACKUP_CONFIG = {
  options: {
    includeUserData: true,
    includeMerkleState: true,
    includeMetrics: false,
    compressionEnabled: true,
    maxUsers: null
  },
  retentionDays: 30,
  // Default backup path lives inside the repo tree and is mounted into the
  // admin-database container at /workspace/database-backups
  backupDirectory: '/workspace/database-backups',
  scheduler: {
    enabled: false,
    cronExpression: '0 2 * * *', // Default: 2 AM daily
    timezone: 'UTC'
  }
};

const DEFAULT_NOTIFICATIONS_CONFIG = {
  registration: {
    enabled: false,
    recipientEmail: ''
  }
};

const DEFAULT_RECORDING_QUOTAS_CONFIG = {
  quotas: {
    free: {
      enabled: false,
      maxFileSizeMB: 0,
      retentionDays: 0
    },
    professional: {
      enabled: true,
      maxFileSizeMB: 500,
      retentionDays: 7
    },
    enterprise: {
      enabled: true,
      maxFileSizeMB: 1024,
      retentionDays: 7
    }
  },
  retentionCleanup: {
    enabled: true,
    cronExpression: '0 2 * * *',
    timezone: 'UTC',
    batchSize: 100
  },
  allowedMimeTypes: [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/mp4'
  ]
};

/**
 * Request Body Size Limits Configuration
 *
 * Controls maximum request body size at the gateway (global) and per-service.
 * Prevents DoS attacks through oversized payloads.
 * These values are applied when services restart.
 *
 * Values are in kilobytes (KB). For example:
 * - 100 = 100KB
 * - 1024 = 1MB
 * - 5120 = 5MB
 */
const DEFAULT_BODY_SIZE_LIMIT_CONFIG = {
  // Global limit applied at gateway - first line of defense
  gateway: {
    enabled: true,
    limitKb: 1024  // 1MB default for gateway
  },

  // Service-specific limits (applied when requests reach each service)
  services: {
    auth: {
      enabled: true,
      limitKb: 100  // 100KB - auth payloads are small (login, register, tokens)
    },
    users: {
      enabled: true,
      limitKb: 512  // 512KB - user profiles, preferences
    },
    calendar: {
      enabled: true,
      limitKb: 256  // 256KB - calendar events
    },
    support: {
      enabled: true,
      limitKb: 512  // 512KB - support tickets, messages
    },
    adminConfig: {
      enabled: true,
      limitKb: 256  // 256KB - configuration payloads
    },
    dockerManager: {
      enabled: true,
      limitKb: 100  // 100KB - container management commands
    },
    sync: {
      enabled: true,
      limitKb: 5120  // 5MB - document sync requires larger payloads
    },
    license: {
      enabled: true,
      limitKb: 5120  // 5MB - batch license operations
    },
    portalBff: {
      enabled: true,
      limitKb: 5120  // 5MB - aggregated portal requests
    },
    adminDatabase: {
      enabled: true,
      limitKb: 1024  // 1MB - database operations
    },
    observability: {
      enabled: true,
      limitKb: 1024  // 1MB - log ingestion
    }
  }
};

/**
 * Rate Limiting Configuration
 *
 * Controls API rate limits at the gateway (global) and auth service (endpoint-specific).
 * These values are applied when the services restart or when configuration is reloaded.
 */
const DEFAULT_RATE_LIMIT_CONFIG = {
  // Global rate limit (applied at gateway to all endpoints)
  global: {
    enabled: true,
    points: 100,             // 100 requests
    duration: 60,            // per 60 seconds (1 minute)
    blockDuration: 300       // block for 5 minutes if exceeded
  },

  // Authentication endpoint rate limits
  auth: {
    login: {
      // Per-IP limits for login attempts
      ip: {
        enabled: true,
        points: 10,              // 10 attempts
        duration: 900,           // per 15 minutes (900 seconds)
        blockDuration: 900       // block for 15 minutes if exceeded
      },
      // Per-email limits (stricter - protects individual accounts)
      email: {
        enabled: true,
        points: 5,               // 5 attempts per email
        duration: 900,           // per 15 minutes
        blockDuration: 1800      // block for 30 minutes if exceeded
      },
      // Consecutive failures tracking (for account lockout)
      consecutiveFails: {
        enabled: true,
        points: 5,               // 5 consecutive failures
        duration: 86400,         // tracked over 24 hours
        blockDuration: 3600      // lock account for 1 hour
      }
    },
    register: {
      // Per-IP limits for registration
      ip: {
        enabled: true,
        points: 5,               // 5 registrations
        duration: 3600,          // per hour
        blockDuration: 3600      // block for 1 hour
      }
    },
    changePassword: {
      // Per-user limits for password changes
      user: {
        enabled: true,
        points: 3,               // 3 attempts
        duration: 900,           // per 15 minutes
        blockDuration: 1800      // block for 30 minutes
      }
    },
    validate: {
      // Per-IP limits for token validation (higher limit for service calls)
      ip: {
        enabled: true,
        points: 100,             // 100 validations
        duration: 60,            // per minute
        blockDuration: 300       // block for 5 minutes
      }
    },
    passwordReset: {
      // Per-IP limits for password reset requests
      ip: {
        enabled: true,
        points: 3,               // 3 reset requests
        duration: 3600,          // per hour
        blockDuration: 3600      // block for 1 hour
      },
      // Per-email limits
      email: {
        enabled: true,
        points: 3,               // 3 reset requests per email
        duration: 3600,          // per hour
        blockDuration: 3600      // block for 1 hour
      }
    }
  },
  // Downloads rate limiting (served via nginx at get.yourdomain.com)
  downloads: {
    enabled: true,
    requestsPerMinute: 5,        // 5 downloads per minute per IP
    burstSize: 5,                // Allow burst of 5 additional requests
    maxConcurrentDownloads: 3,   // Max simultaneous downloads per IP
    bandwidthLimitMbps: 10       // 10 MB/s per download
  },
  // Download tracking API rate limiting (portal-bff endpoint for analytics)
  downloadTracking: {
    enabled: true,
    points: 30,                  // 30 requests
    duration: 60,                // per minute
    blockDuration: 60            // block for 1 minute if exceeded
  }
};

module.exports = {
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
};
