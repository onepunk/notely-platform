const fs = require('fs');
const { createPublicKey, createHash } = require('crypto');
const shared = require('@notely/shared');

const logger = shared.logger;

const DEFAULT_ALGORITHM = 'RS256';

let cachedKeys;

function normalisePem(value) {
  if (!value) {
    return value;
  }

  return value.replace(/\\n/g, '\n');
}

function readKeyFromFile(filePath, keyLabel) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${keyLabel} from ${filePath}: ${error.message}`);
  }
}

function loadKeyPair() {
  const privateKeyRaw = process.env.JWT_PRIVATE_KEY?.trim();
  const publicKeyRaw = process.env.JWT_PUBLIC_KEY?.trim();
  const privateKeyFile = process.env.JWT_PRIVATE_KEY_FILE;
  const publicKeyFile = process.env.JWT_PUBLIC_KEY_FILE;

  const privateKeyPem = normalisePem(
    privateKeyRaw || (privateKeyFile ? readKeyFromFile(privateKeyFile, 'JWT private key') : null)
  );
  const publicKeyPem = normalisePem(
    publicKeyRaw || (publicKeyFile ? readKeyFromFile(publicKeyFile, 'JWT public key') : null)
  );

  if (!privateKeyPem) {
    throw new Error('JWT_PRIVATE_KEY (or JWT_PRIVATE_KEY_FILE) must be set to a PEM-encoded RSA private key');
  }

  if (!publicKeyPem) {
    throw new Error('JWT_PUBLIC_KEY (or JWT_PUBLIC_KEY_FILE) must be set to a PEM-encoded RSA public key');
  }

  const publicKeyObject = createPublicKey(publicKeyPem);
  const jwk = publicKeyObject.export({ format: 'jwk' });

  const kid = process.env.JWT_KEY_ID
    || createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 32);

  return {
    privateKeyPem,
    publicKeyPem,
    publicKeyObject,
    jwk,
    kid,
    algorithm: DEFAULT_ALGORITHM,
    ephemeral: false
  };
}

function ensureKeys() {
  if (cachedKeys) {
    return cachedKeys;
  }

  try {
    cachedKeys = loadKeyPair();
  } catch (error) {
    logger.error('JWT key pair loading failed', { error: error.message });
    throw error;
  }

  return cachedKeys;
}

function getSigningKey() {
  const { privateKeyPem, kid, algorithm } = ensureKeys();
  return {
    privateKeyPem,
    kid,
    algorithm
  };
}

function getVerificationKey() {
  const { publicKeyPem, algorithm } = ensureKeys();
  return {
    publicKeyPem,
    algorithm
  };
}

function getJWKS() {
  const { jwk, kid } = ensureKeys();
  return {
    keys: [
      {
        ...jwk,
        use: 'sig',
        alg: DEFAULT_ALGORITHM,
        kid
      }
    ]
  };
}

module.exports = {
  ensureKeys,
  getSigningKey,
  getVerificationKey,
  getJWKS
};
