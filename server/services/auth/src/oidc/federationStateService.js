const shared = require('@notely/shared');
const stateStore = require('../services/desktopAuthStateService');

const logger = shared.logger;

async function persistInteractionContext(context) {
  if (!context?.state) {
    throw new Error('OIDC state is required to persist interaction context');
  }

  const aliases = new Set(Array.isArray(context.aliases) ? context.aliases.filter(Boolean) : []);

  if (context.oidcInteractionUid) {
    aliases.add(context.oidcInteractionUid);
  }

  if (context.microsoftState) {
    aliases.add(context.microsoftState);
  }

  try {
    await stateStore.storeState({
      state: context.state,
      codeChallenge: context.codeChallenge,
      codeChallengeMethod: context.codeChallengeMethod,
      codeVerifier: context.codeVerifier,
      redirectUri: context.redirectUri,
      requestedRedirectUri: context.requestedRedirectUri,
      microsoftRedirectUri: context.microsoftRedirectUri,
      clientId: context.clientId,
      scope: context.scope,
      returnTo: context.returnTo,
      provider: context.provider || 'microsoft',
      clientMetadata: context.clientMetadata,
      oidcInteractionUid: context.oidcInteractionUid,
      oidcState: context.oidcState || context.state,
      microsoftState: context.microsoftState,
      ip: context.ip,
      userAgent: context.userAgent,
      createdAt: context.createdAt,
      aliases: [...aliases]
    });
  } catch (error) {
    logger.error('Failed to persist OIDC federation state', { error: error.message });
    throw error;
  }
}

async function getContextByInteractionUid(uid) {
  if (!uid) return null;
  return stateStore.getStateByAlias(uid);
}

async function consumeContextByMicrosoftState(msState) {
  if (!msState) return null;
  return stateStore.consumeStateByAlias(msState);
}

async function consumeContextByState(state) {
  if (!state) return null;
  return stateStore.consumeState(state);
}

module.exports = {
  persistInteractionContext,
  getContextByInteractionUid,
  consumeContextByMicrosoftState,
  consumeContextByState
};
