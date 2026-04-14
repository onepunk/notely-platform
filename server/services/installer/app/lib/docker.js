/**
 * Docker Compose Interaction
 *
 * Manages Docker containers for the platform installation.
 * Provides status checks, container management, and deployment.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Checks Docker and Docker Compose availability
 * @returns {Promise<Object>} Docker status
 */
export async function checkDocker() {
  const result = {
    docker: { available: false, version: null },
    compose: { available: false, version: null },
    socket: { available: false },
  };

  // Check Docker
  try {
    const { stdout } = await execAsync('docker --version');
    const versionMatch = stdout.match(/Docker version (\d+\.\d+\.\d+)/);
    result.docker.available = true;
    result.docker.version = versionMatch ? versionMatch[1] : 'unknown';
  } catch {
    result.docker.error = 'Docker not found';
  }

  // Check Docker Compose
  try {
    const { stdout } = await execAsync('docker compose version');
    const versionMatch = stdout.match(/v?(\d+\.\d+\.\d+)/);
    result.compose.available = true;
    result.compose.version = versionMatch ? versionMatch[1] : 'unknown';
  } catch {
    // Try legacy docker-compose
    try {
      const { stdout } = await execAsync('docker-compose --version');
      const versionMatch = stdout.match(/version (\d+\.\d+\.\d+)/);
      result.compose.available = true;
      result.compose.version = versionMatch ? versionMatch[1] : 'unknown';
      result.compose.legacy = true;
    } catch {
      result.compose.error = 'Docker Compose not found';
    }
  }

  // Check Docker socket
  try {
    await fs.access('/var/run/docker.sock');
    result.socket.available = true;
  } catch {
    result.socket.error = 'Docker socket not accessible';
  }

  return result;
}

/**
 * Gets the status of platform containers
 * @param {string} workspacePath - Path to workspace with docker-compose.yml
 * @returns {Promise<Object>} Container status
 */
