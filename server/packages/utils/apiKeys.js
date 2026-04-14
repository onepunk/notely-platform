"use strict";

const crypto = require('crypto');

function hashApiKey(rawKey, salt) {
  if (!rawKey || !salt) {
    throw new Error('hashApiKey requires both rawKey and salt');
  }

  const material = `${salt}:${rawKey}`;
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex');
}

function safeCompare(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function generateApiKey(byteLength = 32) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.randomBytes(byteLength).toString('hex');
  const hash = hashApiKey(key, salt);

  return { key, salt, hash };
}

module.exports = {
  hashApiKey,
  safeCompare,
  generateApiKey
};
