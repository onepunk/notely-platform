const fs = require('fs').promises;
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');

const shared = require('@notely/shared');

const db = shared.database;
const { ValidationError, NotFoundError, AppError } = shared.errors;
const baseLogger = shared.logger.child({ service: 'admin-database', scope: 'backup-service' });

/**
 * Normalize database connection information so backups work whether the service
 * is configured via individual DB_* env vars or a single DATABASE_URL string.
 * Prefer explicit BACKUP_* overrides, then the primary POSTGRES_* superuser to
 * avoid permission issues during pg_dump, and finally service-scoped DB_* vars.
 */
function getDatabaseConnectionConfig() {
  const backupUrl = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;

  if (backupUrl) {
    try {
      const parsed = new URL(backupUrl);
      return {
        host: parsed.hostname || 'postgres',
        port: parsed.port || '5432',
        name: decodeURIComponent(parsed.pathname.replace('/', '')) || 'notely_v3',
        user: decodeURIComponent(parsed.username) || 'notely_v3_user',
        password: decodeURIComponent(parsed.password || '')
      };
    } catch (error) {
      baseLogger.warn('Failed to parse BACKUP_DATABASE_URL/DATABASE_URL, falling back to discrete env vars', {
        error: error.message
      });
    }
  }

  return {
    host: process.env.BACKUP_DB_HOST || process.env.DB_HOST || process.env.POSTGRES_HOST || 'postgres',
    port: process.env.BACKUP_DB_PORT || process.env.DB_PORT || process.env.POSTGRES_PORT || '5432',
    name: process.env.BACKUP_DB_NAME || process.env.POSTGRES_DB || process.env.DB_NAME || 'notely_v3',
    user: process.env.BACKUP_DB_USER || process.env.POSTGRES_USER || process.env.DB_USER || 'notely_v3_user',
    password: process.env.BACKUP_DB_PASSWORD || process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || ''
  };
}

const DATABASE = getDatabaseConnectionConfig();

// Backup encryption key (AES-256-CBC, 32 bytes hex-encoded = 64 chars)
const BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || null;
if (!BACKUP_ENCRYPTION_KEY) {
  baseLogger.warn('BACKUP_ENCRYPTION_KEY not set — backups will NOT be encrypted. Set this variable to enable backup encryption.');
}

/**
 * Encrypt a file using AES-256-CBC. IV is prepended to the output file.
 * @param {string} inputPath - Path to the plaintext file
 * @param {string} outputPath - Path for the encrypted output
 */
async function encryptFile(inputPath, outputPath) {
  const { createReadStream, createWriteStream } = require('fs');
  const key = Buffer.from(BACKUP_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  return new Promise((resolve, reject) => {
    const input = createReadStream(inputPath);
    const output = createWriteStream(outputPath);

    // Write IV as the first 16 bytes
    output.write(iv);

    input.pipe(cipher).pipe(output);

    output.on('finish', resolve);
    output.on('error', reject);
    input.on('error', reject);
  });
}

/**
 * Decrypt a file encrypted with encryptFile(). Reads IV from the first 16 bytes.
 * @param {string} inputPath - Path to the encrypted file
 * @param {string} outputPath - Path for the decrypted output
 */
async function decryptFile(inputPath, outputPath) {
  const { createReadStream, createWriteStream } = require('fs');
  const key = Buffer.from(BACKUP_ENCRYPTION_KEY, 'hex');

  // Read the IV from the first 16 bytes
  const fd = await fs.open(inputPath, 'r');
  const ivBuffer = Buffer.alloc(16);
  await fd.read(ivBuffer, 0, 16, 0);
  await fd.close();

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, ivBuffer);

  return new Promise((resolve, reject) => {
    const input = createReadStream(inputPath, { start: 16 });
    const output = createWriteStream(outputPath);

    input.pipe(decipher).pipe(output);

    output.on('finish', resolve);
    output.on('error', reject);
    input.on('error', reject);
  });
}

