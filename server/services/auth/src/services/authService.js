const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const shared = require('@notely/shared');

const { isAdmin: isAdminRole } = shared.constants.roles;
const logger = shared.logger;
const authModel = require('../models/authModel');
const keyManager = require('../utils/keyManager');
const { validatePassword, DEFAULT_REQUIREMENTS } = require('../utils/passwordValidator');

const USER_JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const SERVICE_TOKEN_EXPIRES_IN = process.env.SERVICE_TOKEN_EXPIRES_IN || '5m';

const eventPublisher = require('./eventPublisher');

async function login(email, password, context = {}) {
  try {
    const user = await authModel.getUserByEmail(email);

    if (!user) {
      await eventPublisher.publishLoginFailure({
        email,
        ip: context.ip,
        userAgent: context.userAgent,
        reason: 'user_not_found'
      });
      return { success: false, message: 'Invalid email or password' };
    }

    // Check if local login is enabled (admin users bypass this check)
    const isAdmin = isAdminRole(user.role);
    if (!isAdmin) {
      const securityConfig = await authModel.getSecurityConfig();
      const localLoginEnabled = securityConfig?.localLoginEnabled !== false; // Default to true if not set

      if (!localLoginEnabled) {
        await eventPublisher.publishLoginFailure({
          email,
          ip: context.ip,
          userAgent: context.userAgent,
          reason: 'local_login_disabled'
        });
        return {
          success: false,
          message: 'Local login is disabled. Please sign in with Microsoft.',
          code: 'LOCAL_LOGIN_DISABLED'
        };
      }
    }

    if (!user.password_hash) {
      await eventPublisher.publishLoginFailure({
        email,
        ip: context.ip,
        userAgent: context.userAgent,
        reason: 'no_password_set'
      });
      return { success: false, message: 'Invalid email or password' };
    }

    const passwordValid = bcrypt.compareSync(password, user.password_hash);

    if (!passwordValid) {
      await eventPublisher.publishLoginFailure({
        email,
        ip: context.ip,
        userAgent: context.userAgent,
        reason: 'invalid_credentials'
      });
      return { success: false, message: 'Invalid email or password' };
    }

    if (!user.email_verified) {
      return {
        success: false,
        message: 'Please verify your email address before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email
      };
    }

    const domainUserId = user.user_id || user.id;
    const userPayload = buildUserPayload(domainUserId, user.email, user.role, {
      firstName: user.first_name,
      lastName: user.last_name
    });

    const token = signJwt(userPayload, { expiresIn: USER_JWT_EXPIRES_IN });
    const expiresAt = computeExpiryIso(USER_JWT_EXPIRES_IN);

    await authModel.createSession(user.id, token, new Date(expiresAt));

    logger.info('User logged in', { userId: domainUserId, email });

    await eventPublisher.publishLoginSuccess({
      userId: domainUserId,
      email: user.email,
      sessionToken: token,
      ip: context.ip,
      userAgent: context.userAgent
    });

    // Check if user must change password
    const mustChangePassword = user.must_change_password === true;

    return {
      success: true,
      token,
      expiresAt,
      scopes: userPayload.scopes,
      mustChangePassword,
      user: {
        id: domainUserId,
        credentialId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        scopes: userPayload.scopes
      }
    };
  } catch (error) {
    logger.error('Login error', { error: error.message, email });
    throw error;
  }
}

async function verifyUserCredentials(email, password) {
  const user = await authModel.getUserByEmail(email);

  if (!user) {
    return { success: false, message: 'Invalid email or password' };
  }

  if (!user.password_hash) {
    return { success: false, message: 'Invalid email or password' };
  }

  const passwordValid = bcrypt.compareSync(password, user.password_hash);
  if (!passwordValid) {
    return { success: false, message: 'Invalid email or password' };
  }

  if (!user.is_active) {
    return { success: false, message: 'Account is inactive' };
  }

  if (!user.email_verified) {
    return { success: false, message: 'Email address has not been verified yet' };
  }

  return {
    success: true,
    accountId: user.id,
    user: {
      id: user.user_id || user.id,
      credentialId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role
    }
  };
}

async function logout(token) {
  try {
    await authModel.deleteSession(token);
    return { success: true };
  } catch (error) {
    logger.error('Logout error', { error: error.message });
    throw error;
  }
}

