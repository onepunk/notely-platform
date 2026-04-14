/**
 * SSL Certificate Generation
 *
 * Generates self-signed SSL certificates for the platform domains.
 * These certificates are intended for initial setup; production deployments
 * should replace them with proper CA-signed certificates.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Generates self-signed SSL certificates for all platform domains
 * @param {string} baseDomain - Base domain (e.g., 'example.com')
 * @param {string} outputDir - Directory to write certificates
 * @returns {Promise<Object>} Certificate generation result
 */
export async function generateDomainCertificates(baseDomain, outputDir) {
  const subdomains = ['api', 'portal', 'ws', 'get', 'calendar'];
  const domains = subdomains.map((sub) => `DNS:${sub}.${baseDomain}`);
  domains.push(`DNS:${baseDomain}`);

  const keyPath = path.join(outputDir, 'server.key');
  const certPath = path.join(outputDir, 'server.crt');

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Generate certificate with SAN (Subject Alternative Names)
  const sanList = domains.join(',');
  const command = `openssl req -x509 -nodes -days 365 \
    -newkey rsa:4096 \
    -keyout "${keyPath}" \
    -out "${certPath}" \
    -subj "/CN=${baseDomain}/O=Notely Platform/C=US" \
    -addext "subjectAltName=${sanList}"`;

  try {
    await execAsync(command);

    // Set proper permissions
    await fs.chmod(keyPath, 0o600);
    await fs.chmod(certPath, 0o644);

    return {
      success: true,
      keyPath,
      certPath,
      domains: subdomains.map((sub) => `${sub}.${baseDomain}`),
      validDays: 365,
      message: 'Self-signed certificates generated successfully',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to generate SSL certificates',
    };
  }
}

/**
 * Validates an existing SSL certificate
 * @param {string} certPath - Path to certificate file
 * @returns {Promise<Object>} Validation result
 */
export async function validateCertificate(certPath) {
  try {
    const { stdout } = await execAsync(
      `openssl x509 -in "${certPath}" -noout -dates -subject`
    );

    const lines = stdout.split('\n');
    const notBefore = lines.find((l) => l.includes('notBefore'))?.split('=')[1];
    const notAfter = lines.find((l) => l.includes('notAfter'))?.split('=')[1];
    const subject = lines.find((l) => l.includes('subject'))?.split('=')[1];

    const expiryDate = new Date(notAfter);
    const now = new Date();
    const daysUntilExpiry = Math.floor(
      (expiryDate - now) / (1000 * 60 * 60 * 24)
    );

    return {
      valid: daysUntilExpiry > 0,
      subject: subject?.trim(),
      notBefore,
      notAfter,
      daysUntilExpiry,
      expired: daysUntilExpiry <= 0,
      expiringSoon: daysUntilExpiry > 0 && daysUntilExpiry <= 30,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}

/**
 * Copies user-provided certificates to the nginx SSL directory
 * @param {Buffer} keyBuffer - Private key content
 * @param {Buffer} certBuffer - Certificate content
 * @param {string} outputDir - Target directory
 * @returns {Promise<Object>} Copy result
 */
export async function installUserCertificates(keyBuffer, certBuffer, outputDir) {
  const keyPath = path.join(outputDir, 'server.key');
  const certPath = path.join(outputDir, 'server.crt');

  try {
    // Validate certificate before installing
    const tempCertPath = path.join(outputDir, 'temp-validate.crt');
    await fs.writeFile(tempCertPath, certBuffer);

    const validation = await validateCertificate(tempCertPath);
    await fs.unlink(tempCertPath);

    if (!validation.valid) {
      return {
        success: false,
        error: 'Invalid certificate',
        details: validation,
      };
    }

    // Write certificates
    await fs.writeFile(keyPath, keyBuffer);
    await fs.writeFile(certPath, certBuffer);

    // Set permissions
    await fs.chmod(keyPath, 0o600);
    await fs.chmod(certPath, 0o644);

    return {
      success: true,
      keyPath,
      certPath,
      validation,
      message: 'Certificates installed successfully',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default {
  generateDomainCertificates,
  validateCertificate,
  installUserCertificates,
};
