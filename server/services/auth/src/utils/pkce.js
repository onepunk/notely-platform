const crypto = require('crypto');

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generateCodeVerifier() {
  return toBase64Url(crypto.randomBytes(32));
}

function generateCodeChallenge(codeVerifier) {
  if (!codeVerifier || typeof codeVerifier !== 'string') {
    throw new Error('Code verifier must be a non-empty string');
  }

  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    throw new Error('Code verifier must be between 43 and 128 characters');
  }

  const digest = crypto.createHash('sha256').update(codeVerifier).digest();
  return toBase64Url(digest);
}

function generatePKCEPair() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256'
  };
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  generatePKCEPair
};
