const shared = require('@notely/shared');
const metrics = require('../utils/metrics');

const db = shared.database;
const logger = shared.logger;
const { apiKeys } = shared.utils;

async function getActiveServiceKey(serviceName) {
  const result = await db.query(
    `SELECT id, name, key_hash, salt, scopes, is_active
     FROM global_auth.api_keys
     WHERE service_name = $1 AND is_service = TRUE`,
    [serviceName]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const record = result.rows[0];
  if (!record.is_active) {
    return null;
  }

  return record;
}

async function listApiKeys() {
  const result = await db.query(
    `SELECT id, name, service_name, is_service, is_active, scopes, created_at, last_used_at
     FROM global_auth.api_keys
     ORDER BY created_at DESC`
  );

  return result.rows;
}

async function getApiKeyByService(serviceName) {
  const result = await db.query(
    `SELECT id, name, service_name, is_service, is_active, scopes, created_at, last_used_at
     FROM global_auth.api_keys
     WHERE service_name = $1`,
    [serviceName]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

async function updateLastUsed(id, keyType = 'client') {
  try {
    await db.query(
      `UPDATE global_auth.api_keys
       SET last_used_at = NOW()
       WHERE id = $1`,
      [id]
    );
    metrics.recordApiKeyLastUsedUpdate(keyType);
  } catch (error) {
    logger.warn('Failed to update API key usage timestamp', {
      error: error.message,
      api_key_id: id
    });
  }
}

async function verifyServiceApiKey(serviceName, providedKey) {
  const startTime = Date.now();

  try {
    const record = await getActiveServiceKey(serviceName);

    if (!record) {
      const duration = (Date.now() - startTime) / 1000;
      metrics.recordApiKeyVerification('service', false, 'not_found', duration);
      return { valid: false, reason: 'not_found' };
    }

    const calculatedHash = apiKeys.hashApiKey(providedKey, record.salt);
    const matches = apiKeys.safeCompare(record.key_hash, calculatedHash);

    if (!matches) {
      logger.warn('Service API key verification failed', { serviceName });
      const duration = (Date.now() - startTime) / 1000;
      metrics.recordApiKeyVerification('service', false, 'invalid_key', duration);
      return { valid: false, reason: 'invalid_key' };
    }

    await updateLastUsed(record.id, 'service');

    const duration = (Date.now() - startTime) / 1000;
    metrics.recordApiKeyVerification('service', true, null, duration);

    return {
      valid: true,
      scopes: record.scopes || [],
      name: record.name
    };
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    metrics.recordApiKeyVerification('service', false, 'error', duration);
    throw error;
  }
}

async function verifyClientApiKey(rawKey) {
  const startTime = Date.now();

  try {
    if (!rawKey) {
      const duration = (Date.now() - startTime) / 1000;
      metrics.recordApiKeyVerification('client', false, 'missing_key', duration);
      return { valid: false, reason: 'missing_key' };
    }

    const result = await db.query(
      `SELECT id, name, key_hash, salt, scopes, is_active
       FROM global_auth.api_keys
       WHERE is_service = FALSE`
    );

    for (const record of result.rows) {
      if (!record.is_active) {
        continue;
      }

      const calculated = apiKeys.hashApiKey(rawKey, record.salt);
      if (apiKeys.safeCompare(record.key_hash, calculated)) {
        await updateLastUsed(record.id, 'client');

        const duration = (Date.now() - startTime) / 1000;
        metrics.recordApiKeyVerification('client', true, null, duration);

        return {
          valid: true,
          name: record.name,
          scopes: record.scopes || [],
          id: record.id
        };
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    metrics.recordApiKeyVerification('client', false, 'not_found', duration);
    return { valid: false, reason: 'not_found' };
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    metrics.recordApiKeyVerification('client', false, 'error', duration);
    throw error;
  }
}

module.exports = {
  getActiveServiceKey,
  verifyServiceApiKey,
  listApiKeys,
  getApiKeyByService,
  verifyClientApiKey
};
