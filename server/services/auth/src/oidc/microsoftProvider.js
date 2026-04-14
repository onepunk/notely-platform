const axios = require('axios');
const shared = require('@notely/shared');

const logger = shared.logger;

const DEFAULT_SCOPE =
  process.env.MICROSOFT_OIDC_SCOPE ||
  'openid profile email offline_access https://graph.microsoft.com/User.Read';

function resolveTenantId() {
  return (
    process.env.MICROSOFT_TENANT ||
    process.env.MICROSOFT_TENANT_ID ||
    process.env.MICROSOFT_DIRECTORY_ID ||
    'common'
  );
}

function buildAuthorizeUrlBase() {
  return `https://login.microsoftonline.com/${resolveTenantId()}/oauth2/v2.0/authorize`;
}

function buildTokenUrl() {
  return `https://login.microsoftonline.com/${resolveTenantId()}/oauth2/v2.0/token`;
}

function getClientId() {
  return process.env.MICROSOFT_CLIENT_ID;
}

function getClientSecret() {
  return process.env.MICROSOFT_CLIENT_SECRET;
}

function getRedirectUri() {
  return process.env.OAUTH_MICROSOFT_AUTH_CALLBACK_URL || process.env.MICROSOFT_REDIRECT_URI;
}

function isConfigured() {
  return Boolean(getClientId() && getClientSecret() && getRedirectUri());
}

function buildAuthorizeUrl({ state, codeChallenge, codeChallengeMethod, redirectUri, scope, prompt, loginHint }) {
  if (!isConfigured()) {
    throw new Error('Microsoft OAuth configuration is incomplete');
  }

  if (!state || !codeChallenge) {
    throw new Error('State and code challenge are required to build authorization URL');
  }

  const url = new URL(buildAuthorizeUrlBase());
  url.searchParams.set('client_id', getClientId());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri || getRedirectUri());
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', scope || DEFAULT_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', codeChallengeMethod || 'S256');

  if (prompt) {
    url.searchParams.set('prompt', prompt);
  }

  if (loginHint) {
    url.searchParams.set('login_hint', loginHint);
  }

  return url.toString();
}

async function exchangeCodeForTokens({ code, redirectUri, codeVerifier }) {
  if (!isConfigured()) {
    throw new Error('Microsoft OAuth configuration is incomplete');
  }

  if (!code) {
    throw new Error('Authorization code is required');
  }

  const body = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    code,
    redirect_uri: redirectUri || getRedirectUri(),
    grant_type: 'authorization_code'
  });

  if (codeVerifier) {
    body.set('code_verifier', codeVerifier);
  }

  try {
    const response = await axios.post(buildTokenUrl(), body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });

    return response.data;
  } catch (error) {
    logger.error('Microsoft token exchange failed', {
      error: error.response?.data || error.message,
      status: error.response?.status
    });
    throw new Error('Failed to exchange authorization code with Microsoft');
  }
}

async function fetchUserProfile(accessToken) {
  if (!accessToken) {
    throw new Error('Access token is required to fetch Microsoft profile');
  }

  try {
    const response = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 10000
    });

    return response.data;
  } catch (error) {
    logger.error('Failed to fetch Microsoft profile', {
      error: error.response?.data || error.message,
      status: error.response?.status
    });
    throw new Error('Failed to retrieve Microsoft user profile');
  }
}

module.exports = {
  isConfigured,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchUserProfile,
  getRedirectUri,
  DEFAULT_SCOPE
};
