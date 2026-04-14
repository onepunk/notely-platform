/**
 * Cookie Options Utilities
 *
 * Shared utilities for consistent cookie handling across auth flows.
 * Ensures cookies work across subdomains (portal.yourdomain.com <-> api.yourdomain.com).
 *
 * Extracted from oauth2.js to be reused in password-based auth.
 */

/**
 * Determines the shared cookie domain so auth cookies survive the redirect from
 * api -> portal. Falls back to the base of the API/portal hostnames and skips
 * localhost/IP addresses where a domain attribute would break cookies.
 */
function determineCookieDomain(portalDomain, apiDomain) {
  const explicit = process.env.PORTAL_COOKIE_DOMAIN
    || process.env.AUTH_COOKIE_DOMAIN
    || process.env.AUTH_COOKIE_BASE_DOMAIN;

  if (explicit && explicit.trim()) {
    const value = explicit.trim();
    return value.startsWith('.') ? value : `.${value}`;
  }

  const candidates = [apiDomain, portalDomain];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const hostname = candidate.split(':')[0].toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.includes('127.0.0.1')) continue;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) continue; // IPv4 literal

    const parts = hostname.split('.');
    if (parts.length < 2) continue;

    const base = parts.length === 2 ? hostname : parts.slice(1).join('.');
    return `.${base}`;
  }

  return null;
}

function buildPortalCookieOptions({ secure, portalDomain = process.env.PORTAL_DOMAIN, apiDomain = process.env.API_DOMAIN }) {
  const cookieDomain = determineCookieDomain(portalDomain, apiDomain);
  const options = {
    httpOnly: true,
    secure: Boolean(secure),
    sameSite: 'lax', // Changed from 'strict' to 'lax' for password-based auth compatibility
    path: '/'
  };

  if (cookieDomain) {
    options.domain = cookieDomain;
  }

  return options;
}

function shouldDefaultSecureCookies() {
  const portalDomain = process.env.PORTAL_DOMAIN || '';
  if (!portalDomain) {
    return false;
  }

  const normalized = portalDomain.toLowerCase();
  return !(normalized.includes('localhost') || normalized.includes('127.0.0.1'));
}

function inferSecureCookieFlag(req, fallback = false) {
  if (req.secure) {
    return true;
  }

  const forwardedProto = req.get ? req.get('x-forwarded-proto') : null;
  if (forwardedProto) {
    const [proto] = forwardedProto.split(',');
    if (proto && proto.trim().toLowerCase() === 'https') {
      return true;
    }
  }

  return fallback || shouldDefaultSecureCookies();
}

module.exports = {
  determineCookieDomain,
  buildPortalCookieOptions,
  shouldDefaultSecureCookies,
  inferSecureCookieFlag
};
