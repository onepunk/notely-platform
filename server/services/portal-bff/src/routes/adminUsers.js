const express = require('express');

const { requestFromGateway, sendGatewayResponse } = require('../lib/gatewayClient');

const router = express.Router();

/**
 * GET /portal/admin/users
 * List all users with license status enrichment
 */
router.get('/', async (req, res) => {
  try {
    // Get users from users service
    const result = await requestFromGateway(req, {
      path: '/users',
      query: req.query
    });

    // If we got users, enrich with license status
    if (result.status === 200 && result.data) {
      const users = Array.isArray(result.data) ? result.data : (result.data.data || []);

      // Fetch license status for each user in parallel
      const enrichedUsers = await Promise.all(
        users.map(async (user) => {
          try {
            const licenseResult = await requestFromGateway(req, {
              path: `/license/admin/user/${user.id}/status`,
              method: 'GET'
            });

            if (licenseResult.status === 200 && licenseResult.data) {
              if (licenseResult.data.hasLicense && licenseResult.data.license) {
                return {
                  ...user,
                  licenseType: licenseResult.data.license.tierKey,
                  licenseExpiresAt: licenseResult.data.license.expiresAt,
                  grantType: licenseResult.data.license.grantType,
                  isBeta: licenseResult.data.license.isBeta || false,
                };
              }
            }
          } catch (licenseError) {
            console.error(`Failed to fetch license status for user ${user.id}:`, licenseError.message);
          }
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

/**
 * GET /portal/admin/users/unified
 * Merged view of registered users + beta signups, one row per email.
 * Registered users are enriched with license data; beta signups are
 * attached as cloudBeta / aiBeta fields. Unconverted signups that
 * don't match any registered user appear as beta_only rows.
 */
router.get('/unified', async (req, res) => {
  try {
    // Parallel fetch: registered users + beta signups
    const [usersResult, betaResult] = await Promise.all([
      requestFromGateway(req, { path: '/users', query: { limit: 1000 } }),
      requestFromGateway(req, { path: '/support/admin/beta-signups', query: { limit: 500 } })
    ]);

    // Parse users
    let users = [];
    if (usersResult.status === 200 && usersResult.data) {
      users = Array.isArray(usersResult.data) ? usersResult.data : (usersResult.data.data || []);
    }

    // Parse beta signups
    let betaSignups = [];
    if (betaResult.status === 200 && betaResult.data) {
      betaSignups = betaResult.data.data?.signups || betaResult.data.signups || [];
    }

    // Enrich users with license data (same pattern as GET /)
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        try {
          const licenseResult = await requestFromGateway(req, {
            path: `/license/admin/user/${user.id}/status`,
            method: 'GET'
          });

          if (licenseResult.status === 200 && licenseResult.data) {
            if (licenseResult.data.hasLicense && licenseResult.data.license) {
              return {
                ...user,
                licenseType: licenseResult.data.license.tierKey,
                licenseExpiresAt: licenseResult.data.license.expiresAt,
                grantType: licenseResult.data.license.grantType,
                isBeta: licenseResult.data.license.isBeta || false,
              };
            }
          }
        } catch (licenseError) {
          console.error(`Failed to fetch license status for user ${user.id}:`, licenseError.message);
        }
        return { ...user, licenseType: 'free', licenseExpiresAt: null, grantType: null, isBeta: false };
      })
    );

    // Build unified map keyed by lowercase email
    const emailMap = new Map();

    // First pass: all registered users
    for (const user of enrichedUsers) {
      const key = user.email.toLowerCase();
      emailMap.set(key, {
        id: user.id,
        rowType: 'registered',
        email: user.email,
        firstName: user.firstName || user.first_name || null,
        lastName: user.lastName || user.last_name || null,
        role: user.role || null,
        isActive: user.isActive ?? user.is_active ?? true,
        emailVerified: user.emailVerified ?? user.email_verified ?? false,
        isProtected: user.isProtected ?? user.is_protected ?? false,
        createdAt: user.createdAt || user.created_at || null,
        lastLogin: user.lastLogin || user.last_login || null,
        licenseType: user.licenseType || 'free',
        licenseExpiresAt: user.licenseExpiresAt || null,
        grantType: user.grantType || null,
        isBeta: user.isBeta || false,
        cloudBeta: null,
        aiBeta: null,
        status: (user.isActive ?? user.is_active ?? true) ? 'registered' : 'suspended',
      });
    }

    // Second pass: merge or create beta signup rows
    for (const signup of betaSignups) {
      const key = signup.email.toLowerCase();
      const betaDetail = buildBetaDetail(signup);
      const product = signup.product || 'cloud';

      const existing = emailMap.get(key);
      if (existing) {
        // Attach beta data to existing row
        if (product === 'ai') {
          existing.aiBeta = betaDetail;
        } else {
          existing.cloudBeta = betaDetail;
        }
      } else {
        // Check if we already created a beta_only row for this email
        // (happens when same email has both cloud and ai signups)
        const betaOnlyRow = {
          id: signup.id,
          rowType: 'beta_only',
          email: signup.email,
          firstName: signup.firstName || signup.first_name || null,
          lastName: signup.lastName || signup.last_name || null,
          role: null,
          isActive: null,
          emailVerified: null,
          isProtected: false,
          createdAt: null,
          lastLogin: null,
          licenseType: null,
          licenseExpiresAt: null,
          grantType: null,
          isBeta: false,
          cloudBeta: product === 'cloud' ? betaDetail : null,
          aiBeta: product === 'ai' ? betaDetail : null,
          status: deriveBetaStatus(signup),
        };
        emailMap.set(key, betaOnlyRow);
      }
    }

    // For beta_only rows that got a second signup merged in, re-derive status
    for (const row of emailMap.values()) {
      if (row.rowType === 'beta_only') {
        row.status = deriveBetaStatusFromRow(row);
      }
    }

    // Sort: registered first, then by creation date descending
    const unified = Array.from(emailMap.values()).sort((a, b) => {
      if (a.rowType !== b.rowType) return a.rowType === 'registered' ? -1 : 1;
      const dateA = a.createdAt || a.cloudBeta?.signedUpAt || a.aiBeta?.signedUpAt || '';
      const dateB = b.createdAt || b.cloudBeta?.signedUpAt || b.aiBeta?.signedUpAt || '';
      return dateB.localeCompare(dateA);
    });

    res.json(unified);
  } catch (error) {
    console.error('Failed to build unified users view:', error.message);
    res.status(502).json({
      success: false,
      error: 'gateway_error',
      message: error.message
    });
  }
});

function buildBetaDetail(signup) {
  const status = signup.status || 'pending';
  const hasActiveToken = signup.hasActiveToken || false;
  const tokenExpired = signup.tokenExpired || false;

  let displayStatus;
  if (status === 'converted') {
    displayStatus = 'Converted';
  } else if (status === 'unsubscribed') {
    displayStatus = 'Unsubscribed';
  } else if (status === 'invite_sent' || hasActiveToken) {
    displayStatus = tokenExpired ? 'Expired' : 'Invitation Sent';
  } else if (status === 'confirmed') {
    displayStatus = 'Pending';
  } else {
    displayStatus = 'Pending';
  }

  return {
    signupId: signup.id,
    status,
    displayStatus,
    signedUpAt: signup.createdAt || signup.created_at || null,
    invitationSentAt: signup.invitationSentAt || signup.invitation_sent_at || null,
    hasActiveToken,
    tokenExpired,
  };
}

function deriveBetaStatus(signup) {
  const status = signup.status || 'pending';
  if (status === 'invite_sent') return 'invited';
  return 'pending';
}

function deriveBetaStatusFromRow(row) {
  const statuses = [row.cloudBeta?.status, row.aiBeta?.status].filter(Boolean);
  if (statuses.includes('invite_sent')) return 'invited';
  return 'pending';
}

router.post('/:id/teams/license', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      error: 'invalid_user_id',
      message: 'A valid user ID must be provided'
    });
  }

  try {
    const result = await requestFromGateway(req, {
      path: `/admin/users/${id}/teams/license`,
      method: 'POST'
    });
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
