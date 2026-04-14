const { Buffer } = require('buffer');

const DEFAULT_SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /refreshToken/i,
  /ssn/i,
  /socialSecurity/i,
  /pin/i,
  /otp/i,
  /apiKey/i,
  /creditCard/i,
  /^__.*$/,
  /^internal/i,
  /^metadata$/i
];

function needsBodyTransform(config = {}) {
  if (!config) {
    return false;
  }

  return Boolean(
    config.filterSensitive ||
      config.normalizeDates ||
      config.normalizeCasing ||
      (Array.isArray(config.stripFields) && config.stripFields.length > 0)
  );
}

function toCamelCase(value) {
  return value
    .replace(/[_-\s]+(.)?/g, (_, chr) => (chr ? chr.toUpperCase() : ''))
    .replace(/^(.)/, (match) => match.toLowerCase());
}

function shouldStripKey(key, config) {
  if (!config.filterSensitive && !(Array.isArray(config.stripFields) && config.stripFields.length > 0)) {
    return false;
  }

  if (Array.isArray(config.stripFields) && config.stripFields.some((candidate) => candidate === key)) {
    return true;
  }

  if (!config.filterSensitive) {
    return false;
  }

  return DEFAULT_SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

function isLikelyDateField(key) {
  return /(At|Date|Timestamp)$/i.test(key) || /^date$/i.test(key);
}

function normaliseDateValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  try {
    return new Date(parsed).toISOString();
  } catch (error) {
    return value;
  }
}

function transformPayload(payload, config = {}) {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload
      .map((item) => transformPayload(item, config))
      .filter((item) => item !== undefined);
  }

  if (typeof payload === 'object') {
    const transformed = {};

    for (const [rawKey, value] of Object.entries(payload)) {
      if (shouldStripKey(rawKey, config)) {
        continue;
      }

      const key = config.normalizeCasing ? toCamelCase(rawKey) : rawKey;
      let transformedValue = transformPayload(value, config);

      if (config.normalizeDates && isLikelyDateField(key) && transformedValue) {
        transformedValue = normaliseDateValue(transformedValue);
      }

      transformed[key] = transformedValue;
    }

    return transformed;
  }

  return payload;
}

function forwardProxyResponse(proxyRes, res) {
  res.statusCode = proxyRes.statusCode || 200;
  res.statusMessage = proxyRes.statusMessage || res.statusMessage;

  Object.entries(proxyRes.headers || {}).forEach(([header, value]) => {
    res.setHeader(header, value);
  });

  proxyRes.pipe(res);
}

function applyResponseTransforms({ proxyRes, req, res, config = {}, logger, onComplete }) {
  const encoding = proxyRes.headers?.['content-encoding'];
  const requiresTransformation = needsBodyTransform(config);
  let settled = false;

  const finalize = (statusCode, error) => {
    if (settled) {
      return;
    }
    settled = true;

    if (typeof onComplete === 'function') {
      onComplete(statusCode, error);
    }
  };

  if (!requiresTransformation || (encoding && encoding !== 'identity')) {
    if (requiresTransformation && logger) {
      logger.warn('Skipping response transformation due to unsupported encoding', {
        path: req.originalUrl,
        encoding
      });
    }
    proxyRes.on('end', () => {
      finalize(res.statusCode || proxyRes.statusCode || 200, null);
    });
    proxyRes.on('error', (error) => {
      finalize(proxyRes.statusCode || 502, error);
    });
    forwardProxyResponse(proxyRes, res);
    return;
  }

  const chunks = [];

  proxyRes.on('data', (chunk) => {
    chunks.push(Buffer.from(chunk));
  });

  proxyRes.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const contentType = proxyRes.headers?.['content-type'] || '';

    res.status(proxyRes.statusCode || 200);
    Object.entries(proxyRes.headers || {}).forEach(([header, value]) => {
      if (header.toLowerCase() === 'content-length') {
        return;
      }
      res.setHeader(header, value);
    });

    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(buffer.toString('utf8'));
        const transformed = transformPayload(parsed, config);
        res.json(transformed);
        finalize(res.statusCode || proxyRes.statusCode || 200, null);
        return;
      } catch (error) {
        if (logger) {
          logger.warn('Failed to transform JSON payload; forwarding original response', {
            path: req.originalUrl,
            error: error.message
          });
        }
        res.setHeader('Content-Type', contentType);
      }
    }

    res.send(buffer);
    finalize(res.statusCode || proxyRes.statusCode || 200, null);
  });

  proxyRes.on('error', (error) => {
    if (logger) {
      logger.error('Error processing proxied response', {
        path: req.originalUrl,
        error: error.message
      });
    }
    finalize(proxyRes.statusCode || 502, error);
    res.status(502).json({
      error: 'gateway_response_error',
      message: 'Failed to process upstream response',
      details: error.message
    });
  });
}

module.exports = {
  applyResponseTransforms,
  needsBodyTransform,
  transformPayload,
  DEFAULT_SENSITIVE_PATTERNS
};
