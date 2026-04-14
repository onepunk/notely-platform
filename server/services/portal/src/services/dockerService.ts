/**
 * Docker Service Management
 * Handles Docker container operations through API calls
 */

import { apiRequest } from '@/utils/api';

export interface DockerServiceInfo {
  name: string;
  containerName: string;
  displayName: string;
  status: 'running' | 'stopped' | 'restarting' | 'error' | 'unknown';
  health: 'healthy' | 'unhealthy' | 'starting' | 'degraded' | 'unknown';
  uptime?: string;
  ports?: string[];
  image?: string;
  description: string;
  icon: string;
  canControl: boolean;
}

export interface DockerOperationResponse {
  success: boolean;
  message: string;
  services?: DockerServiceInfo[];
}

class DockerService {
  /**
   * Get status of all Docker services
   */
  async getServiceStatus(): Promise<DockerServiceInfo[]> {
    const response = await apiRequest<{ success: boolean; data: { services: DockerServiceInfo[] }; error?: string }>(
      '/api/admin/docker/status',
      { timeout: 30000 }
    );

    if (!response?.success || !Array.isArray(response?.data?.services)) {
      throw new Error('Unexpected response format from Docker status endpoint');
    }

    return response.data.services;
  }

  /**
   * Get all Docker containers
   */
  async getContainers(): Promise<any> {
    const response = await apiRequest<{ success: boolean; data: any[]; error?: string }>(
      '/api/admin/docker/containers',
      { timeout: 30000 }
    );

    if (!response?.success || !Array.isArray(response?.data)) {
      throw new Error('Unexpected response format from Docker containers endpoint');
    }

    return response.data;
  }

  /**
   * Get Docker container stats
   */
  async getContainerStats(): Promise<any> {
    const response = await apiRequest<{ success: boolean; data: any; error?: string }>(
      '/api/admin/docker/stats',
      { timeout: 30000 }
    );

    if (!response?.success || !response?.data) {
      throw new Error('Unexpected response format from Docker stats endpoint');
    }

    return response.data;
  }

  /**
   * Start a specific service
   */
  async startService(serviceName: string): Promise<DockerOperationResponse> {
    return await apiRequest<DockerOperationResponse>(
      `/api/admin/docker/start/${serviceName}`,
      { method: 'POST', timeout: 30000 }
    );
  }

  /**
   * Stop a specific service
   */
  async stopService(serviceName: string): Promise<DockerOperationResponse> {
    return await apiRequest<DockerOperationResponse>(
      `/api/admin/docker/stop/${serviceName}`,
      { method: 'POST', timeout: 30000 }
    );
  }

  /**
   * Restart a specific service
   * For gateway and nginx, uses fire-and-forget since they are in the request path
   */
  async restartService(serviceName: string): Promise<DockerOperationResponse> {
    // Gateway and nginx restarts are special - they will kill their own connection
    // since all requests flow through them (browser → cloudflare → nginx → portal-bff)
    // Use fire-and-forget approach to avoid 520 errors from broken connections
    if (serviceName === 'notely-gateway-v3') {
      return this.restartServiceFireAndForget(serviceName, 'Gateway');
    }
    if (serviceName === 'notely-nginx-v3') {
      return this.restartServiceFireAndForget(serviceName, 'Nginx');
    }

    return await apiRequest<DockerOperationResponse>(
      `/api/admin/docker/restart/${serviceName}`,
      { method: 'POST', timeout: 30000 }
    );
  }

  /**
   * Fire-and-forget service restart for services in the request path
   * Sends request but catches timeout/connection errors since the service will restart itself
   */
  private async restartServiceFireAndForget(serviceName: string, displayName: string): Promise<DockerOperationResponse> {
    try {
      // Use short timeout - we just need the request to reach docker-manager
      // The actual restart will kill the connection before it can respond
      return await apiRequest<DockerOperationResponse>(
        `/api/admin/docker/restart/${serviceName}`,
        { method: 'POST', timeout: 5000 }
      );
    } catch {
      // Expected - service restarts before responding
      // The request was sent, so return success
      return {
        success: true,
        message: `${displayName} restart initiated`,
      };
    }
  }

