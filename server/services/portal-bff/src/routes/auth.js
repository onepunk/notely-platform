const express = require('express');
const shared = require('@notely/shared');

const logger = shared.logger.child({ scope: 'portal-bff-auth' });
const router = express.Router();
const { requestFromGateway, sendGatewayResponse } = require('../lib/gatewayClient');

const ADMIN_CONFIG_URL = process.env.ADMIN_CONFIG_SERVICE_URL || 'http://admin-config:3206';

// Cache for IP whitelist (refresh every 30 seconds)
let ipWhitelistCache = {
  whitelist: [],
  lastFetch: 0,
  ttlMs: 30000
};

/**
 * Fetch IP whitelist from admin-config service
 */
async function getIpWhitelist() {
  const now = Date.now();

  // Return cached if still valid
  if (ipWhitelistCache.whitelist.length > 0 && (now - ipWhitelistCache.lastFetch) < ipWhitelistCache.ttlMs) {
    return ipWhitelistCache.whitelist;
  }

  try {
    const response = await fetch(`${ADMIN_CONFIG_URL}/api/public/config/security`);
    if (response.ok) {
      const data = await response.json();
      ipWhitelistCache.whitelist = data.ipWhitelist || [];
      ipWhitelistCache.lastFetch = now;
      logger.debug('Refreshed IP whitelist cache', { count: ipWhitelistCache.whitelist.length });
    }
  } catch (error) {
    logger.warn('Failed to fetch IP whitelist', { error: error.message });
    // Keep using cached value on error
  }

  return ipWhitelistCache.whitelist;
}

/**
 * Check if an IP is in the whitelist
 * Returns true if whitelist is empty (no restrictions) or IP is in the list
 */
function isIpWhitelisted(clientIp, whitelist) {
  // Empty whitelist means no restrictions
  if (!whitelist || whitelist.length === 0) {
    return true;
  }

  // Check if IP matches any entry in whitelist
  return whitelist.some(entry => {
    // Handle CIDR notation if needed (basic implementation)
    if (entry.includes('/')) {
      // For now, do exact match on CIDR entries
      // A full implementation would parse CIDR and check range
      return clientIp === entry;
    }
    return clientIp === entry;
  });
}

/**
 * Extract real client IP from request headers
 * Handles X-Forwarded-For chain from Cloudflare -> nginx -> gateway
 */
function getClientIp(req) {
  // X-Real-IP is set by nginx after processing X-Forwarded-For
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return realIp;
  }

  // Fallback to X-Forwarded-For (first IP in chain is the client)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  // Last resort: direct connection IP
  return req.ip || req.connection?.remoteAddress;
}

/**
 * GET /auth/session
 * Proxy to gateway and enrich response with IP whitelist status
 */
router.get('/session', async (req, res) => {
  try {
    // Forward request to gateway
    const result = await requestFromGateway(req, {
      path: '/auth/session',
      method: 'GET'
    });

    // If session request failed, return as-is
    if (result.status !== 200) {
      return sendGatewayResponse(res, result);
    }

    // Parse session data
    let sessionData;
    try {
      sessionData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
    } catch {
      return sendGatewayResponse(res, result);
    }

    // Check if user is admin
    const isAdmin = sessionData.user && ['admin', 'super_admin'].includes(sessionData.user.role);

    // Get IP whitelist and check client IP
    const clientIp = getClientIp(req);
    const whitelist = await getIpWhitelist();
    const adminIpWhitelisted = isIpWhitelisted(clientIp, whitelist);

    logger.debug('Session enriched with IP whitelist status', {
      email: sessionData.user?.email,
      isAdmin,
      clientIp,
      adminIpWhitelisted,
      whitelistCount: whitelist.length
    });

    // Add IP whitelist status to response
    sessionData.adminIpWhitelisted = adminIpWhitelisted;

    res.status(200).json(sessionData);
  } catch (error) {
    logger.error('Session request failed', { error: error.message });
    res.status(502).json({
      success: false,
      error: 'gateway_error',
      message: error.message
    });
  }
});

// All other auth routes (login, register, logout, etc.) - proxy to gateway
router.all('*', async (req, res) => {
  try {
    const result = await requestFromGateway(req, {
      path: `/auth${req.path}`,
      method: req.method,
      body: req.body,
      query: req.query
    });
    sendGatewayResponse(res, result);
  } catch (error) {
    logger.error('Auth proxy request failed', { error: error.message, path: req.path });
    res.status(502).json({
      success: false,
      error: 'gateway_error',
      message: error.message
    });
  }
});

module.exports = router;
