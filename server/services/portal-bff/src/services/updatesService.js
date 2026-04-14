/**
 * Updates Service
 * Manages desktop client version checking and update availability
 * Reads release information from the database
 */

const shared = require('@notely/shared');
const releasesService = require('./releasesService');

const logger = shared.logger.child({ scope: 'portal-bff-updates' });

/**
 * Parse a semver version string into components
 * @param {string} version - Version string (e.g., "1.2.3")
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseVersion(version) {
  if (!version || typeof version !== 'string') {
    return null;
  }

  // Remove 'v' prefix if present
  const cleanVersion = version.replace(/^v/, '');
  const parts = cleanVersion.split('.');

  if (parts.length < 2) {
    return null;
  }

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parts.length > 2 ? parseInt(parts[2], 10) : 0;

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return null;
  }

  return { major, minor, patch };
}

/**
 * Compare two versions
 * @param {string} current - Current version
 * @param {string} latest - Latest available version
 * @returns {number} -1 if current < latest, 0 if equal, 1 if current > latest
 */
function compareVersions(current, latest) {
  const currentParsed = parseVersion(current);
  const latestParsed = parseVersion(latest);

  if (!currentParsed || !latestParsed) {
    return 0;
  }

  if (currentParsed.major !== latestParsed.major) {
    return currentParsed.major < latestParsed.major ? -1 : 1;
  }

  if (currentParsed.minor !== latestParsed.minor) {
    return currentParsed.minor < latestParsed.minor ? -1 : 1;
  }

  if (currentParsed.patch !== latestParsed.patch) {
    return currentParsed.patch < latestParsed.patch ? -1 : 1;
  }

  return 0;
}

/**
 * Normalize platform name to match our release keys
 * @param {string} platform - Platform from client (win32, darwin, linux)
 * @returns {string}
 */
function normalizePlatform(platform) {
  const platformMap = {
    'win32': 'windows',
    'darwin': 'mac',
    'linux': 'linux',
    'windows': 'windows',
    'mac': 'mac',
    'macos': 'mac',
  };

  return platformMap[platform?.toLowerCase()] || 'windows';
}

/**
 * Check if an update is available for the desktop client
 * Reads from database for release information
 * @param {Object} params
 * @param {string} params.currentVersion - Client's current version
 * @param {string} params.platform - Client's platform (win32, darwin, linux)
 * @returns {Object} Update information
 */
async function checkForUpdate({ currentVersion, platform }) {
  logger.info('Checking for update', { currentVersion, platform });

  const normalizedPlatform = normalizePlatform(platform);

  // Get the latest published release from the database
  const release = await releasesService.getLatestRelease(normalizedPlatform);

  if (!release) {
    logger.warn('No release found for platform', { platform, normalizedPlatform });
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      message: 'No release available for this platform',
      platform: normalizedPlatform,
    };
  }

  const comparison = compareVersions(currentVersion, release.version);
  const updateAvailable = comparison < 0;

  // Check if current version is below minimum supported
  const belowMinimum = release.minVersion
    ? compareVersions(currentVersion, release.minVersion) < 0
    : false;

  const result = {
    updateAvailable,
    currentVersion,
    latestVersion: release.version,
    downloadUrl: release.downloadUrl,
    releaseNotes: release.releaseNotes,
    releaseDate: release.publishedAt || release.createdAt,
    forceUpdate: belowMinimum,
    platform: normalizedPlatform,
  };

  if (updateAvailable) {
    logger.info('Update available', {
      currentVersion,
      latestVersion: release.version,
      forceUpdate: belowMinimum,
    });
  } else {
    logger.debug('Client is up to date', { currentVersion, latestVersion: release.version });
  }

  return result;
}

/**
 * Get the latest release information for all platforms
 * @returns {Object} Release information by platform
 */
async function getLatestReleases() {
  const releases = await releasesService.getLatestReleases();

  // Transform to expected format
  const result = {
    timestamp: new Date().toISOString(),
  };

  for (const [platform, release] of Object.entries(releases)) {
    result[platform] = {
      version: release.version,
      downloadUrl: release.downloadUrl,
      releaseNotes: release.releaseNotes,
      releaseDate: release.publishedAt || release.createdAt,
      minVersion: release.minVersion,
    };
  }

  return result;
}

module.exports = {
  checkForUpdate,
  getLatestReleases,
  compareVersions,
  parseVersion,
  normalizePlatform,
};