async function refreshToken(oldToken) {
  try {
    const decoded = verifyJwt(oldToken, { ignoreExpiration: true });
    const session = await authModel.getSession(oldToken);

    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    const basePayload = buildUserPayload(
      decoded.userId || decoded.sub,
      decoded.email,
      decoded.role,
      { scopes: decoded.scopes || [] }
    );

    const newToken = signJwt(basePayload, { expiresIn: USER_JWT_EXPIRES_IN });
    const expiresAt = computeExpiryIso(USER_JWT_EXPIRES_IN);

    await authModel.updateSession(oldToken, newToken, new Date(expiresAt));

    return {
      success: true,
      token: newToken,
      expiresAt,
      scopes: basePayload.scopes
    };
  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    return { success: false, message: 'Invalid or expired token' };
  }
}

async function validateToken(token) {
  try {
    const payload = verifyJwt(token);

    if (payload.tokenType !== 'user') {
      return { valid: false, message: 'Unsupported token type' };
    }

    const session = await authModel.getSession(token);

    if (!session) {
      return { valid: false, message: 'Session not found' };
    }

    if (new Date(session.expires_at) < new Date()) {
      await authModel.deleteSession(token);
      return { valid: false, message: 'Session expired' };
    }

    return {
      valid: true,
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      scopes: payload.scopes || []
    };
  } catch (error) {
    logger.error('Token validation error', { error: error.message });
    return { valid: false, message: 'Invalid token' };
  }
}

async function generateServiceToken(serviceName, allowedScopes = [], requestedScopes = []) {
  const resolvedScopes = selectServiceScopes(allowedScopes || [], requestedScopes || []);

  const payload = {
    tokenType: 'service',
    sub: serviceName,
    serviceName,
    scopes: resolvedScopes,
    aud: 'notely-internal'
  };

  const token = signJwt(payload, { expiresIn: SERVICE_TOKEN_EXPIRES_IN });
  const expiresAt = computeExpiryIso(SERVICE_TOKEN_EXPIRES_IN);

  logger.info('Service token minted', { serviceName, scopes: resolvedScopes });

  return {
    token,
    scopes: resolvedScopes,
    expiresAt
  };
}

async function verifyServiceToken(token) {
  try {
    const payload = verifyJwt(token);

    if (payload.tokenType !== 'service') {
      return { valid: false, reason: 'invalid_token_type' };
    }

    return {
      valid: true,
      serviceName: payload.serviceName,
      scopes: payload.scopes || [],
      exp: payload.exp
    };
  } catch (error) {
    const reason = error.name === 'TokenExpiredError' ? 'expired' : 'invalid';
    return { valid: false, reason };
  }
}

async function introspectToken(token) {
  try {
    const payload = verifyJwt(token, { ignoreExpiration: true });

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return {
        active: false,
        tokenType: payload.tokenType,
        reason: 'expired'
      };
    }

    if (payload.tokenType === 'service') {
      return {
        active: true,
        tokenType: 'service',
        serviceName: payload.serviceName,
        scopes: payload.scopes || [],
        exp: payload.exp,
        iat: payload.iat
      };
    }

    if (payload.tokenType === 'user') {
      const session = await authModel.getSession(token);

      if (!session) {
        return {
          active: false,
          tokenType: 'user',
          reason: 'session_not_found'
        };
      }

      if (new Date(session.expires_at) < new Date()) {
        await authModel.deleteSession(token);
        return {
          active: false,
          tokenType: 'user',
          reason: 'session_expired'
        };
      }

      return {
        active: true,
        tokenType: 'user',
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        scopes: payload.scopes || [],
        exp: payload.exp,
        iat: payload.iat
      };
    }

    return {
      active: false,
      tokenType: payload.tokenType,
      reason: 'unknown_token_type'
    };
  } catch (error) {
    logger.warn('Token introspection failed', { error: error.message });
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return { active: false, reason: error.name.toLowerCase() };
    }

    throw error;
  }
}

function verifyJwt(token, options = {}) {
  const { publicKeyPem, algorithm } = keyManager.getVerificationKey();
  return jwt.verify(token, publicKeyPem, {
    algorithms: [algorithm],
    ...options
  });
}

