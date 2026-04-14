const crypto = require('crypto');
const shared = require('@notely/shared');

const { isAdmin } = shared.constants.roles;
const stateService = require('./desktopAuthStateService');
const desktopSessionModel = require('../models/desktopSessionModel');
const authModel = require('../models/authModel');
const jwtOAuth = require('../utils/jwtOAuth');

const logger = shared.logger;

const DESKTOP_OAUTH_ENABLED =
  String(process.env.AUTH_ENABLE_DESKTOP_OAUTH || '').toLowerCase() === 'true';
const LOGIN_TEMPLATE_VERSION = process.env.AUTH_DESKTOP_LOGIN_TEMPLATE_VERSION || '2025-10-21';
const DEFAULT_SCOPE = process.env.AUTH_DESKTOP_DEFAULT_SCOPE || 'openid offline_access email profile';

function isDesktopOAuthEnabled() {
  return DESKTOP_OAUTH_ENABLED;
}

function normalizeLoginParams(query) {
  const {
    client: clientId = 'desktop',
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope = DEFAULT_SCOPE
  } = query;

  const errors = [];

  if (!redirectUri) {
    errors.push('Missing redirect_uri');
  } else if (!redirectUri.startsWith('notely://auth/callback')) {
    errors.push('redirect_uri is not allowed');
  }

  if (!state || typeof state !== 'string') {
    errors.push('State parameter is required');
  } else if (state.length < 8 || state.length > 128) {
    errors.push('State parameter length is invalid');
  }

  if (!codeChallenge) {
    errors.push('code_challenge is required');
  } else if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    errors.push('code_challenge must be 43 characters (base64url)');
  }

  if (!codeChallengeMethod) {
    errors.push('code_challenge_method is required');
  } else if (codeChallengeMethod !== 'S256') {
    errors.push('Only S256 code_challenge_method is supported');
  }

  if (!clientId) {
    errors.push('client parameter is required');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: errors[0],
      details: errors
    };
  }

  return {
    valid: true,
    params: {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      scope
    }
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLoginPlaceholder(params, options) {
  const { state, codeChallenge, redirectUri, clientId, scope } = params;
  const { ready } = options;

  const message = ready
    ? 'The new Notely OAuth experience is initializing.'
    : 'Desktop OAuth is not enabled for this environment yet.';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Notely Desktop OAuth</title>
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        margin: 0;
        background: #101623;
        color: #f0f4ff;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .card {
        width: 92%;
        max-width: 440px;
        background: rgba(19, 26, 41, 0.92);
        border-radius: 16px;
        padding: 32px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      }
      h1 {
        font-size: 1.6rem;
        margin: 0 0 16px;
      }
      p {
        line-height: 1.5;
        margin-bottom: 16px;
      }
      code {
        font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 0.825rem;
        background: rgba(255, 255, 255, 0.06);
        padding: 2px 6px;
        border-radius: 4px;
        display: inline-block;
        margin-bottom: 4px;
      }
      .meta {
        margin-top: 24px;
        font-size: 0.75rem;
        opacity: 0.7;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Desktop OAuth Setup</h1>
      <p>${escapeHtml(message)}</p>
      <p>
        If you expected the Microsoft login page, verify that the
        <code>NOTELY_ENABLE_V3_OAUTH</code> flag is enabled in the desktop app
        and that <code>AUTH_ENABLE_DESKTOP_OAUTH</code> is true on the auth service.
      </p>
      <div class="meta">
        <div>State: ${escapeHtml(state.substring(0, 8))}&hellip;</div>
        <div>Client: ${escapeHtml(clientId)}</div>
        <div>Scope: ${escapeHtml(scope)}</div>
        <div>Redirect: ${escapeHtml(redirectUri)}</div>
        <div>Challenge: ${escapeHtml(codeChallenge.substring(0, 8))}&hellip;</div>
        <div>Template: ${escapeHtml(LOGIN_TEMPLATE_VERSION)}</div>
      </div>
    </div>
  </body>
</html>`;
}

function notReadyResponse(operation, enabled) {
  const status = enabled ? 501 : 503;
  const reason = enabled ? 'not_implemented' : 'feature_disabled';
  const message = enabled
    ? `${operation} is not implemented yet.`
    : 'Desktop OAuth flow is disabled for this environment.';

  return {
    status,
    body: {
      success: false,
      error: reason,
      message,
      retryable: enabled,
      operation
    }
  };
}

/**
 * Verify PKCE code challenge
 * @param {string} codeVerifier - Code verifier from client
 * @param {string} codeChallenge - Code challenge from authorization request
 * @returns {boolean} True if valid
 */
function verifyPkceChallenge(codeVerifier, codeChallenge) {
  // Compute SHA256 hash of code verifier
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  // Base64url encode (no padding)
  const computedChallenge = hash.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return computedChallenge === codeChallenge;
}

async function prepareLoginPage(query, context = {}) {
  const validation = normalizeLoginParams(query || {});

  if (!validation.valid) {
    const payload = {
      type: 'html',
      status: 400,
      content: renderLoginPlaceholder(
        {
          clientId: query.client || 'desktop',
          redirectUri: query.redirect_uri || 'notely://auth/callback',
          state: query.state || crypto.randomBytes(16).toString('hex'),
          codeChallenge: query.code_challenge || 'invalid',
          scope: query.scope || DEFAULT_SCOPE
        },
        { ready: false }
      ),
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline';"
      }
    };
    return payload;
  }

  const { params } = validation;
  const enabled = isDesktopOAuthEnabled();

  if (enabled) {
    await stateService.storeState({
      state: params.state,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      redirectUri: params.redirectUri,
      clientId: params.clientId,
      scope: params.scope,
      ip: context.ip,
      userAgent: context.userAgent,
      createdAt: new Date().toISOString()
    });

    logger.info('Desktop OAuth state cached', {
      state: params.state.substring(0, 8) + '...',
      clientId: params.clientId,
      ip: context.ip
    });
  } else {
    logger.warn('Desktop OAuth login requested while feature disabled', {
      state: params.state.substring(0, 8) + '...',
      ip: context.ip
    });
  }

  return {
    type: 'html',
    status: enabled ? 200 : 503,
    content: renderLoginPlaceholder(params, { ready: enabled }),
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline';",
      'X-Notely-Desktop-OAuth': enabled ? 'enabled' : 'disabled'
    }
  };
}

/**
 * Handle OAuth authorization request
 * This is called after user authenticates (e.g., via Microsoft OAuth)
 */
async function handleAuthorizeRequest(body) {
  if (!isDesktopOAuthEnabled()) {
    return notReadyResponse('authorize', false);
  }

  // TODO: Implement full OAuth authorization flow
  // This would handle:
  // 1. User already authenticated (session exists)
  // 2. Generate authorization code
  // 3. Store code with state
  // 4. Redirect back to desktop app

  // For now, return not implemented
  // This will be implemented in Phase 2 when we add Microsoft OAuth integration
  return notReadyResponse('authorize', true);
}

/**
 * Exchange authorization code for tokens
 * POST /api/desktop-auth/token
 */
async function exchangeAuthorizationCode(body) {
  if (!isDesktopOAuthEnabled()) {
    return notReadyResponse('token_exchange', false);
  }

  const {
    grant_type: grantType,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    client_id: clientId = 'desktop',
    // Direct credentials for development/testing
    email,
    password,
    device_id: deviceId,
    device_name: deviceName
  } = body;

  try {
    // Validate grant type
    if (grantType !== 'authorization_code' && grantType !== 'password') {
      return {
        status: 400,
        body: {
          error: 'unsupported_grant_type',
          error_description: 'Only authorization_code and password grant types are supported'
        }
      };
    }

    let user;

    // Handle password grant (direct login for development)
    if (grantType === 'password') {
      if (!email || !password) {
        return {
          status: 400,
          body: {
            error: 'invalid_request',
            error_description: 'email and password are required for password grant'
          }
        };
      }

      // Authenticate user
      user = await authModel.getUserByEmail(email);
      if (!user) {
        logger.warn('Desktop token exchange failed: user not found', { email });
        return {
          status: 401,
          body: {
            error: 'invalid_grant',
            error_description: 'Invalid email or password'
          }
        };
      }

      // Verify password (note: authModel stores as password_hash)
      const bcrypt = require('bcryptjs');
      const passwordValid = await bcrypt.compare(password, user.password_hash);
      if (!passwordValid) {
        logger.warn('Desktop token exchange failed: invalid password', { email });
        return {
          status: 401,
          body: {
            error: 'invalid_grant',
            error_description: 'Invalid email or password'
          }
        };
      }

      logger.info('Desktop OAuth using password grant', { email, clientId });
    }
    // Handle authorization_code grant (PKCE flow)
    else {
      // Validate required parameters
      if (!code || !codeVerifier || !redirectUri) {
        return {
          status: 400,
          body: {
            error: 'invalid_request',
            error_description: 'Missing required parameters: code, code_verifier, redirect_uri'
          }
        };
      }

      // Consume authorization code state
      const stateData = await stateService.consumeStateByAlias(code);

      if (!stateData) {
        logger.warn('Desktop token exchange failed: invalid or expired authorization code', {
          code: code.substring(0, 8) + '...'
        });
        return {
          status: 400,
          body: {
            error: 'invalid_grant',
            error_description: 'Authorization code is invalid or has expired'
          }
        };
      }

      // Verify redirect URI matches
      if (stateData.redirectUri !== redirectUri) {
        logger.warn('Desktop token exchange failed: redirect_uri mismatch', {
          expected: stateData.redirectUri,
          provided: redirectUri
        });
        return {
          status: 400,
          body: {
            error: 'invalid_grant',
            error_description: 'redirect_uri does not match authorization request'
          }
        };
      }

      // Verify PKCE challenge
      const challengeValid = verifyPkceChallenge(codeVerifier, stateData.codeChallenge);

      if (!challengeValid) {
        logger.warn('Desktop token exchange failed: PKCE verification failed', {
          code: code.substring(0, 8) + '...'
        });
        return {
          status: 400,
          body: {
            error: 'invalid_grant',
            error_description: 'PKCE verification failed'
          }
        };
      }

      // Retrieve the user that was associated with this authorization state
      // during handleAuthorizeRequest. If the state lookup is not yet wired up,
      // refuse the token exchange rather than falling back to a hardcoded account.
      logger.error('Desktop token exchange failed: state-to-user mapping not implemented');
      return {
        status: 501,
        body: {
          error: 'server_error',
          error_description: 'Desktop OAuth state-to-user mapping is not implemented in this build'
        }
      };

      logger.info('Desktop OAuth using authorization_code grant', {
        userId: user.id,
        clientId
      });
    }

    // Generate tokens
    const userPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name
    };

    const accessTokenResult = jwtOAuth.generateAccessToken(userPayload);
    const refreshTokenResult = jwtOAuth.generateRefreshToken(userPayload);

    // Create desktop session
    const session = await desktopSessionModel.createDesktopSession({
      userId: user.id,
      accessToken: accessTokenResult.token,
      refreshToken: refreshTokenResult.token,
      accessExpiresAt: new Date(accessTokenResult.expiresAt),
      refreshExpiresAt: new Date(refreshTokenResult.expiresAt),
      deviceId: deviceId || crypto.randomUUID(),
      deviceName: deviceName || 'Desktop Client'
    });

    logger.info('Desktop token exchange successful', {
      userId: user.id,
      sessionId: session.id,
      deviceId: session.deviceId
    });

    // Return OAuth2 token response
    return {
      status: 200,
      body: {
        access_token: accessTokenResult.token,
        token_type: 'Bearer',
        expires_in: jwtOAuth.ACCESS_TOKEN_EXPIRES_IN,
        refresh_token: refreshTokenResult.token,
        scope: isAdmin(userPayload.role) ? 'admin sync:read sync:write' : 'sync:read sync:write',
        // Additional fields for desktop client
        access_expires_at: accessTokenResult.expiresAt,
        refresh_expires_at: refreshTokenResult.expiresAt,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role
        }
      }
    };
  } catch (error) {
    logger.error('Desktop token exchange error', {
      error: error.message,
      stack: error.stack
    });

    return {
      status: 500,
      body: {
        error: 'server_error',
        error_description: 'An error occurred during token exchange'
      }
    };
  }
}

/**
 * Refresh desktop session tokens
 * POST /api/desktop-auth/refresh
 */
async function refreshDesktopSession(body) {
  if (!isDesktopOAuthEnabled()) {
    return notReadyResponse('refresh', false);
  }

  const {
    grant_type: grantType,
    refresh_token: refreshToken,
    client_id: clientId = 'desktop'
  } = body;

  try {
    // Validate grant type
    if (grantType !== 'refresh_token') {
      return {
        status: 400,
        body: {
          error: 'unsupported_grant_type',
          error_description: 'Only refresh_token grant type is supported'
        }
      };
    }

    // Validate refresh token presence
    if (!refreshToken) {
      return {
        status: 400,
        body: {
          error: 'invalid_request',
          error_description: 'Missing refresh_token parameter'
        }
      };
    }

    // Verify refresh token JWT
    let refreshPayload;
    try {
      refreshPayload = jwtOAuth.verifyToken(refreshToken, {
        audience: 'notely-auth' // Refresh tokens only valid for auth service
      });
    } catch (error) {
      logger.warn('Desktop refresh failed: invalid refresh token', {
        error: error.message
      });
      return {
        status: 401,
        body: {
          error: 'invalid_grant',
          error_description: 'Invalid or expired refresh token'
        }
      };
    }

    // Validate token type
    if (refreshPayload.tokenType !== 'refresh') {
      logger.warn('Desktop refresh failed: wrong token type', {
        tokenType: refreshPayload.tokenType
      });
      return {
        status: 401,
        body: {
          error: 'invalid_grant',
          error_description: 'Token is not a refresh token'
        }
      };
    }

    // Find session by refresh token
    const session = await desktopSessionModel.findSessionByRefreshToken(refreshToken);

    if (!session) {
      logger.warn('Desktop refresh failed: session not found', {
        userId: refreshPayload.userId
      });
      return {
        status: 401,
        body: {
          error: 'invalid_grant',
          error_description: 'Refresh token not found or expired'
        }
      };
    }

    // Get user data
    const user = await authModel.getUserById(session.userId);

    if (!user) {
      logger.error('Desktop refresh failed: user not found', {
        userId: session.userId
      });
      return {
        status: 401,
        body: {
          error: 'invalid_grant',
          error_description: 'User not found'
        }
      };
    }

    // Generate new tokens
    const userPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name
    };

    const newAccessTokenResult = jwtOAuth.generateAccessToken(userPayload);
    const newRefreshTokenResult = jwtOAuth.generateRefreshToken(userPayload);

    // Update access token session in database (required for gateway introspection)
    try {
      await authModel.updateSessionById(
        session.id,
        newAccessTokenResult.token,
        new Date(newAccessTokenResult.expiresAt)
      );
    } catch (error) {
      logger.warn('Failed to update access token session', {
        error: error.message,
        sessionId: session.id,
        userId: user.id
      });
    }

    // Rotate refresh token
    await desktopSessionModel.rotateRefreshToken(
      session.id,
      newRefreshTokenResult.token,
      new Date(newRefreshTokenResult.expiresAt),
      refreshToken
    );

    logger.info('Desktop token refresh successful', {
      userId: user.id,
      sessionId: session.id,
      deviceId: session.deviceId
    });

    // Return new tokens
    return {
      status: 200,
      body: {
        access_token: newAccessTokenResult.token,
        token_type: 'Bearer',
        expires_in: jwtOAuth.ACCESS_TOKEN_EXPIRES_IN,
        refresh_token: newRefreshTokenResult.token,
        scope: isAdmin(userPayload.role) ? 'admin sync:read sync:write' : 'sync:read sync:write',
        access_expires_at: newAccessTokenResult.expiresAt,
        refresh_expires_at: newRefreshTokenResult.expiresAt
      }
    };
  } catch (error) {
    logger.error('Desktop token refresh error', {
      error: error.message,
      stack: error.stack
    });

    return {
      status: 500,
      body: {
        error: 'server_error',
        error_description: 'An error occurred during token refresh'
      }
    };
  }
}

/**
 * Logout desktop session
 * POST /api/desktop-auth/logout
 */
async function logoutDesktopSession(body) {
  if (!isDesktopOAuthEnabled()) {
    return notReadyResponse('logout', false);
  }

  const { token, refresh_token: refreshToken } = body;

  try {
    if (refreshToken) {
      // Find and revoke session by refresh token
      const session = await desktopSessionModel.findSessionByRefreshToken(refreshToken);

      if (session) {
        await desktopSessionModel.revokeSession(session.id, 'logout');
        logger.info('Desktop session logged out', {
          sessionId: session.id,
          userId: session.userId
        });
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        message: 'Logged out successfully'
      }
    };
  } catch (error) {
    logger.error('Desktop logout error', {
      error: error.message
    });

    return {
      status: 500,
      body: {
        error: 'server_error',
        error_description: 'An error occurred during logout'
      }
    };
  }
}

/**
 * Validate desktop session
 * POST /api/desktop-auth/validate-session
 */
async function validateDesktopSession(body) {
  if (!isDesktopOAuthEnabled()) {
    return notReadyResponse('validate_session', false);
  }

  const { access_token: accessToken } = body;

  try {
    if (!accessToken) {
      return {
        status: 400,
        body: {
          error: 'invalid_request',
          error_description: 'Missing access_token parameter'
        }
      };
    }

    // Verify JWT
    const payload = jwtOAuth.verifyToken(accessToken);

    return {
      status: 200,
      body: {
        valid: true,
        user: {
          id: payload.userId,
          email: payload.email,
          role: payload.role
        },
        exp: payload.exp
      }
    };
  } catch (error) {
    return {
      status: 200,
      body: {
        valid: false,
        error: error.message
      }
    };
  }
}

module.exports = {
  prepareLoginPage,
  handleAuthorizeRequest,
  exchangeAuthorizationCode,
  refreshDesktopSession,
  logoutDesktopSession,
  validateDesktopSession,
  normalizeLoginParams,
  isDesktopOAuthEnabled,
  dependencies: {
    stateService,
    desktopSessionModel
  }
};