// Admin-config service URL for fetching backup configuration
const ADMIN_CONFIG_URL = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';

/**
 * Fetch backup configuration from admin-config service
 */
async function getBackupConfig() {
  try {
    const response = await fetch(`${ADMIN_CONFIG_URL}/api/admin/config/backup`);
    if (!response.ok) {
      throw new Error(`Failed to fetch backup config: ${response.status}`);
    }
    const data = await response.json();
    return data.config || {
      options: {
        includeUserData: true,
        includeMerkleState: true,
        includeMetrics: false,
        compressionEnabled: true,
        maxUsers: null
      },
      retentionDays: 30,
      backupDirectory: process.env.DATABASE_BACKUP_DIR || '/tmp/database-backups'
    };
  } catch (error) {
    baseLogger.warn('Failed to fetch backup config from admin-config, using defaults', {
      error: error.message
    });
    // Return defaults if config service is unavailable
    return {
      options: {
        includeUserData: true,
        includeMerkleState: true,
        includeMetrics: false,
        compressionEnabled: true,
        maxUsers: null
      },
      retentionDays: 30,
      backupDirectory: process.env.DATABASE_BACKUP_DIR || '/workspace/database-backups'
    };
  }
}

/**
 * Ensure backup directory exists
 */
async function ensureBackupDirectory(backupDir) {
  try {
    await fs.access(backupDir);
  } catch {
    baseLogger.info('Creating backup directory', { path: backupDir });
    await fs.mkdir(backupDir, { recursive: true });
  }
}

/**
 * Generate a unique backup ID
 */
function generateBackupId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const random = crypto.randomBytes(4).toString('hex');
  return `backup-${timestamp}-${random}`;
}

/**
 * Create backup history record in database
 */
