/**
 * Performance Service
 * Handles system and container performance metrics
 */

import { apiRequest } from '@/utils/api';

export interface SystemPerformance {
  cpu: {
    usage: number;
    cores: number;
    model: string;
    frequency: number;
    load: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
    cached?: number;
    buffers?: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  gpu?: {
    name: string;
    utilization: number;
    memoryUsed: number;
    memoryTotal: number;
    temperature?: number;
  }[];
  network: {
    interfaces: {
      name: string;
      bytesReceived: number;
      bytesSent: number;
      packetsReceived: number;
      packetsSent: number;
    }[];
  };
  system: {
    uptime: number;
    platform: string;
    arch: string;
    hostname: string;
    nodeVersion: string;
    processes: number;
  };
  timestamp: number;
}

export interface DockerContainerStats {
  containerId: string;
  name: string;
  serviceName: string;
  isRunning: boolean;
  cpu: {
    usage: number;
    usageText: string;
  };
  memory: {
    used: number;
    total: number;
    usage: number;
    usageText: string;
    usagePercent: string;
    cache?: number;
    cacheText?: string;
  };
  network: {
    input: string;
    output: string;
    total: string;
  };
  blockIO: {
    input: string;
    output: string;
    total: string;
  };
  gpu?: {
    index: number;
    name: string;
    utilization: number;
    memoryUsed: number;
    memoryTotal: number;
    temperature: number;
  };
}

export interface NetworkStats {
  containers: {
    name: string;
    bytesReceived: number;
    bytesSent: number;
  }[];
}

export interface DiskStats {
  images: number;
  containers: number;
  volumes: number;
  buildCache: number;
  totalSize: number;
}

class PerformanceService {
  /**
   * Get system performance metrics
   */
  async getSystemPerformance(): Promise<SystemPerformance> {
    const response = await apiRequest<{ success: boolean; data: SystemPerformance; error?: string }>(
      '/api/admin/system/performance',
      { timeout: 30000 }
    );

    if (!response?.success) {
      throw new Error(response?.error || 'Failed to fetch system performance');
    }

    return response.data;
  }

  /**
   * Get Docker container statistics
   */
  async getContainerStats(): Promise<{ containers: DockerContainerStats[]; timestamp: string; totalContainers: number }> {
    const response = await apiRequest<{
      success: boolean;
      data: { containers: DockerContainerStats[]; timestamp: string; totalContainers: number };
      error?: string;
    }>(
      '/api/admin/docker/stats',
      { timeout: 30000 }
    );

    if (!response?.success) {
      throw new Error(response?.error || 'Failed to fetch container stats');
    }

    return response.data;
  }

  /**
   * Get Docker network statistics
   */
  async getNetworkStats(): Promise<NetworkStats> {
    const response = await apiRequest<{ success: boolean; data: NetworkStats; error?: string }>(
      '/api/admin/docker/network-stats',
      { timeout: 30000 }
    );

    if (!response?.success) {
      throw new Error(response?.error || 'Failed to fetch network stats');
    }

    return response.data;
  }

  /**
   * Get Docker disk statistics
   */
  async getDiskStats(): Promise<DiskStats> {
    const response = await apiRequest<{ success: boolean; data: DiskStats; error?: string }>(
      '/api/admin/docker/disk-stats',
      { timeout: 30000 }
    );

    if (!response?.success) {
      throw new Error(response?.error || 'Failed to fetch disk stats');
    }

    return response.data;
  }
}

// Export singleton instance
export const performanceService = new PerformanceService();