  /**
   * Reload nginx configuration (graceful - no connection interruption)
   * Uses nginx -s reload which validates config and swaps worker processes
   * without interrupting existing connections.
   *
   * This is the preferred method for applying nginx config changes.
   */
  async reloadNginx(): Promise<DockerOperationResponse> {
    return await apiRequest<DockerOperationResponse>(
      '/api/admin/docker/nginx/reload',
      { method: 'POST', timeout: 30000 }
    );
  }

  /**
   * Start all services
   */
  async startAllServices(): Promise<DockerOperationResponse> {
    return await apiRequest<DockerOperationResponse>(
      '/api/admin/docker/start-all',
      { method: 'POST', timeout: 30000 }
    );
  }

  /**
   * Stop all services
   */
  async stopAllServices(): Promise<DockerOperationResponse> {
    return await apiRequest<DockerOperationResponse>(
      '/api/admin/docker/stop-all',
      { method: 'POST', timeout: 30000 }
    );
  }

  /**
   * Map Docker container names to service display information
   */
  getServiceDisplayInfo(containerName: string): { displayName: string; description: string; icon: string } {
    const serviceMap: Record<string, { displayName: string; description: string; icon: string }> = {
      'notely-api': {
        displayName: 'API Server',
        description: 'Main API server handling all client requests',
        icon: 'api'
      },
      'notely-postgres': {
        displayName: 'PostgreSQL Database',
        description: 'Primary database for user data and sessions',
        icon: 'storage'
      },
      'notely-redis': {
        displayName: 'Redis Cache',
        description: 'In-memory cache and session storage',
        icon: 'redis'
      },
      'notely-whisper': {
        displayName: 'Whisper Service',
        description: 'AI-powered speech-to-text transcription service',
        icon: 'psychology'
      },
      'notely-whisper-worker': {
        displayName: 'Whisper Worker',
        description: 'Whisper background processing worker',
        icon: 'psychology'
      },
      'notely-llm': {
        displayName: 'LLM Service',
        description: 'AI-powered text analysis and summarization service',
        icon: 'psychology'
      },
      'notely-llm-worker-v3': {
        displayName: 'LLM Worker',
        description: 'LLM GPU-accelerated inference worker (llama.cpp)',
        icon: 'psychology'
      },
      'notely-calendar': {
        displayName: 'Calendar Service',
        description: 'Calendar integration and meeting management',
        icon: 'calendar'
      },
      'notely-email': {
        displayName: 'Email Service',
        description: 'Email notifications and communication service',
        icon: 'email'
      },
      'notely-nginx': {
        displayName: 'Nginx Proxy',
        description: 'Reverse proxy and load balancer',
        icon: 'api'
      },
      'notely-licensing': {
        displayName: 'Licensing',
        description: 'License verification and management',
        icon: 'api'
      },
      'notely-teams-service': {
        displayName: 'Teams Bot',
        description: 'Microsoft Teams bot service',
        icon: 'api'
      },
      'notely-teams-worker': {
        displayName: 'Teams Worker',
        description: 'Meeting join automation and transcript ingestion',
        icon: 'api'
      },
      'notely-loki': {
        displayName: 'Loki',
        description: 'Log aggregation system',
        icon: 'storage'
      },
      'notely-grafana': {
        displayName: 'Grafana',
        description: 'Metrics and monitoring dashboards',
        icon: 'api'
      },
      'notely-promtail': {
        displayName: 'Promtail',
        description: 'Log collection agent',
        icon: 'api'
      }
    };

    return serviceMap[containerName] || {
      displayName: containerName,
      description: 'Service container',
      icon: 'api'
    };
  }
}

// Export singleton instance
export const dockerService = new DockerService();
