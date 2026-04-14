/**
 * Authentication Service for Unified Portal
 * Handles all authentication-related API calls and token management
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { UserProfile, ApiResponse } from '@/types/user';
import { getApiBasePath } from '@/utils/api';
import clientLogger from '@/lib/clientLogger';

class AuthService {
  private api: AxiosInstance;

  constructor() {
    const basePath = getApiBasePath() || '/api';

    this.api = axios.create({
      baseURL: basePath,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true, // Enable sending/receiving cookies
    });

    // CRIT-04 FIX: Request interceptor simplified - no longer reads tokens from storage
    // All authentication now uses HTTP-only cookies via withCredentials: true
    this.api.interceptors.request.use(
      (config) => {
        // Authentication handled via HTTP-only cookies
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error) => {
        if (error.response?.status === 401) {
          const url = error.config?.url || '';

          const errorMessage = error.response?.data?.error || error.response?.data?.message || '';
          const isDefinitivelyExpired = errorMessage.includes('expired') &&
                                      (errorMessage.includes('jwt') || errorMessage.includes('token'));

          if (isDefinitivelyExpired && typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
            clientLogger.info('[AUTH] Token expired, dispatching session invalid event', { url, errorMessage });
            // CRIT-04: No localStorage to clear - just dispatch event to trigger logout
            window.dispatchEvent(new CustomEvent('auth:token-invalid'));
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // CRIT-04 FIX: Removed getStoredToken() and clearStoredToken() methods
  // Tokens are now stored exclusively in HTTP-only cookies managed by the auth service

  /**
   * Login with email and password
   * Note: Token is now in HTTP-only cookie, not response body
   */
  async login(email: string, password: string): Promise<ApiResponse<{ user: UserProfile; token: string }>> {
    try {
      const response = await this.api.post('auth/login', {
        email,
        password,
      });

      // API returns { success: true, data: { user, expiresAt, scopes } }
      // Extract just the data payload
      const apiData = response.data.data || response.data;

      // Token is now in HTTP-only cookie, not response body
      // Return user data and metadata without token
      return {
        success: true,
        data: {
          user: apiData.user,
          // No token in response - it's in HTTP-only cookie
          expiresAt: apiData.expiresAt,
          scopes: apiData.scopes
        } as any, // Type assertion to match existing signature temporarily
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Login failed',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Fetch current session from HTTP-only cookie
   * Used after password login to validate session and get user data
   * Works for both password-based and OAuth sessions
   */
  async fetchSession(): Promise<ApiResponse<{ user: UserProfile; expiresAt: string }>> {
    try {
      const response = await this.api.get('/auth/session');

      const sessionData = response.data;

      return {
        success: true,
        data: sessionData,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Session fetch failed',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Logout and invalidate session
   * CRIT-04: Uses HTTP-only cookies for authentication, no token parameter needed
   */
  async logout(): Promise<ApiResponse<void>> {
    try {
      // Logout via HTTP-only cookies - server clears the session
      await axios.post(
        '/api/auth/logout',
        {},
        {
          withCredentials: true, // Send HTTP-only cookies for authentication
          timeout: 10000,
        }
      );

      return {
        success: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Logout failed',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Validate session and get user profile
   * CRIT-04: Uses HTTP-only cookies for authentication
   */
  async validateToken(sessionType: string): Promise<ApiResponse<UserProfile>> {
    try {
      // All sessions now use HTTP-only cookies via withCredentials
      const response = await this.api.get('/users/me');

      const payload = response.data;
      const userData = payload.data || payload;

      return {
        success: true,
        data: userData,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Session validation failed',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Refresh authentication session
   * CRIT-04: Uses HTTP-only cookies for authentication
   */
  async refreshToken(): Promise<ApiResponse<{ expiresAt: string }>> {
    try {
      // Refresh via HTTP-only cookies
      const response = await this.api.post('auth/refresh', {});

      return {
        success: true,
        data: response.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Token refresh failed',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Update user profile
   * CRIT-04: Uses HTTP-only cookies for authentication
   */
  async updateProfile(userData: Partial<UserProfile>): Promise<ApiResponse<UserProfile>> {
    try {
      // Auth via HTTP-only cookies
      const response = await this.api.put('users/me', userData);

      return {
        success: true,
        data: response.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to update profile',
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Export singleton instance
export const authService = new AuthService();
