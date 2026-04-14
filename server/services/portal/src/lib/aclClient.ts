/**
 * ACL Client - Access Control List Integration
 *
 * Communicates with Auth service ACL endpoints to check route permissions
 * and manage role-based access control.
 *
 * Architecture:
 *   Portal → /api/auth/internal/acl/* → Auth Service
 */

import axios, { AxiosInstance } from 'axios';
import { getApiBasePath } from '@/utils/api';
import clientLogger from '@/lib/clientLogger';

interface AclCheckRequest {
  userRoles: string[];
  routePattern: string;
  httpMethod?: string;
  serviceName?: string;
}

interface AclCheckResponse {
  allowed: boolean;
  routeKey?: string;
  matchedRoles?: string[];
}

interface RoutePermission {
  id: number;
  route_key: string;
  path_pattern: string;
  http_method: string;
  description: string;
  service_name: string;
  is_active: boolean;
  roles?: string[];
  created_at: string;
  updated_at: string;
}

interface CreateRouteRequest {
  routeKey: string;
  pathPattern: string;
  httpMethod?: string;
  description?: string;
  serviceName?: string;
  allowedRoles?: string[];
}

class ACLClient {
  private api: AxiosInstance;
  private cache: Map<string, { result: AclCheckResponse; expiresAt: number }>;
  private cacheTTL: number = 60000; // 60 seconds

  constructor() {
    const basePath = getApiBasePath() || '/api';

    this.api = axios.create({
      baseURL: basePath,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true,
    });

    this.cache = new Map();

    // CRIT-04 FIX: Request interceptor simplified - auth via HTTP-only cookies
    this.api.interceptors.request.use(
      (config) => {
        // Authentication handled via HTTP-only cookies (withCredentials: true)
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        clientLogger.error('[ACL] Request failed', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.response?.data?.message || error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  // CRIT-04 FIX: Removed getStoredToken() - auth via HTTP-only cookies

  private getCacheKey(request: AclCheckRequest): string {
    return `${request.userRoles.sort().join(',')}:${request.routePattern}:${request.httpMethod || 'GET'}:${request.serviceName || 'portal'}`;
  }

  private getCachedResult(key: string): AclCheckResponse | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }
    this.cache.delete(key);
    return null;
  }

  private setCachedResult(key: string, result: AclCheckResponse): void {
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.cacheTTL,
    });
  }

  /**
   * Check if user roles have access to a route
   * Results are cached for 60 seconds to reduce Auth service load
   */
  async checkAccess(request: AclCheckRequest): Promise<AclCheckResponse> {
    const cacheKey = this.getCacheKey(request);
    const cached = this.getCachedResult(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const response = await this.api.post<AclCheckResponse>('/auth/internal/acl/check', {
        userRoles: request.userRoles,
        routePattern: request.routePattern,
        httpMethod: request.httpMethod || 'GET',
        serviceName: request.serviceName || 'portal',
      });

      const result = response.data;
      this.setCachedResult(cacheKey, result);

      return result;
    } catch (error: any) {
      // On error, deny access by default
      clientLogger.error('[ACL] Access check failed, denying by default', {
        error: error.message,
        request,
      });

      return {
        allowed: false,
      };
    }
  }

  /**
   * Get all routes accessible by a role
   * @param role - User role (e.g., 'admin', 'user')
   * @param serviceName - Optional service filter
   */
  async getRoutesByRole(role: string, serviceName?: string): Promise<RoutePermission[]> {
    try {
      const params: any = { role };
      if (serviceName) {
        params.serviceName = serviceName;
      }

      const response = await this.api.get<{ routes: RoutePermission[] }>(
        '/auth/internal/acl/routes',
        { params }
      );

      return response.data.routes || [];
    } catch (error: any) {
      clientLogger.error('[ACL] Failed to get routes by role', {
        error: error.message,
        role,
        serviceName,
      });
      return [];
    }
  }

  /**
   * Get all routes with role assignments
   * @param serviceName - Optional service filter
   */
  async getAllRoutes(serviceName?: string): Promise<RoutePermission[]> {
    try {
      const params: any = {};
      if (serviceName) {
        params.serviceName = serviceName;
      }

      const response = await this.api.get<{ routes: RoutePermission[] }>(
        '/auth/internal/acl/routes',
        { params }
      );

      return response.data.routes || [];
    } catch (error: any) {
      clientLogger.error('[ACL] Failed to get all routes', {
        error: error.message,
        serviceName,
      });
      return [];
    }
  }

  /**
   * Create a new route permission (admin only)
   */
  async createRoute(request: CreateRouteRequest): Promise<RoutePermission | null> {
    try {
      const response = await this.api.post<{ route: RoutePermission }>(
        '/auth/internal/acl/routes',
        {
          routeKey: request.routeKey,
          pathPattern: request.pathPattern,
          httpMethod: request.httpMethod || 'GET',
          description: request.description,
          serviceName: request.serviceName || 'portal',
          allowedRoles: request.allowedRoles || [],
        }
      );

      return response.data.route;
    } catch (error: any) {
      clientLogger.error('[ACL] Failed to create route', {
        error: error.message,
        request,
      });
      return null;
    }
  }

  /**
   * Update role assignments for a route (admin only)
   */
  async updateRouteRoles(routeId: number, roles: string[]): Promise<RoutePermission | null> {
    try {
      const response = await this.api.patch<{ route: RoutePermission }>(
        `/auth/internal/acl/routes/${routeId}/roles`,
        { roles }
      );

      return response.data.route;
    } catch (error: any) {
      clientLogger.error('[ACL] Failed to update route roles', {
        error: error.message,
        routeId,
        roles,
      });
      return null;
    }
  }

  /**
   * Clear ACL cache (useful after role changes)
   */
  clearCache(): void {
    this.cache.clear();
    clientLogger.info('[ACL] Cache cleared');
  }
}

// Export singleton instance
export const aclClient = new ACLClient();

// Export class for custom instances
export default ACLClient;
