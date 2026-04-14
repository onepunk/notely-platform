const express = require('express');
const shared = require('@notely/shared');

const logger = shared.logger.child({ scope: 'portal-bff-admin-ai' });
const router = express.Router();

// Call AI services directly, not through gateway
const LLM_SERVICE_URL = process.env.LLM_SERVICE_URL || 'http://llm:8002';
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://whisper:8001';

function collectForwardHeaders(req) {
  const headers = {
    accept: 'application/json'
  };

  const forwardable = [
    'authorization',
    'cookie',
    'x-request-id',
    'x-auth-type',
    'x-auth-subject',
    'x-auth-email',
    'x-auth-role',
    'x-auth-scopes'
  ];

  forwardable.forEach((header) => {
    const value = req.headers[header];
    if (value) {
      headers[header] = Array.isArray(value) ? value.join(',') : value;
    }
  });

  return headers;
}

// GET /admin/ai/llm/models
router.get('/llm/models', async (req, res) => {
  const url = `${LLM_SERVICE_URL}/v1/models`;

  try {
    logger.info('Proxying to LLM service', {
      method: 'GET',
      url,
      path: '/llm/models'
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: collectForwardHeaders(req)
    });

    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
      return res.status(response.status).json(data);
    } catch {
      return res.status(response.status).send(text);
    }
  } catch (error) {
    logger.error('LLM service request failed', {
      error: error.message,
      method: 'GET',
      url
    });

    res.status(502).json({
      success: false,
      error: 'llm_service_unavailable',
      message: error.message
    });
  }
});

// GET /admin/ai/whisper/models
router.get('/whisper/models', async (req, res) => {
  const url = `${WHISPER_SERVICE_URL}/v1/models`;

  try {
    logger.info('Proxying to Whisper service', {
      method: 'GET',
      url,
      path: '/whisper/models'
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: collectForwardHeaders(req)
    });

    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
      return res.status(response.status).json(data);
    } catch {
      return res.status(response.status).send(text);
    }
  } catch (error) {
    logger.error('Whisper service request failed', {
      error: error.message,
      method: 'GET',
      url
    });

    res.status(502).json({
      success: false,
      error: 'whisper_service_unavailable',
      message: error.message
    });
  }
});

module.exports = router;
