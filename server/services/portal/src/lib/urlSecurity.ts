/**
 * URL Security Utilities
 *
 * Provides secure URL validation to prevent open redirect vulnerabilities.
 * All redirect URLs must be validated before use to ensure they point to
 * internal application paths only.
 */

/**
 * Allowed path prefixes for internal redirects.
 * Only paths starting with these prefixes are considered safe.
 */
const ALLOWED_PATH_PREFIXES = [
  '/',           // Root and all subpaths
];

/**
 * Explicitly blocked path patterns that could be exploited.
 */
const BLOCKED_PATTERNS = [
  /^\/\//,                    // Protocol-relative URLs (//evil.com)
  /^\/\\/,                    // Backslash variants (/\evil.com)
  /^\/[a-zA-Z]:/,             // Windows drive paths (/C:/)
  /^\/[^/]*:/,                // Protocol in path (/javascript:, /data:)
  /^\/[^/]*@/,                // Userinfo in path (/@attacker.com)
  /%2f/i,                     // URL-encoded forward slash
  /%5c/i,                     // URL-encoded backslash
  /[\x00-\x1f]/,              // Control characters
  /[\x7f-\x9f]/,              // Extended control characters
];

/**
 * Sanitizes and validates a return URL to prevent open redirect attacks.
 *
 * Security measures:
 * 1. Only allows relative paths (must start with /)
 * 2. Blocks protocol-relative URLs (//)
 * 3. Blocks encoded characters that could bypass validation
 * 4. Blocks URLs with userinfo (@) or protocol (:) patterns
 * 5. Normalizes and re-validates the final URL
 *
 * @param value - The URL value to sanitize (string, array, or undefined)
 * @param defaultPath - Default path if validation fails (default: '/')
 * @returns A safe relative path or the default path
 *
 * @example
 * sanitizeRedirectUrl('/dashboard')           // Returns '/dashboard'
 * sanitizeRedirectUrl('//evil.com')           // Returns '/'
 * sanitizeRedirectUrl('/login?next=/profile') // Returns '/login?next=/profile'
 * sanitizeRedirectUrl('https://evil.com')     // Returns '/'
 * sanitizeRedirectUrl('/@evil.com')           // Returns '/'
 */
export function sanitizeRedirectUrl(
  value: string | string[] | undefined | null,
  defaultPath: string = '/'
): string {
  // Handle null/undefined/empty
  if (!value) {
    return defaultPath;
  }

  // Handle array (from query params)
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== 'string') {
    return defaultPath;
  }

  // Trim whitespace
  const trimmed = candidate.trim();
  if (!trimmed) {
    return defaultPath;
  }

  // Must start with exactly one forward slash
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return defaultPath;
  }

  // Check against blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return defaultPath;
    }
  }

  // Try to parse as a URL to catch edge cases
  try {
    // Use a dummy base to parse relative URLs
    const parsed = new URL(trimmed, 'http://localhost');

    // Ensure no host was parsed (would indicate an absolute URL snuck through)
    if (parsed.host !== 'localhost') {
      return defaultPath;
    }

    // Ensure no username/password in URL
    if (parsed.username || parsed.password) {
      return defaultPath;
    }

    // Ensure protocol wasn't changed
    if (parsed.protocol !== 'http:') {
      return defaultPath;
    }

    // Re-validate the pathname after normalization
    const normalizedPath = parsed.pathname;

    // Check normalized path against blocked patterns again
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return defaultPath;
      }
    }

    // Ensure path starts with allowed prefix
    const isAllowed = ALLOWED_PATH_PREFIXES.some(prefix =>
      normalizedPath === prefix || normalizedPath.startsWith(prefix)
    );

    if (!isAllowed) {
      return defaultPath;
    }

    // Return normalized path with query string and hash preserved
    return normalizedPath + parsed.search + parsed.hash;

  } catch {
    // URL parsing failed - reject
    return defaultPath;
  }
}

/**
 * Validates whether a URL is safe for redirect without sanitizing.
 * Useful for conditional logic without modifying the URL.
 *
 * @param value - The URL value to validate
 * @returns true if the URL is safe for redirect, false otherwise
 */
export function isValidRedirectUrl(value: string | string[] | undefined | null): boolean {
  const sanitized = sanitizeRedirectUrl(value, '__INVALID__');
  return sanitized !== '__INVALID__';
}

/**
 * Creates a safe login redirect URL with a return_to parameter.
 *
 * @param returnTo - The path to return to after login
 * @returns A safe login URL with encoded return_to parameter
 */
export function createLoginRedirectUrl(returnTo: string | undefined): string {
  const safeReturnTo = sanitizeRedirectUrl(returnTo, '/');
  if (safeReturnTo === '/') {
    return '/login';
  }
  return `/login?redirect=${encodeURIComponent(safeReturnTo)}`;
}
