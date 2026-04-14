const shared = require('@notely/shared');
const authModel = require('../models/authModel');
const eventPublisher = require('../services/eventPublisher');
const signupPolicy = require('../services/signupPolicy');
const registrationService = require('../services/registrationService');

const logger = shared.logger.child({ module: 'oidc-microsoft-account' });

function extractEmail(profile) {
  const candidates = [
    profile?.mail,
    profile?.userPrincipalName,
    profile?.email,
    profile?.preferred_username
  ].filter(Boolean);

  const email = candidates.find((value) => typeof value === 'string' && value.includes('@'));
  return email ? email.trim().toLowerCase() : null;
}

function extractNameParts(profile) {
  const primaryFirst = typeof profile?.givenName === 'string' ? profile.givenName.trim() : null;
  const altFirst = typeof profile?.firstName === 'string' ? profile.firstName.trim() : null;
  const primaryLast = typeof profile?.surname === 'string' ? profile.surname.trim() : null;
  const altLast = typeof profile?.lastName === 'string' ? profile.lastName.trim() : null;

  const firstName = primaryFirst || altFirst || null;
  const lastName = primaryLast || altLast || null;

  if (firstName || lastName) {
    return { firstName, lastName };
  }

  const displayName = profile?.displayName || '';
  if (!displayName) {
    return { firstName: null, lastName: null };
  }

  const parts = displayName.split(' ').filter(Boolean);
  if (parts.length === 0) {
    return { firstName: displayName, lastName: null };
  }

  if (parts.length === 1) {
    return { firstName: parts[0].trim() || null, lastName: null };
  }

  return {
    firstName: parts[0].trim() || null,
    lastName: parts.slice(1).join(' ').trim() || null
  };
}

async function ensureAuthUserFromProfile(profile, { ipAddress, betaToken } = {}) {
  const email = extractEmail(profile);
  if (!email) {
    throw new Error('Unable to determine email address from Microsoft profile');
  }

  const { firstName, lastName } = extractNameParts(profile);

  const existing = await authModel.getUserByEmail(email);

  if (existing) {
    if (!existing.is_active) {
      throw new Error('This account has been disabled. Please contact your administrator.');
    }

    const updated = await authModel.updateUserFromOAuth({
      userId: existing.id,
      firstName,
      lastName,
      emailVerified: true
    });

    return updated || existing;
  }

  // User doesn't exist - check beta token OR signup policy
  let validatedBetaSignup = null;

  if (betaToken) {
    try {
      validatedBetaSignup = await registrationService.validateBetaToken(betaToken);
      if (validatedBetaSignup) {
        // Verify email matches the beta invitation
        if (validatedBetaSignup.email.toLowerCase() !== email.toLowerCase()) {
          throw new shared.errors.ForbiddenError(
            'Beta invitation email does not match your Microsoft account email'
          );
        }
        logger.info('Beta token validated for OAuth signup', { email });
      }
    } catch (error) {
      // Re-throw ForbiddenError (email mismatch)
      if (error.name === 'ForbiddenError') {
        throw error;
      }
      logger.warn('Beta token validation failed', { error: error.message });
      // Fall through to normal signup policy check
    }
  }

  // If no valid beta token, check signup policy (with invitation bypass)
  let signedUpViaInvitationBypass = false;
  if (!validatedBetaSignup) {
    const signupsEnabled = await signupPolicy.areSignupsEnabled();

    if (!signupsEnabled) {
      // Check if email has a beta invitation
      const hasInvitation = await registrationService.checkEmailHasInvitation(email);

      if (!hasInvitation) {
        logger.info('Sign-ups disabled and no invitation', { email, provider: 'microsoft' });
        throw new shared.errors.ForbiddenError('Sign-ups are currently disabled');
      }

      logger.info('Sign-ups disabled but email has invitation', { email, provider: 'microsoft' });
      signedUpViaInvitationBypass = true;
    }
  }

  // Use first/last name from beta signup if available and profile doesn't have them
  const finalFirstName = firstName || (validatedBetaSignup ? validatedBetaSignup.firstName : null);
  const finalLastName = lastName || (validatedBetaSignup ? validatedBetaSignup.lastName : null);

  const created = await authModel.createExternalUserCredential({
    email,
    firstName: finalFirstName,
    lastName: finalLastName,
    role: process.env.MICROSOFT_DEFAULT_ROLE || 'user',
    emailVerified: true
  });

  logger.info('External Microsoft user created', {
    authUserId: created.id,
    email: created.email,
    viaBeta: !!validatedBetaSignup
  });

  // Redeem beta token if valid
  if (validatedBetaSignup && betaToken) {
    try {
      await registrationService.redeemBetaTokenInternal(betaToken, created.id, email);
      logger.info('Beta token redeemed for OAuth signup', { userId: created.id, email });
    } catch (error) {
      logger.warn('Beta token redemption failed', { error: error.message, userId: created.id });
    }
  }

  // Convert beta signup and grant license if signed up via invitation bypass
  if (signedUpViaInvitationBypass) {
    try {
      const converted = await registrationService.convertBetaSignupByEmail(email, created.id);
      if (converted) {
        logger.info('Beta license granted via invitation bypass', { userId: created.id, email });
      } else {
        logger.warn('Beta conversion via invitation bypass failed', { userId: created.id, email });
      }
    } catch (error) {
      logger.error('Error converting beta signup via invitation bypass', {
        error: error.message,
        userId: created.id,
        email
      });
    }
  }

  try {
    await eventPublisher.publishUserRegistered({
      authUserId: created.id,
      email: created.email,
      firstName: created.first_name,
      lastName: created.last_name,
      role: created.role,
      createdAt: created.created_at,
      ipAddress: ipAddress || null,
      viaBeta: !!validatedBetaSignup
    });
  } catch (error) {
    logger.warn('Failed to publish user registration event for Microsoft account', {
      error: error.message,
      authUserId: created.id
    });
  }

  return created;
}

async function ensureMicrosoftAccount({ profile, tokens, ipAddress, betaToken }) {
  const user = await ensureAuthUserFromProfile(profile, { ipAddress, betaToken });

  if (tokens?.access_token) {
    try {
      await authModel.upsertOAuthToken({
        userId: user.id,
        provider: 'microsoft',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresIn: tokens.expires_in || tokens.ext_expires_in || null,
        scope: tokens.scope || null,
        tokenType: tokens.token_type || 'Bearer'
      });
    } catch (error) {
      logger.warn('Failed to persist Microsoft OAuth tokens', {
        error: error.message,
        authUserId: user.id
      });
    }
  }

  return user;
}

module.exports = {
  ensureMicrosoftAccount
};
