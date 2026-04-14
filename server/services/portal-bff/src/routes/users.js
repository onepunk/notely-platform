const express = require('express');
const shared = require('@notely/shared');

const { isSuperAdmin } = shared.constants.roles;
const { requestFromGateway, sendGatewayResponse } = require('../lib/gatewayClient');

const router = express.Router();

// Special handler for /users/me - orchestrates profile + permissions
router.get('/me', async (req, res) => {
  try {
    // Get user profile from users service
    const profileResult = await requestFromGateway(req, {
      path: '/users/me'
    });

    if (profileResult.status !== 200 || !profileResult.data) {
      return sendGatewayResponse(res, profileResult);
    }

    const profile = profileResult.data;

    // Get permissions for user's role from auth service
    let permissions = [];
    if (profile.role) {
      try {
        const permissionsResult = await requestFromGateway(req, {
          path: `/auth/roles/${profile.role}/permissions`
        });

        if (permissionsResult.status === 200 && Array.isArray(permissionsResult.data)) {
          permissions = permissionsResult.data;
        }
      } catch (permError) {
        // Log but don't fail - just return profile without permissions
        console.error('Failed to fetch permissions:', permError.message);
      }
    }

    // super_admin gets wildcard permission (bypasses all RBAC)
    if (isSuperAdmin(profile.role) && !permissions.includes('*')) {
      permissions = ['*', ...permissions];
    }

    // Merge profile and permissions
    const enrichedProfile = {
      ...profile,
      permissions
    };

    res.status(200).json(enrichedProfile);
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'gateway_error',
      message: error.message
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await requestFromGateway(req, {
      path: '/users',
      query: req.query
    });

    // If we got users, try to enrich with beta status
    if (result.status === 200 && result.data) {
      const users = Array.isArray(result.data) ? result.data : (result.data.data || []);

      // Fetch license status for each user in parallel
      const enrichedUsers = await Promise.all(
        users.map(async (user) => {
          try {
            console.log(`[BFF] Fetching license status for user ${user.id} (${user.email})`);
            const licenseResult = await requestFromGateway(req, {
              path: `/license/admin/user/${user.id}/status`,
              method: 'GET'
            });
            console.log(`[BFF] License result for ${user.email}:`, JSON.stringify(licenseResult.data, null, 2));

            if (licenseResult.status === 200 && licenseResult.data) {
              if (licenseResult.data.hasLicense && licenseResult.data.license) {
                console.log(`[BFF] User ${user.email} has license: ${licenseResult.data.license.tierKey}`);
                return {
                  ...user,
                  licenseType: licenseResult.data.license.tierKey,
                  licenseExpiresAt: licenseResult.data.license.expiresAt
                };
              }
            }
          } catch (licenseError) {
            console.error(`[BFF] Failed to fetch license status for user ${user.id} (${user.email}):`, licenseError.message);
          }
          console.log(`[BFF] Defaulting user ${user.email} to free license`);
          return { ...user, licenseType: 'free', licenseExpiresAt: null };
        })
      );

      // Return enriched data in same format as original
      if (Array.isArray(result.data)) {
        result.data = enrichedUsers;
      } else if (result.data.data) {
        result.data.data = enrichedUsers;
      }
    }

    sendGatewayResponse(res, result);
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'gateway_error',
      message: error.message
    });
  }
});

module.exports = router;