async function createBackupHistoryRecord(backupId, backupType, options, actor) {
  try {
    const result = await db.query(
      `INSERT INTO admin_settings.backup_history
       (backup_id, backup_type, status, options, created_by, created_by_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        backupId,
        backupType, // 'manual' or 'scheduled'
        'running',
        JSON.stringify(options),
        actor?.userId || null,
        actor?.email || 'system'
      ]
    );
    return result.rows[0].id;
  } catch (error) {
    baseLogger.error('Failed to create backup history record', {
      backupId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Update backup history record with completion details
 */
async function updateBackupHistoryRecord(backupId, status, details) {
  try {
    const updates = [
      'status = $2',
      'completed_at = NOW()',
      'updated_at = NOW()'
    ];
    const params = [backupId, status];
    let paramIndex = 3;

    if (details.filePath) {
      updates.push(`file_path = $${paramIndex++}`);
      params.push(details.filePath);
    }

    if (details.fileSize) {
      updates.push(`file_size = $${paramIndex++}`);
      params.push(details.fileSize);
    }

    if (details.checksum) {
      updates.push(`checksum = $${paramIndex++}`);
      params.push(details.checksum);
    }

    if (details.compressed !== undefined) {
      updates.push(`compressed = $${paramIndex++}`);
      params.push(details.compressed);
    }

    if (details.totalRecords) {
      updates.push(`total_records = $${paramIndex++}`);
      params.push(details.totalRecords);
    }

    if (details.totalTables) {
      updates.push(`total_tables = $${paramIndex++}`);
      params.push(details.totalTables);
    }

    if (details.durationSeconds !== undefined) {
      updates.push(`duration_seconds = $${paramIndex++}`);
      params.push(details.durationSeconds);
    }

    if (details.errorMessage) {
      updates.push(`error_message = $${paramIndex++}`);
      params.push(details.errorMessage);
    }

    if (details.errorStack) {
      updates.push(`error_stack = $${paramIndex++}`);
      params.push(details.errorStack);
    }

    await db.query(
      `UPDATE admin_settings.backup_history
       SET ${updates.join(', ')}
       WHERE backup_id = $1`,
      params
    );
  } catch (error) {
    baseLogger.error('Failed to update backup history record', {
      backupId,
      error: error.message
    });
    // Don't throw - backup itself might have succeeded
  }
}

/**
 * Calculate file checksum (SHA-256)
 */
async function calculateChecksum(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

/**
 * Get file size in bytes
 */
async function getFileSize(filePath) {
  const stats = await fs.stat(filePath);
  return stats.size;
}

/**
 * List all available backups from database history
 */
async function listBackups() {
  try {
    const result = await db.query(
      `SELECT
        backup_id as "backupId",
        backup_type as "backupType",
        status,
        started_at as "startedAt",
        completed_at as "completedAt",
        duration_seconds as "durationSeconds",
        options,
        file_path as "filePath",
        file_size as "fileSize",
        checksum,
        compressed,
        total_records as "totalRecords",
        total_tables as "totalTables",
        error_message as "errorMessage",
        created_by_email as "createdBy"
       FROM admin_settings.backup_history
       ORDER BY started_at DESC`,
      []
    );

    // Transform database records to match expected backup format
    return result.rows.map(row => ({
      backupId: row.backupId,
      timestamp: row.startedAt,
      backupType: row.backupType,
      status: row.status,
      version: '1.0',
      options: row.options || {},
      files: row.filePath ? [{
        name: path.basename(row.filePath),
        size: row.fileSize || 0,
        checksum: row.checksum || '',
        recordCount: row.totalRecords || 0
      }] : [],
      statistics: {
        totalSize: row.fileSize || 0,
        totalRecords: row.totalRecords || 0,
        totalTables: row.totalTables || 0,
        duration: row.durationSeconds || 0
      },
      integrity: {
        verified: row.status === 'completed',
        checksums: row.checksum ? {
          [path.basename(row.filePath || '')]: row.checksum
        } : {}
      },
      createdBy: row.createdBy || 'system',
      createdAt: row.startedAt,
      completedAt: row.completedAt,
      errorMessage: row.errorMessage
    }));
  } catch (error) {
    baseLogger.error('Failed to list backups from database', { error: error.message });
    return [];
  }
}

/**
 * Create a new database backup
 * @param {Object} options - Backup options
 * @param {Object} actor - User who initiated the backup
 * @param {String} backupType - Type of backup: 'manual' or 'scheduled'
 */
async function createBackup(options, actor, backupType = 'manual') {
  const config = await getBackupConfig();
  const backupDir = config.backupDirectory;
  await ensureBackupDirectory(backupDir);

  const backupId = generateBackupId();
  const timestamp = new Date().toISOString();
  const backupFile = path.join(backupDir, `${backupId}.sql`);
  const compressedFile = path.join(backupDir, `${backupId}.sql.gz`);
  const encryptedFile = path.join(backupDir, `${backupId}.sql.gz.enc`);
  const metadataFile = path.join(backupDir, `${backupId}.meta.json`);
  const isEncrypted = !!BACKUP_ENCRYPTION_KEY;

  baseLogger.info('Creating database backup', {
    backupId,
    backupType,
    options,
    actor: actor?.email || 'system'
  });

  const startTime = Date.now();

  // Create backup history record
  await createBackupHistoryRecord(backupId, backupType, options, actor);

  try {
    // Use pg_dump to create a SQL dump
    const pgDumpCommand = [
      '-h',
      DATABASE.host,
      '-p',
      DATABASE.port,
      '-U',
      DATABASE.user,
      '-d',
      DATABASE.name,
      '-F',
      'p', // Plain text format
      '--verbose',
      '--no-owner',
      '--no-acl',
      '-f',
      backupFile
    ];

    baseLogger.debug('Executing pg_dump', { host: DATABASE.host, port: DATABASE.port });
    execFileSync('pg_dump', pgDumpCommand, {
      stdio: 'pipe',
      env: {
        ...process.env,
        PGPASSWORD: DATABASE.password
      }
    });

    // Compress if requested
    let finalFile = backupFile;
    if (options.compressionEnabled) {
      baseLogger.debug('Compressing backup file');
      execSync(`gzip -c ${backupFile} > ${compressedFile}`);
      finalFile = compressedFile;
      // Remove uncompressed file
      await fs.unlink(backupFile);
    }

    // Encrypt if key is configured
    if (isEncrypted) {
      baseLogger.debug('Encrypting backup file');
      await encryptFile(finalFile, encryptedFile);
      // Remove unencrypted file
      await fs.unlink(finalFile);
      finalFile = encryptedFile;
    }

    // Calculate statistics
    const fileSize = await getFileSize(finalFile);
    const checksum = await calculateChecksum(finalFile);
    const duration = (Date.now() - startTime) / 1000; // seconds

    // Get record counts from database
    const recordCounts = await getDatabaseRecordCounts();
    const totalRecords = Object.values(recordCounts).reduce((sum, count) => sum + count, 0);
    const totalTables = Object.keys(recordCounts).length;

    // Create metadata
    const metadata = {
      backupId,
      timestamp,
      version: '1.0',
      backupType,
      options,
      files: [
        {
          name: path.basename(finalFile),
          size: fileSize,
          checksum,
          recordCount: totalRecords
        }
      ],
      encrypted: isEncrypted,
      statistics: {
        totalSize: fileSize,
        totalRecords,
        totalTables,
        compressionRatio: options.compressionEnabled ? 1 : undefined,
        duration
      },
      integrity: {
        verified: true,
        checksums: {
          [path.basename(finalFile)]: checksum
        }
      },
      database: {
        host: DATABASE.host,
        name: DATABASE.name,
        version: await getDatabaseVersion()
      },
      createdBy: actor?.email || 'system',
      createdAt: timestamp
    };

    // Save metadata
    await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8');

    // Update backup history record with success
    await updateBackupHistoryRecord(backupId, 'completed', {
      filePath: finalFile,
      fileSize,
      checksum,
      compressed: options.compressionEnabled,
      totalRecords,
      totalTables,
      durationSeconds: Math.round(duration)
    });

    baseLogger.info('Backup created successfully', {
      backupId,
      backupType,
      fileSize,
      duration,
      totalRecords,
      totalTables
    });

    return metadata;
  } catch (error) {
    baseLogger.error('Backup creation failed', {
      backupId,
      error: error.message,
      stack: error.stack
    });

    // Update backup history record with failure
    await updateBackupHistoryRecord(backupId, 'failed', {
      errorMessage: error.message,
      errorStack: error.stack,
      durationSeconds: Math.round((Date.now() - startTime) / 1000)
    });

    // Clean up partial files
    try {
      await fs.unlink(backupFile).catch(() => {});
      await fs.unlink(compressedFile).catch(() => {});
      await fs.unlink(encryptedFile).catch(() => {});
      await fs.unlink(metadataFile).catch(() => {});
    } catch {}

    throw new AppError(`Backup creation failed: ${error.message}`, 500);
  }
}

/**
 * Get database version
 */
async function getDatabaseVersion() {
  try {
    const result = await db.query('SELECT version()');
    return result.rows[0].version;
  } catch {
    return 'unknown';
  }
}

/**
 * Get record counts from all tables
 */
async function getDatabaseRecordCounts() {
  const counts = {};

  try {
    const { rows: tables } = await db.query(`
      SELECT schemaname, relname
      FROM pg_stat_user_tables
      ORDER BY schemaname, relname
    `);

    for (const table of tables) {
      try {
        const { rows } = await db.query(
          `SELECT COUNT(*)::int AS count FROM "${table.schemaname}"."${table.relname}"`
        );
        counts[`${table.schemaname}.${table.relname}`] = rows[0].count;
      } catch (error) {
        baseLogger.warn('Failed to count table records', {
          table: `${table.schemaname}.${table.relname}`,
          error: error.message
        });
        counts[`${table.schemaname}.${table.relname}`] = 0;
      }
    }
  } catch (error) {
    baseLogger.error('Failed to get record counts', { error: error.message });
  }

  return counts;
}

/**
 * Restore from a backup
 */
async function restoreFromBackup(backupId, options, actor) {
  const config = await getBackupConfig();
  const backupDir = config.backupDirectory;

  baseLogger.warn('Restore operation initiated', {
    backupId,
    options,
    actor: actor?.email || 'system'
  });

  const metadataFile = path.join(backupDir, `${backupId}.meta.json`);

  try {
    // Read metadata
    const metadataContent = await fs.readFile(metadataFile, 'utf-8');
    const metadata = JSON.parse(metadataContent);

    // Find the backup file
    const backupFileName = metadata.files[0].name;
    const backupFilePath = path.join(backupDir, backupFileName);

    // Verify file exists
    await fs.access(backupFilePath);

    // Verify integrity if requested
    if (options.validateIntegrity) {
      baseLogger.info('Validating backup integrity');
      const checksum = await calculateChecksum(backupFilePath);
      const expectedChecksum = metadata.files[0].checksum;

      if (checksum !== expectedChecksum) {
        throw new ValidationError('Backup integrity check failed: checksum mismatch');
      }
    }

    if (options.dryRun) {
      baseLogger.info('Dry run mode - skipping actual restore');
      return {
        backupId,
        restored: false,
        recordsRestored: 0,
        errors: [],
        dryRun: true
      };
    }

    // Decrypt if needed
    let fileToDecompress = backupFilePath;
    if (backupFileName.endsWith('.enc')) {
      if (!BACKUP_ENCRYPTION_KEY) {
        throw new ValidationError('Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set. Cannot restore.');
      }
      const decryptedFile = path.join(backupDir, `${backupId}-restore.sql.gz`);
      baseLogger.info('Decrypting backup file');
      await decryptFile(backupFilePath, decryptedFile);
      fileToDecompress = decryptedFile;
    }

    // Decompress if needed
    let sqlFile = fileToDecompress;
    if (fileToDecompress.endsWith('.gz')) {
      const decompressedFile = path.join(backupDir, `${backupId}-restore.sql`);
      baseLogger.info('Decompressing backup file');
      execSync(`gunzip -c ${fileToDecompress} > ${decompressedFile}`);
      sqlFile = decompressedFile;

      // Clean up decrypted intermediate file if it was created
      if (fileToDecompress !== backupFilePath) {
        await fs.unlink(fileToDecompress).catch(() => {});
      }
    }

    // Restore using psql
    const psqlCommand = [
      '-h',
      DATABASE.host,
      '-p',
      DATABASE.port,
      '-U',
      DATABASE.user,
      '-d',
      DATABASE.name,
      '-f',
      sqlFile
    ];

    baseLogger.info('Executing database restore');
    execFileSync('psql', psqlCommand, {
      stdio: 'pipe',
      env: {
        ...process.env,
        PGPASSWORD: DATABASE.password
      }
    });

    // Clean up decompressed file if created
    if (sqlFile !== backupFilePath) {
      await fs.unlink(sqlFile).catch(() => {});
    }

    baseLogger.info('Restore completed successfully', { backupId });

    return {
      backupId,
      restored: true,
      recordsRestored: metadata.statistics.totalRecords || 0,
      errors: []
    };
  } catch (error) {
    baseLogger.error('Restore operation failed', {
      backupId,
      error: error.message,
      stack: error.stack
    });

    throw new ServerError(`Restore failed: ${error.message}`);
  }
}

/**
 * Delete a specific backup (files + history record)
 */
async function deleteBackup(backupId, actor) {
  const config = await getBackupConfig();
  const backupDir = config.backupDirectory;
  await ensureBackupDirectory(backupDir);

  const { rows } = await db.query(
    `SELECT backup_id, file_path AS "filePath", file_size AS "fileSize"
     FROM admin_settings.backup_history
     WHERE backup_id = $1`,
    [backupId]
  );

  if (!rows.length) {
    throw new NotFoundError(`Backup not found: ${backupId}`);
  }

  const record = rows[0];
  const candidateFiles = new Set(
    [
      record.filePath,
      path.join(backupDir, `${backupId}.sql`),
      path.join(backupDir, `${backupId}.sql.gz`),
      path.join(backupDir, `${backupId}.sql.gz.enc`),
      path.join(backupDir, `${backupId}.meta.json`)
    ].filter(Boolean)
  );

  let freed = 0;
  const removed = [];

  for (const filePath of candidateFiles) {
    try {
      const stats = await fs.stat(filePath);
      await fs.unlink(filePath);
      freed += stats.size;
      removed.push(path.basename(filePath));
      baseLogger.debug('Removed backup artifact', { filePath });
    } catch (error) {
      // Ignore missing files but log for visibility
      baseLogger.warn('Failed to remove backup artifact', {
        filePath,
        error: error.message
      });
    }
  }

  await db.query(
    'DELETE FROM admin_settings.backup_history WHERE backup_id = $1',
    [backupId]
  );

  baseLogger.info('Backup deleted', {
    backupId,
    removedCount: removed.length,
    freed,
    actor: actor?.email || 'system'
  });

  return {
    backupId,
    removed,
    freed
  };
}

/**
 * Clean up old backups
 */
async function cleanupOldBackups(maxAgeDays, actor) {
  const config = await getBackupConfig();
  const backupDir = config.backupDirectory;
  await ensureBackupDirectory(backupDir);

  baseLogger.info('Cleanup old backups initiated', {
    maxAgeDays,
    actor: actor?.email || 'system'
  });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  const allBackups = await listBackups();
  const backupsToRemove = allBackups.filter(
    backup => new Date(backup.timestamp) < cutoffDate
  );

  let removed = 0;
  let freed = 0;

  for (const backup of backupsToRemove) {
    try {
      const backupId = backup.backupId;
      const metadataFile = path.join(backupDir, `${backupId}.meta.json`);

      // Remove backup files
      for (const file of backup.files) {
        const filePath = path.join(backupDir, file.name);
        try {
          await fs.unlink(filePath);
          freed += file.size;
          baseLogger.debug('Removed backup file', { file: file.name });
        } catch (error) {
          baseLogger.warn('Failed to remove backup file', {
            file: file.name,
            error: error.message
          });
        }
      }

      // Remove metadata file
      try {
        await fs.unlink(metadataFile);
      } catch (error) {
        baseLogger.warn('Failed to remove metadata file', {
          file: `${backupId}.meta.json`,
          error: error.message
        });
      }

      removed++;
    } catch (error) {
      baseLogger.error('Failed to remove backup', {
        backupId: backup.backupId,
        error: error.message
      });
    }
  }

  const remaining = allBackups.length - removed;

  baseLogger.info('Cleanup completed', { removed, freed, remaining });

  return {
    removed,
    freed,
    remaining
  };
}

/**
 * Get details about a specific backup
 */
async function getBackupDetails(backupId) {
  const config = await getBackupConfig();
  const backupDir = config.backupDirectory;
  const metadataFile = path.join(backupDir, `${backupId}.meta.json`);

  try {
    const content = await fs.readFile(metadataFile, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    baseLogger.error('Failed to read backup details', {
      backupId,
      error: error.message
    });
    throw new NotFoundError(`Backup not found: ${backupId}`);
  }
}

module.exports = {
  listBackups,
  createBackup,
  restoreFromBackup,
  cleanupOldBackups,
  getBackupDetails,
  deleteBackup
};
