const shared = require('@notely/shared');

const logger = shared.logger.child({ scope: 'portal-bff-gateway-client' });

function normalizeBase(base) {
  if (!base) {
    return '';
  }
  return String(base).replace(/\/$/, '');
}

function ensureApiPath(base) {
  const normalized = normalizeBase(base);
  if (!normalized) {
    return '';
  }

  // Accept pre-configured /api suffix while appending it for bare hosts (e.g. http://localhost:3200).
  if (/\/api(\/|$)/.test(normalized)) {
    return normalized;
  }

  return `${normalized}/api`;
}

function resolveGatewayBase() {
  const internalUrl = ensureApiPath(process.env.GATEWAY_INTERNAL_URL);
  if (internalUrl) {
    return internalUrl;
  }

  const apiBaseUrl = ensureApiPath(process.env.API_BASE_URL);
  if (apiBaseUrl) {
    return apiBaseUrl;
  }

  return 'http://gateway:3200/api';
}

const DEFAULT_GATEWAY_BASE = resolveGatewayBase();

function buildUrl(path, query) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = DEFAULT_GATEWAY_BASE.replace(/\/$/, '');
  const url = new URL(`${base}${normalizedPath}`);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, item));
        return;
      }
      url.searchParams.append(key, value);
    });
  }

  return url.toString();
}

function collectForwardHeaders(req, additional = {}) {
  const headers = {
    accept: 'application/json',
    ...additional
  };

  const forwardable = [
    'authorization',
    'cookie',
    'x-request-id',
    'x-correlation-id',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto'
  ];

  forwardable.forEach((header) => {
    const value = req.headers[header];
    if (!value) {
      return;
    }
    headers[header] = Array.isArray(value) ? value.join(',') : value;
  });

  return headers;
}

async function requestFromGateway(req, { path, method = 'GET', query, body, headers = {} }) {
  const url = buildUrl(path, query);
  const normalizedMethod = method.toUpperCase();
  const includeBody = !['GET', 'HEAD'].includes(normalizedMethod);

  const mergedHeaders = collectForwardHeaders(req, headers);
  if (includeBody && !mergedHeaders['content-type']) {
    mergedHeaders['content-type'] = 'application/json';
  }

  let payload;
  if (includeBody && body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  } else if (includeBody && req.body && Object.keys(req.body).length > 0) {
    payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  try {
    const response = await fetch(url, {
      method: normalizedMethod,
      headers: mergedHeaders,
      body: includeBody ? payload : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000)  // 30s timeout to prevent hanging requests
    });

    const text = await response.text();
    let data = text;
    let isJson = false;

    // Only parse as JSON if Content-Type indicates JSON
    const contentType = response.headers.get('content-type') || '';
    const isJsonContentType = contentType.includes('application/json');

    if (isJsonContentType && text) {
      try {
        data = JSON.parse(text);
        isJson = true;
      } catch (parseError) {
        // Log parsing failure for JSON content-type (indicates upstream issue)
        logger.warn('Failed to parse JSON response despite application/json content-type', {
          contentType,
          textLength: text.length,
          error: parseError.message
        });
        // Keep raw text as fallback
      }
    } else if (!text) {
      data = null;
    }

    return {
      status: response.status,
      headers: response.headers,
      data,
      isJson
    };
  } catch (error) {
    logger.error('Gateway request failed', {
      error: error.message,
      method: normalizedMethod,
      url
    });
    throw error;
  }
}

module.exports = {
  requestFromGateway,
  sendGatewayResponse(res, result) {
    if (result?.headers) {
      const headers = result.headers;
      if (typeof headers.getSetCookie === 'function') {
        const setCookies = headers.getSetCookie();
        if (setCookies && setCookies.length > 0) {
          res.setHeader('set-cookie', setCookies);
        }
      } else if (typeof headers.raw === 'function') {
        const raw = headers.raw();
        if (raw?.['set-cookie']?.length) {
          res.setHeader('set-cookie', raw['set-cookie']);
        }
      }

      if (!result.isJson) {
        const contentType = headers.get?.('content-type') || headers.get?.('Content-Type');
        if (contentType) {
          res.setHeader('content-type', contentType);
        }
      }
    }

    if (result?.isJson) {
      return res.status(result.status).json(result.data);
    }

    return res.status(result?.status ?? 502).send(result?.data ?? '');
  }
};
