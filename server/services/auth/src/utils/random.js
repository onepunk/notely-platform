const crypto = require('crypto');

function generateUrlSafeRandomString(byteLength = 24) {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new Error('byteLength must be a positive integer');
  }

  return crypto
    .randomBytes(byteLength)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

module.exports = {
  generateUrlSafeRandomString
};
