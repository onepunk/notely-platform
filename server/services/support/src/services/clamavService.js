const clamdjs = require('clamdjs');
const fs = require('fs');

const CLAMAV_HOST = process.env.CLAMAV_HOST || 'clamav';
const CLAMAV_PORT = parseInt(process.env.CLAMAV_PORT || '3310', 10);
const SCAN_TIMEOUT = 30000; // 30 seconds

let scanner = null;

function getScanner() {
  if (!scanner) {
    scanner = clamdjs.createScanner(CLAMAV_HOST, CLAMAV_PORT);
  }
  return scanner;
}

/**
 * Scan a file using ClamAV daemon via TCP INSTREAM protocol.
 * @param {string} filePath - Path to the file to scan
 * @returns {Promise<{clean: boolean, details?: string}>}
 * @throws {Error} If ClamAV is unreachable
 */
async function scanFile(filePath) {
  const s = getScanner();
  const readStream = fs.createReadStream(filePath);

  try {
    const result = await s.scanStream(readStream, SCAN_TIMEOUT);

    // clamdjs returns 'OK' for clean files
    const isClean = result.includes('OK');

    return {
      clean: isClean,
      details: isClean ? undefined : result,
    };
  } catch (err) {
    // Connection refused or timeout means ClamAV is down
    const message = err.message || String(err);
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ENOTFOUND')
    ) {
      throw new Error(`ClamAV unreachable at ${CLAMAV_HOST}:${CLAMAV_PORT}`);
    }
    throw err;
  }
}

module.exports = { scanFile };
