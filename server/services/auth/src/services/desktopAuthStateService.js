const shared = require('@notely/shared');

const cache = shared.cache;
const logger = shared.logger;

const CACHE_PREFIX = 'desktop_oauth_state:';
const ALIAS_PREFIX = `${CACHE_PREFIX}alias:`;
const STATE_TTL_SECONDS = parseInt(process.env.AUTH_DESKTOP_STATE_TTL_SECONDS || '600', 10);

function buildCacheKey(state) {
  return `${CACHE_PREFIX}${state}`;
}

function buildAliasKey(alias) {
  return `${ALIAS_PREFIX}${alias}`;
}

async function storeState(params) {
  const data = {
    state: params.state,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    redirectUri: params.redirectUri,
    clientId: params.clientId,
    scope: params.scope,
    ip: params.ip,
    userAgent: params.userAgent,
    createdAt: params.createdAt || new Date().toISOString()
  };

  const ttlSeconds = Number.isFinite(params.ttlSeconds) ? params.ttlSeconds : STATE_TTL_SECONDS;

  if (params.codeVerifier) {
    data.codeVerifier = params.codeVerifier;
  }

  if (params.oidcInteractionUid) {
    data.oidcInteractionUid = params.oidcInteractionUid;
  }

  if (params.oidcState) {
    data.oidcState = params.oidcState;
  }

  if (params.microsoftState) {
    data.microsoftState = params.microsoftState;
  }

  if (params.returnTo) {
    data.returnTo = params.returnTo;
  }

  if (params.requestedRedirectUri) {
    data.requestedRedirectUri = params.requestedRedirectUri;
  }

  if (params.microsoftRedirectUri) {
    data.microsoftRedirectUri = params.microsoftRedirectUri;
  }

  if (params.provider) {
    data.provider = params.provider;
  }

  if (params.clientMetadata) {
    data.clientMetadata = params.clientMetadata;
  }

  const aliases = Array.isArray(params.aliases) ? [...new Set(params.aliases.filter(Boolean))] : [];
  if (aliases.length > 0) {
    data.aliases = aliases;
  }

  await cache.setCache(buildCacheKey(params.state), data, ttlSeconds);

  if (aliases.length > 0) {
    await Promise.all(
      aliases.map((alias) => cache.setCache(buildAliasKey(alias), { state: params.state }, ttlSeconds))
    );
  }
}

async function getState(state) {
  const payload = await cache.getCache(buildCacheKey(state));
  return payload || null;
}

async function getStateByAlias(alias) {
  const mapping = await cache.getCache(buildAliasKey(alias));

  if (!mapping?.state) {
    return null;
  }

  return getState(mapping.state);
}

async function consumeState(state) {
  const payload = await getState(state);

  if (!payload) {
    return null;
  }

  await cache.deleteCache(buildCacheKey(state));

  const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
  if (aliases.length > 0) {
    await Promise.all(aliases.map((alias) => cache.deleteCache(buildAliasKey(alias))));
  }

  return payload;
}

async function consumeStateByAlias(alias) {
  const mapping = await cache.getCache(buildAliasKey(alias));

  if (!mapping?.state) {
    return null;
  }

  await cache.deleteCache(buildAliasKey(alias));
  return consumeState(mapping.state);
}

async function deleteState(state) {
  const payload = await getState(state);

  await cache.deleteCache(buildCacheKey(state));

  const aliases = Array.isArray(payload?.aliases) ? payload.aliases : [];
  if (aliases.length > 0) {
    await Promise.all(aliases.map((alias) => cache.deleteCache(buildAliasKey(alias))));
  }
}

async function clearAllStates() {
  logger.warn('clearAllStates not implemented for desktop OAuth state store');
}

module.exports = {
  storeState,
  getState,
  getStateByAlias,
  consumeState,
  consumeStateByAlias,
  deleteState,
  clearAllStates,
  constants: {
    STATE_TTL_SECONDS,
    CACHE_PREFIX,
    ALIAS_PREFIX
  }
};
