/**
 * API Client for Portal → Gateway Integration
 *
 * All API calls from the portal go through the Gateway, which routes to
 * the appropriate microservice (auth, users, calendar, meetings, etc.)
 *
 * Architecture:
 *   Portal → /api/* → Gateway → Domain Services
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { getApiBasePath, resolveApiUrl } from '@/utils/api';
import clientLogger from '@/lib/clientLogger';

interface ApiClientConfig {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

class APIClient {
  private api: AxiosInstance;
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig = {}) {
    this.config = {
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 1000,
    };

    const basePath = getApiBasePath() || '/api';

    this.api = axios.create({
      baseURL: basePath,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true, // Send cookies for session management
    });

    // CRIT-04 FIX: Request interceptor simplified - no longer reads tokens from storage
    // All authentication uses HTTP-only cookies via withCredentials: true
    this.api.interceptors.request.use(
      (config) => {
        // Authentication handled via HTTP-only cookies
        return config;
      },
      (error) => {
        clientLogger.error('[API] Request error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Response interceptor - handle errors and retries
    this.api.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error) => {
        const originalRequest = error.config;

        // Handle 401 Unauthorized
        if (error.response?.status === 401) {
          const errorMessage = error.response?.data?.error || error.response?.data?.message || '';
          const isTokenExpired = errorMessage.includes('expired') || errorMessage.includes('invalid');

          if (isTokenExpired && typeof window !== 'undefined') {
            clientLogger.info('[API] Session expired, triggering re-auth', {
              url: originalRequest?.url,
            });

            // CRIT-04: No localStorage to clear - just dispatch event
            window.dispatchEvent(new CustomEvent('auth:token-invalid'));

            // Redirect to login if not already there
            if (!window.location.pathname.includes('/login')) {
              window.location.href = '/login';
            }
          }
        }

        // Handle 5xx errors with retry logic
        if (error.response?.status >= 500 && originalRequest && !originalRequest._retry) {
          originalRequest._retry = true;
          originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;

          if (originalRequest._retryCount <= (this.config.retries || 3)) {
            clientLogger.warn('[API] Retrying request', {
              url: originalRequest.url,
              attempt: originalRequest._retryCount,
              status: error.response.status,
            });

            // Wait before retrying
            await this.delay(this.config.retryDelay || 1000);
            return this.api(originalRequest);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  // CRIT-04 FIX: Removed getStoredToken() and clearStoredToken() methods
  // Tokens are now stored exclusively in HTTP-only cookies

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // =========================================================================
  // Generic HTTP Methods
  // =========================================================================

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    // Resolve URL to handle license service routing
    const resolvedUrl = url.startsWith('/api/license') ? url : resolveApiUrl(url);
    const response = await this.api.get<T>(resolvedUrl, { ...config, baseURL: '' });
    return response.data;
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    // Resolve URL to handle license service routing
    const resolvedUrl = url.startsWith('/api/license') ? url : resolveApiUrl(url);
    const response = await this.api.post<T>(resolvedUrl, data, { ...config, baseURL: '' });
    return response.data;
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    // Resolve URL to handle license service routing
    const resolvedUrl = url.startsWith('/api/license') ? url : resolveApiUrl(url);
    const response = await this.api.put<T>(resolvedUrl, data, { ...config, baseURL: '' });
    return response.data;
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    // Resolve URL to handle license service routing
    const resolvedUrl = url.startsWith('/api/license') ? url : resolveApiUrl(url);
    const response = await this.api.patch<T>(resolvedUrl, data, { ...config, baseURL: '' });
    return response.data;
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    // Resolve URL to handle license service routing
    const resolvedUrl = url.startsWith('/api/license') ? url : resolveApiUrl(url);
    const response = await this.api.delete<T>(resolvedUrl, { ...config, baseURL: '' });
    return response.data;
  }

  // =========================================================================
  // Service-Specific Methods
  // =========================================================================

  // Users Service
  async getUser(userId: string) {
    return this.get(`/users/${userId}`);
  }

  async updateUser(userId: string, data: any) {
    return this.patch(`/users/${userId}`, data);
  }

  async getCurrentUser() {
    return this.get('/users/me');
  }

  // Calendar Service
  async getCalendarEvents(params: { userId?: string; start: string; end: string }) {
    return this.get('/calendar/events', { params });
  }

  async syncCalendar(userId: string) {
    return this.post(`/calendar/sync/${userId}`);
  }

  // Meetings Service
  async getMeetings(params?: { userId?: string; status?: string }) {
    return this.get('/meetings', { params });
  }

  async getMeeting(meetingId: string) {
    return this.get(`/meetings/${meetingId}`);
  }

  async updateMeeting(meetingId: string, data: any) {
    return this.patch(`/meetings/${meetingId}`, data);
  }

  // Transcripts Service
  async getTranscripts(params?: { meetingId?: string; userId?: string }) {
    return this.get('/transcripts', { params });
  }

  async getTranscript(transcriptId: string) {
    return this.get(`/transcripts/${transcriptId}`);
  }

  // Notes Service
  async getNotes(params?: { meetingId?: string; userId?: string }) {
    return this.get('/notes', { params });
  }

  async createNote(data: { meetingId: string; content: string }) {
    return this.post('/notes', data);
  }

  // Summaries Service
  async getSummaries(params?: { meetingId?: string; userId?: string }) {
    return this.get('/summaries', { params });
  }

  async getSummary(summaryId: string) {
    return this.get(`/summaries/${summaryId}`);
  }
}

// Export singleton instance
export const apiClient = new APIClient();

// Export class for custom instances
export default APIClient;