export async function getContainerStatus(workspacePath) {
  try {
    const { stdout } = await execAsync(
      `cd "${workspacePath}" && docker compose ps --format json 2>/dev/null || docker compose ps`
    );

    // Try to parse JSON format
    try {
      const containers = stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      return {
        success: true,
        containers: containers.map((c) => ({
          name: c.Name || c.name,
          service: c.Service || c.service,
          status: c.State || c.state,
          health: c.Health || c.health,
          ports: c.Ports || c.ports,
        })),
      };
    } catch {
      // Fall back to text parsing
      return {
        success: true,
        raw: stdout,
        containers: [],
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Starts platform containers
 * @param {string} workspacePath - Path to workspace
 * @param {Object} options - Start options
 * @returns {Promise<Object>} Start result
 */
export async function startPlatform(workspacePath, options = {}) {
  const {
    deploymentMode = 'production',
    build = true,
    detach = true,
    services = [], // Empty array means all services
  } = options;

  // Build compose command
  let composeFiles = '-f docker-compose.yml';
  if (deploymentMode === 'production') {
    const prodFile = path.join(workspacePath, 'docker-compose.production.yml');
    try {
      await fs.access(prodFile);
      composeFiles += ' -f docker-compose.production.yml';
    } catch {
      // Production file doesn't exist, continue without it
    }
  }

  const args = ['up'];
  if (detach) args.push('-d');
  if (build) args.push('--build');
  if (services.length > 0) args.push(...services);

  const command = `cd "${workspacePath}" && docker compose ${composeFiles} ${args.join(' ')} 2>&1`;

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 600000, // 10 minute timeout for builds
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for build output
    });

    return {
      success: true,
      output: stdout,
      warnings: stderr,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      output: error.stdout,
      stderr: error.stderr,
    };
  }
}

/**
 * Stops platform containers
 * @param {string} workspacePath - Path to workspace
 * @param {Object} options - Stop options
 * @returns {Promise<Object>} Stop result
 */
export async function stopPlatform(workspacePath, options = {}) {
  const { removeVolumes = false, services = [] } = options;

  const args = ['down'];
  if (removeVolumes) args.push('-v');

  const serviceList = services.length > 0 ? services.join(' ') : '';

  try {
    const { stdout } = await execAsync(
      `cd "${workspacePath}" && docker compose ${args.join(' ')} ${serviceList} 2>&1`,
      { timeout: 120000 }
    );

    return {
      success: true,
      output: stdout,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Checks system prerequisites
 * @returns {Promise<Object>} Prerequisites check result
 */
export async function checkPrerequisites() {
  const checks = {
    docker: await checkDocker(),
    memory: await checkMemory(),
    disk: await checkDiskSpace(),
    ports: await checkPorts(),
  };

  const allPassed =
    checks.docker.docker.available &&
    checks.docker.compose.available &&
    checks.memory.adequate &&
    checks.disk.adequate &&
    checks.ports.allAvailable;

  return {
    passed: allPassed,
    checks,
  };
}

/**
 * Checks available memory
 * @returns {Promise<Object>} Memory check result
 */
async function checkMemory() {
  try {
    const { stdout } = await execAsync('free -m');
    const lines = stdout.split('\n');
    const memLine = lines.find((l) => l.startsWith('Mem:'));

    if (memLine) {
      const parts = memLine.split(/\s+/);
      const totalMB = parseInt(parts[1], 10);
      const availableMB = parseInt(parts[6] || parts[3], 10);

      return {
        totalMB,
        availableMB,
        adequate: totalMB >= 4096, // Minimum 4GB recommended
        recommended: totalMB >= 8192,
      };
    }
  } catch {
    // macOS fallback
    try {
      const { stdout } = await execAsync('sysctl -n hw.memsize');
      const totalBytes = parseInt(stdout.trim(), 10);
      const totalMB = Math.floor(totalBytes / (1024 * 1024));

      return {
        totalMB,
        adequate: totalMB >= 4096,
        recommended: totalMB >= 8192,
      };
    } catch {
      return { error: 'Unable to check memory', adequate: true };
    }
  }

  return { error: 'Unable to parse memory info', adequate: true };
}

/**
 * Checks available disk space
 * @returns {Promise<Object>} Disk check result
 */
async function checkDiskSpace() {
  try {
    const { stdout } = await execAsync('df -BG / | tail -1');
    const parts = stdout.split(/\s+/);
    const availableGB = parseInt(parts[3], 10);

    return {
      availableGB,
      adequate: availableGB >= 20, // Minimum 20GB recommended
      recommended: availableGB >= 50,
    };
  } catch {
    return { error: 'Unable to check disk space', adequate: true };
  }
}

/**
 * Checks if required ports are available
 * @returns {Promise<Object>} Port check result
 */
async function checkPorts() {
  const requiredPorts = [443, 80, 5432, 6379];
  const results = {};
  let allAvailable = true;

  for (const port of requiredPorts) {
    try {
      const { stdout } = await execAsync(`ss -tuln | grep :${port} || true`);
      const inUse = stdout.trim().length > 0;
      results[port] = { available: !inUse };
      if (inUse) allAvailable = false;
    } catch {
      results[port] = { available: true, error: 'Unable to check' };
    }
  }

  return {
    ports: results,
    allAvailable,
  };
}

/**
 * Pulls required Docker images
 * @param {string} workspacePath - Path to workspace
 * @returns {Promise<Object>} Pull result
 */
export async function pullImages(workspacePath) {
  try {
    const { stdout } = await execAsync(
      `cd "${workspacePath}" && docker compose pull 2>&1`,
      { timeout: 600000 }
    );

    return {
      success: true,
      output: stdout,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default {
  checkDocker,
  getContainerStatus,
  startPlatform,
  stopPlatform,
  checkPrerequisites,
  pullImages,
};
