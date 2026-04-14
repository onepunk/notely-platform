const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Load layered environment files (base -> secrets -> generated .env)
 * without clobbering variables that are already provided by the shell.
 */
const layeredEnvFiles = [
  path.resolve(__dirname, '../../config/base.env'),
  path.resolve(__dirname, '../../config/secrets.env'),
  path.resolve(__dirname, '../../.env'),
];

const assignedKeys = new Set();

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const parsed = dotenv.parse(fs.readFileSync(filePath));
  Object.entries(parsed).forEach(([key, value]) => {
    if (process.env[key] === undefined || assignedKeys.has(key)) {
      process.env[key] = value;
      assignedKeys.add(key);
    }
  });
}

layeredEnvFiles.forEach(applyEnvFile);

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function normalizeUrlBase(value) {
  if (!value) {
    return '';
  }
  return value.replace(/\/$/, '');
}

function ensureApiSuffix(url) {
  const normalized = normalizeUrlBase(url);
  if (!normalized) {
    return '';
  }
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

function resolveGatewayApiBase() {
  const candidates = [
    process.env.API_BASE_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.SERVICE_GATEWAY_URL,
    process.env.API_DOMAIN ? `https://${process.env.API_DOMAIN}` : ''
  ];

  for (const candidate of candidates) {
    const apiBase = ensureApiSuffix(candidate);
    if (apiBase) {
      return apiBase;
    }
  }

  return '';
}

// Only calendar service needs direct external rewriting; portal APIs now flow through the gateway/BFF
const calendarBaseUrl =
  process.env.CALENDAR_SERVICE_BASE_URL ||
  (process.env.CALENDAR_DOMAIN ? `https://${process.env.CALENDAR_DOMAIN}` : '') ||
  '';

const gatewayApiBase = resolveGatewayApiBase();

// Use environment variables or defaults for Docker build
// During build, these will be empty strings and filled in at runtime via environment
const portalHost = process.env.PORTAL_DOMAIN || 'localhost';
const apiHost = process.env.API_DOMAIN || 'localhost';
const calendarHost = process.env.CALENDAR_DOMAIN || '';

const allowedDevOrigins = unique([
  portalHost,
  `${portalHost}:3004`,
  'localhost:3004',
]);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true, // Skip type checking during build for now
  },
  eslint: {
    ignoreDuringBuilds: true, // Skip linting during build for now
  },

  allowedDevOrigins,

  env: {
    VERSION: require('./package.json').version,
    PORTAL_HOST: portalHost,
    API_HOST: apiHost,
    CALENDAR_HOST: calendarHost,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL || '',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || '',
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },

  images: {
    domains: unique([
      'localhost',
      portalHost,
      apiHost,
    ]),
    formats: ['image/webp'],
  },

  async rewrites() {
    const rules = [];

    // Proxy auth endpoints to gateway (for OAuth flow)
    if (gatewayApiBase) {
      rules.push({
        source: '/api/auth/:path*',
        destination: `${gatewayApiBase}/auth/:path*`,
      });
    }

    if (gatewayApiBase) {
      rules.push({
        source: '/api/portal/:path*',
        destination: `${gatewayApiBase}/portal/:path*`,
      });
    }

    // Proxy license endpoints to gateway
    if (gatewayApiBase) {
      rules.push({
        source: '/api/license/:path*',
        destination: `${gatewayApiBase}/license/:path*`,
      });
    }

    // Proxy support endpoints to gateway
    if (gatewayApiBase) {
      rules.push({
        source: '/api/support/:path*',
        destination: `${gatewayApiBase}/support/:path*`,
      });
    }

    // Proxy admin, users, and sync endpoints directly to gateway (bypassing portal-bff)
    if (gatewayApiBase) {
      rules.push({
        source: '/api/admin/:path*',
        destination: `${gatewayApiBase}/admin/:path*`,
      });
      rules.push({
        source: '/api/users/:path*',
        destination: `${gatewayApiBase}/users/:path*`,
      });
      rules.push({
        source: '/api/sync/:path*',
        destination: `${gatewayApiBase}/sync/:path*`,
      });
    }

    if (calendarBaseUrl) {
      rules.push({
        source: '/api/calendar/:path*',
        destination: `${calendarBaseUrl.replace(/\/$/, '')}/api/calendar/:path*`,
      });
    }

    // /api/health continues to be served directly by the portal service for liveliness probes

    return rules;
  },

  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/',
        permanent: true,
      },
    ];
  },

  // Security headers are set by nginx (the authoritative reverse proxy).
  // Do NOT duplicate them here — duplicate headers cause inconsistent browser behavior
  // (e.g., nginx sets X-Frame-Options: SAMEORIGIN while Next.js would set DENY).
};

module.exports = nextConfig;
