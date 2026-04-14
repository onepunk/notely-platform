"use strict";

const express = require('express');
const shared = require('@notely/shared');

const { isAdmin } = shared.constants.roles;
const { asyncHandler, NotFoundError, ValidationError } = shared.errors;
const metrics = require('../utils/metrics');
const profileModel = require('../models/profileModel');
const hydrateUserContext = require('../middleware/authContext');
const eventPublisher = require('../services/eventPublisher');
const notificationService = require('../services/notificationService');
const emailClient = require('../services/emailClient');

const router = express.Router();

const MAX_NAME_LENGTH = 120;
const MAX_DISPLAY_NAME_LENGTH = 255;

router.use(hydrateUserContext);

// Admin endpoint to list all users
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const startedAt = process.hrtime.bigint();

    // Check if user has admin role
    if (!isAdmin(req.user.role)) {
      throw new shared.errors.ForbiddenError('Admin access required');
    }

    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';

    const users = await profileModel.getAllUsers({ limit, offset, search });
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    metrics.observeProfileRequest(durationSeconds, 'admin_list');

    // Return just the array of users - portal expects simple array format
    res.json(users.map(user => serializeAdminUser(user)));
  })
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const authUserId = req.user.id;

    let profile = await profileModel.getProfileByAuthUserId(authUserId);

    // If profile doesn't exist yet (race condition during OAuth registration),
    // create it on-demand using auth info from gateway headers
    if (!profile) {
      try {
        await profileModel.createProfileForAuthUser({
          authUserId,
          email: req.user.email || null,
          firstName: null, // Will be populated from OAuth profile later
          lastName: null
        });
        profile = await profileModel.getProfileByAuthUserId(authUserId);
      } catch (createError) {
        // Profile might have been created by event consumer in parallel
        profile = await profileModel.getProfileByAuthUserId(authUserId);
      }
    }

    if (!profile) {
      metrics.observeProfileRequest(Number(process.hrtime.bigint() - startedAt) / 1e9, 'not_found');
      throw new NotFoundError('User profile not found');
    }

    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    metrics.observeProfileRequest(durationSeconds, 'success');

    res.json(serializeProfile(profile, req.user));
  })
);

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const authUserId = req.user.id;

    const existingProfile = await profileModel.getProfileByAuthUserId(authUserId);
    if (!existingProfile) {
      throw new NotFoundError('User profile not found');
    }

    const updates = sanitizeProfileUpdate(req.body);
    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No updatable fields provided');
    }

    const changes = computeChanges(existingProfile, updates);

    if (Object.keys(changes).length === 0) {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      metrics.observeProfileRequest(durationSeconds, 'noop');
      return res.json(serializeProfile(existingProfile, req.user));
    }

    await profileModel.updateProfile(authUserId, updates);
    const updatedProfile = await profileModel.getProfileByAuthUserId(authUserId);

    await eventPublisher.publishProfileUpdated({
      user: {
        userId: authUserId,
        email: req.user.email || updatedProfile.email,
        firstName: updatedProfile.first_name,
        lastName: updatedProfile.last_name,
        displayName: updatedProfile.display_name,
        locale: updatedProfile.locale,
        timeZone: updatedProfile.time_zone,
        preferences: updatedProfile.preferences || {}
      },
      changes
    });

    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    metrics.observeProfileRequest(durationSeconds, 'updated');

    res.json(serializeProfile(updatedProfile, req.user));
  })
);

// Admin endpoint to send a test notification email via email service
router.post(
  '/notifications/test',
  asyncHandler(async (req, res) => {
    if (!isAdmin(req.user.role)) {
      throw new shared.errors.ForbiddenError('Admin access required');
    }

    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    if (!to) {
      throw new ValidationError('Recipient email (to) is required');
    }

    const subject = req.body?.subject?.trim() || 'Notely notification test';
    const text =
      req.body?.text?.trim() ||
      'This is a test notification email from Notely to verify mail configuration.';

    const queued = await emailClient.queueRawEmail({
      to,
      subject,
      text
    });

    if (!queued) {
      return res.status(502).json({
        success: false,
        message: 'Failed to queue test email to email service'
      });
    }

    res.json({
      success: true,
      message: 'Test email queued for sending via email service',
      to
    });
  })
);