function signJwt(payload, { expiresIn } = {}) {
  const { privateKeyPem, kid, algorithm } = keyManager.getSigningKey();
  return jwt.sign(payload, privateKeyPem, {
    algorithm,
    expiresIn: expiresIn || USER_JWT_EXPIRES_IN,
    keyid: kid
  });
}

function scopesForRole(role) {
  if (!role) {
    return [];
  }

  if (role.toLowerCase() === 'admin') {
    return ['*'];
  }

  return ['user:basic'];
}

function buildUserPayload(userId, email, role, overrides = {}) {
  // Support multiple audiences for cross-service token usage
  const defaultAudiences = ['notely-api', 'sync-service'];

  return {
    tokenType: 'user',
    sub: userId,
    userId,
    email,
    role,
    scopes: overrides.scopes || scopesForRole(role),
    aud: overrides.aud || defaultAudiences,
    ...overrides
  };
}

function selectServiceScopes(allowedScopes, requestedScopes) {
  if (!Array.isArray(allowedScopes)) {
    return [];
  }

  if (allowedScopes.includes('*')) {
    return Array.isArray(requestedScopes) && requestedScopes.length > 0
      ? Array.from(new Set(requestedScopes))
      : ['*'];
  }

  if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
    return Array.from(new Set(allowedScopes));
  }

  const allowedSet = new Set(allowedScopes);
  return Array.from(new Set(requestedScopes.filter(scope => allowedSet.has(scope))));
}

function computeExpiryIso(expiryExpression) {
  const expiresAt = new Date(Date.now() + parseExpiry(expiryExpression));
  return expiresAt.toISOString();
}

function parseExpiry(expiry) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = typeof expiry === 'string' ? expiry.match(/^(\d+)([smhd])$/) : null;

  if (!match) {
    throw new Error(`Invalid expiry format: ${expiry}`);
  }

  const [, value, unit] = match;
  return parseInt(value, 10) * units[unit];
}

/**
 * Change user password with validation
 * @param {string} credentialId - The user's credential ID
 * @param {string} currentPassword - Current password for verification
 * @param {string} newPassword - New password to set
 * @returns {Promise<object>} - Result with success status
 */
async function changePassword(credentialId, currentPassword, newPassword) {
  try {
    // Get user by credential ID (with password hash for verification)
    const user = await authModel.getUserByIdWithPassword(credentialId);

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    if (!user.password_hash) {
      return { success: false, message: 'No password set for this account' };
    }

    // Verify current password
    const passwordValid = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!passwordValid) {
      return { success: false, message: 'Current password is incorrect' };
    }

    // Get password requirements from security config
    const securityConfig = await authModel.getSecurityConfig();
    const requirements = securityConfig?.passwordComplexity || DEFAULT_REQUIREMENTS;

    // Validate new password
    const validation = validatePassword(newPassword, requirements);
    if (!validation.valid) {
      return {
        success: false,
        message: 'Password does not meet requirements',
        errors: validation.errors,
        checks: validation.checks
      };
    }

    // Check that new password is different from current
    if (bcrypt.compareSync(newPassword, user.password_hash)) {
      return { success: false, message: 'New password must be different from current password' };
    }

    // Hash new password
    const newPasswordHash = bcrypt.hashSync(newPassword, 10);

    // Update password in database
    const updatedUser = await authModel.changePassword(credentialId, newPasswordHash);

    if (!updatedUser) {
      return { success: false, message: 'Failed to update password' };
    }

    logger.info('User password changed successfully', { credentialId, email: user.email });

    return {
      success: true,
      message: 'Password changed successfully'
    };
  } catch (error) {
    logger.error('Password change error', { error: error.message, credentialId });
    throw error;
  }
}

/**
 * Get public security settings (only what unauthenticated pages need)
 * Only returns localLoginEnabled - password complexity is not exposed publicly.
 * @returns {Promise<object>} - Minimal security configuration
 */
async function getSecuritySettings() {
  try {
    const securityConfig = await authModel.getSecurityConfig();

    return {
      localLoginEnabled: securityConfig?.localLoginEnabled !== false
    };
  } catch (error) {
    logger.error('Error fetching security settings', { error: error.message });
    return {
      localLoginEnabled: true
    };
  }
}

module.exports = {
  login,
  verifyUserCredentials,
  logout,
  refreshToken,
  validateToken,
  generateServiceToken,
  verifyServiceToken,
  introspectToken,
  changePassword,
  getSecuritySettings
};
