/**
 * Key Manager Service
 *
 * Manages RSA key pair loading, caching, and verification for license signing/validation.
 * Keys are loaded from config/keys/ directory and verified on startup.
 */

import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

// Cache for loaded keys
let cachedPrivateKey: string | null = null;
let cachedPublicKey: string | null = null;

// Key file paths
const KEYS_DIR = path.join(__dirname, '../../config/keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

/**
 * Load the private key from disk
 * @returns The private key as a string
 * @throws Error if the key file doesn't exist or can't be read
 */
function loadPrivateKey(): string {
  try {
    if (!fs.existsSync(PRIVATE_KEY_PATH)) {
      throw new Error(
        `Private key not found at ${PRIVATE_KEY_PATH}. ` +
        `Please ensure the key file exists in config/keys/private.pem`
      );
    }

    const key = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

    if (!key || key.trim().length === 0) {
      throw new Error('Private key file is empty');
    }

    if (!key.includes('BEGIN PRIVATE KEY') && !key.includes('BEGIN RSA PRIVATE KEY')) {
      throw new Error('Private key file does not appear to be a valid PEM format');
    }

    return key;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load private key: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Load the public key from disk
 * @returns The public key as a string
 * @throws Error if the key file doesn't exist or can't be read
 */
function loadPublicKey(): string {
  try {
    if (!fs.existsSync(PUBLIC_KEY_PATH)) {
      throw new Error(
        `Public key not found at ${PUBLIC_KEY_PATH}. ` +
        `Please ensure the key file exists in config/keys/public.pem`
      );
    }

    const key = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');

    if (!key || key.trim().length === 0) {
      throw new Error('Public key file is empty');
    }

    if (!key.includes('BEGIN PUBLIC KEY') && !key.includes('BEGIN RSA PUBLIC KEY')) {
      throw new Error('Public key file does not appear to be a valid PEM format');
    }

    return key;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load public key: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Verify that the private and public keys work together as a valid key pair
 * @param privateKey The private key to test
 * @param publicKey The public key to test
 * @returns true if the key pair is valid, false otherwise
 */
function verifyKeyPair(privateKey: string, publicKey: string): boolean {
  try {
    // Create a test payload
    const testPayload = {
      test: 'key-pair-verification',
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(7)
    };

    // Sign with private key
    const token = jwt.sign(testPayload, privateKey, {
      algorithm: 'RS256',
      expiresIn: '1m'
    });

    // Verify with public key
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256']
    });

    // Check that the decoded payload matches
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'test' in decoded &&
      decoded.test === testPayload.test
    ) {
      return true;
    }

    return false;
  } catch (error) {
    // If signing or verification fails, the key pair is invalid
    return false;
  }
}

/**
 * Initialize the key manager by loading and verifying keys
 * This should be called on service startup
 * @throws Error if keys can't be loaded or verified
 */
export function initialize(): void {
  try {
    logger.info('Loading RSA key pair...');

    // Load keys from disk
    const privateKey = loadPrivateKey();
    const publicKey = loadPublicKey();

    logger.info('Keys loaded successfully', {
      privateKeyPath: PRIVATE_KEY_PATH,
      publicKeyPath: PUBLIC_KEY_PATH,
    });

    // Verify the key pair works together
    logger.info('Verifying key pair...');
    const isValid = verifyKeyPair(privateKey, publicKey);

    if (!isValid) {
      throw new Error(
        'Key pair verification failed. The private and public keys do not form a valid pair. ' +
        'Please regenerate the keys or ensure they match.'
      );
    }

    // Cache the keys
    cachedPrivateKey = privateKey;
    cachedPublicKey = publicKey;

    logger.info('Key Manager initialized successfully', {
      privateKeyPath: PRIVATE_KEY_PATH,
      publicKeyPath: PUBLIC_KEY_PATH,
      verification: 'PASSED',
    });
  } catch (error) {
    logger.error('Key Manager initialization failed', { error });
    if (error instanceof Error) {
      throw new Error(`Key Manager initialization failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get the cached private key
 * @returns The private key
 * @throws Error if keys haven't been initialized
 */
export function getPrivateKey(): string {
  if (!cachedPrivateKey) {
    throw new Error(
      'Private key not initialized. Call initialize() first on service startup.'
    );
  }
  return cachedPrivateKey;
}

/**
 * Get the cached public key
 * @returns The public key
 * @throws Error if keys haven't been initialized
 */
export function getPublicKey(): string {
  if (!cachedPublicKey) {
    throw new Error(
      'Public key not initialized. Call initialize() first on service startup.'
    );
  }
  return cachedPublicKey;
}

/**
 * Check if keys have been initialized
 * @returns true if keys are loaded and cached
 */
export function isInitialized(): boolean {
  return cachedPrivateKey !== null && cachedPublicKey !== null;
}

/**
 * Clear cached keys (useful for testing)
 * WARNING: This should only be used in test environments
 */
export function clearCache(): void {
  cachedPrivateKey = null;
  cachedPublicKey = null;
}