// Admin endpoint to update a user (PUT /:id)
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const { id } = req.params;

    // Check if user has admin role
    if (!isAdmin(req.user.role)) {
      throw new shared.errors.ForbiddenError('Admin access required');
    }

    // Get existing user from global_auth.user_credentials
    const existingUser = await profileModel.getUserById(id);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    // Sanitize and validate updates
    const updates = sanitizeAdminUserUpdate(req.body);
    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No updatable fields provided');
    }

    // Update auth credentials if needed (role, password, email)
    if (updates.authUpdates && Object.keys(updates.authUpdates).length > 0) {
      await profileModel.updateUserCredentials(id, updates.authUpdates);
    }

    // Update profile if needed (firstName, lastName, Teams settings)
    if (updates.profileUpdates && Object.keys(updates.profileUpdates).length > 0) {
      await profileModel.updateProfile(id, updates.profileUpdates);
    }

    // Fetch updated user
    const updatedUser = await profileModel.getUserById(id);

    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    metrics.observeProfileRequest(durationSeconds, 'admin_update');

    res.json({
      success: true,
      user: serializeAdminUser(updatedUser)
    });
  })
);

// Admin endpoint to toggle user active status (PATCH /:id/toggle-active)
router.patch(
  '/:id/toggle-active',
  asyncHandler(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const { id } = req.params;

    // Check if user has admin role
    if (!isAdmin(req.user.role)) {
      throw new shared.errors.ForbiddenError('Admin access required');
    }

    const existingUser = await profileModel.getUserById(id);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    // Toggle is_active status
    await profileModel.updateUserCredentials(id, {
      isActive: !existingUser.is_active
    });

    const updatedUser = await profileModel.getUserById(id);

    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    metrics.observeProfileRequest(durationSeconds, 'admin_toggle_active');

    res.json({
      success: true,
      user: serializeAdminUser(updatedUser)
    });
  })
);

// Admin endpoint to delete a user (DELETE /:id)
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const { id } = req.params;

    // Check if user has admin role
    if (!isAdmin(req.user.role)) {
      throw new shared.errors.ForbiddenError('Admin access required');
    }

    const existingUser = await profileModel.getUserById(id);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    // Check if user is protected (cannot be deleted)
    if (existingUser.is_protected) {
      throw new shared.errors.ForbiddenError('This is a protected system account and cannot be deleted');
    }

    // Delete user (soft delete by setting is_active = false)
    await profileModel.deleteUser(id);

    // Publish deletion event so other services can clean up
    await eventPublisher.publishUserDeleted({
      userId: id,
      email: existingUser.email
    });

    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    metrics.observeProfileRequest(durationSeconds, 'admin_delete');

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  })
);

/**
 * Get permissions based on user role.
 * Admin users get full access to all admin features.
 * Regular users get no admin permissions.
 */
function getPermissionsForRole(role) {
  if (isAdmin(role)) {
    return [
      'services:read',
      'services:write',
      'system:monitor',
      'system:performance',
      'system:admin',
      'sync:read',
      'sync:admin',
      'users:read',
      'users:write',
      'licenses:read',
      'licenses:admin',
      'storage:read',
      'storage:write',
      'database:read',
      'logs:read',
      '*' // wildcard for any permission check
    ];
  }
  // Regular users get no admin permissions
  return [];
}

function serializeProfile(profile, authUser) {
  const permissions = getPermissionsForRole(authUser.role);

  return {
    id: profile.auth_user_id,
    email: authUser.email || profile.email,
    firstName: profile.first_name,
    lastName: profile.last_name,
    displayName: profile.display_name || profile.email || authUser.email,
    role: authUser.role,
    scopes: authUser.scopes,
    permissions: permissions,
    avatarUrl: profile.avatar_url,
    locale: profile.locale || 'en-US',
    timeZone: profile.time_zone || 'UTC',
    preferences: profile.preferences || {},
    lastLoginAt: profile.last_login_at,
    lastLoginIp: profile.last_login_ip,
    lastLoginUserAgent: profile.last_login_user_agent,
    loginCount: profile.login_count || 0
  };
}

function serializeAdminUser(user) {
  return {
    id: user.id || user.auth_user_id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    displayName: user.display_name || user.email,
    role: user.role,
    isActive: user.is_active,
    emailVerified: user.email_verified,
    isProtected: user.is_protected || false,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLogin: user.last_login_at,
    loginCount: user.login_count || 0
  };
}

function sanitizeProfileUpdate(payload = {}) {
  if (payload === null || typeof payload !== 'object') {
    throw new ValidationError('Request body must be an object');
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'firstName')) {
    updates.firstName = normalizeOptionalString(payload.firstName, 'firstName', MAX_NAME_LENGTH);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'lastName')) {
    updates.lastName = normalizeOptionalString(payload.lastName, 'lastName', MAX_NAME_LENGTH);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'displayName')) {
    updates.displayName = normalizeOptionalString(payload.displayName, 'displayName', MAX_DISPLAY_NAME_LENGTH);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'locale')) {
    updates.locale = normalizeOptionalString(payload.locale, 'locale', 20);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'timeZone')) {
    updates.timeZone = normalizeOptionalString(payload.timeZone, 'timeZone', 64);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'preferences')) {
    const preferences = payload.preferences;
    if (preferences !== null && typeof preferences !== 'object') {
      throw new ValidationError('preferences must be an object');
    }
    updates.preferences = preferences ? { ...preferences } : {};
  }

  Object.keys(updates).forEach((key) => {
    if (updates[key] === undefined) {
      delete updates[key];
    }
  });

  return updates;
}

function normalizeOptionalString(value, field, maxLength) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be ${maxLength} characters or fewer`);
  }

  return trimmed;
}

function computeChanges(existingProfile, updates) {
  const changes = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'firstName') && updates.firstName !== existingProfile.first_name) {
    changes.firstName = {
      previous: existingProfile.first_name || null,
      current: updates.firstName
    };
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'lastName') && updates.lastName !== existingProfile.last_name) {
    changes.lastName = {
      previous: existingProfile.last_name || null,
      current: updates.lastName
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'displayName') &&
    updates.displayName !== existingProfile.display_name
  ) {
    changes.displayName = {
      previous: existingProfile.display_name || null,
      current: updates.displayName
    };
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'locale') && updates.locale !== existingProfile.locale) {
    changes.locale = {
      previous: existingProfile.locale || null,
      current: updates.locale
    };
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'timeZone') && updates.timeZone !== existingProfile.time_zone) {
    changes.timeZone = {
      previous: existingProfile.time_zone || null,
      current: updates.timeZone
    };
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'preferences')) {
    const previous = existingProfile.preferences || {};
    const current = updates.preferences || {};
    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      changes.preferences = {
        previous,
        current
      };
    }
  }

  return changes;
}

function sanitizeAdminUserUpdate(payload = {}) {
  if (payload === null || typeof payload !== 'object') {
    throw new ValidationError('Request body must be an object');
  }

  const authUpdates = {};
  const profileUpdates = {};

  // Auth credential updates (global_auth.user_credentials table)
  if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
    const email = normalizeOptionalString(payload.email, 'email', 255);
    if (email) {
      authUpdates.email = email.toLowerCase();
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'role')) {
    const validRoles = ['user', 'operator', 'viewer', 'admin'];
    if (!validRoles.includes(payload.role)) {
      throw new ValidationError(`role must be one of: ${validRoles.join(', ')}`);
    }
    authUpdates.role = payload.role;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'password') && payload.password) {
    if (typeof payload.password !== 'string') {
      throw new ValidationError('password must be a string');
    }
    if (payload.password.length < 8) {
      throw new ValidationError('password must be at least 8 characters');
    }
    authUpdates.password = payload.password;
  }

  // Profile updates (users.profiles table)
  if (Object.prototype.hasOwnProperty.call(payload, 'firstName')) {
    profileUpdates.firstName = normalizeOptionalString(payload.firstName, 'firstName', MAX_NAME_LENGTH);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'lastName')) {
    profileUpdates.lastName = normalizeOptionalString(payload.lastName, 'lastName', MAX_NAME_LENGTH);
  }

  // Teams settings - stored in separate tables but we'll handle them here
  // Note: These are placeholder for now - actual Teams settings should be handled by Teams service
  if (Object.prototype.hasOwnProperty.call(payload, 'teamsLicenseActive')) {
    authUpdates.teamsLicenseActive = Boolean(payload.teamsLicenseActive);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'teamsAutoJoin')) {
    authUpdates.teamsAutoJoin = Boolean(payload.teamsAutoJoin);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'teamsJoinMode')) {
    const validModes = ['acs', 'graph'];
    if (!validModes.includes(payload.teamsJoinMode)) {
      throw new ValidationError(`teamsJoinMode must be one of: ${validModes.join(', ')}`);
    }
    authUpdates.teamsJoinMode = payload.teamsJoinMode;
  }

  Object.keys(authUpdates).forEach((key) => {
    if (authUpdates[key] === undefined) {
      delete authUpdates[key];
    }
  });

  Object.keys(profileUpdates).forEach((key) => {
    if (profileUpdates[key] === undefined) {
      delete profileUpdates[key];
    }
  });

  return { authUpdates, profileUpdates };
}

module.exports = router;
