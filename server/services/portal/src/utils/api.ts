/**
 * Secure API Client for Notely Portal
 *
 * This module provides a standardized, security-focused API client that enforces
 * best practices across all portal pages. It handles:
 *
 * - HTTP-only cookie authentication (CRIT-04 compliant)
 * - Request/response logging
 * - Standardized error handling
 * - CSRF protection via custom headers
 * - Type-safe response parsing
 * - Request timeout handling
 * - Automatic retry logic (optional)
 *
 * Usage:
 *   const { data } = await apiRequest<{ users: User[] }>('/api/admin/users');
 *   const result = await apiRequest('/api/admin/users', { method: 'POST', body: { ... } });
 */

import clientLogger from '@/lib/clientLogger';

// =============================================================================
// URL Resolution Helpers
// =============================================================================

function normalizeBase(base: string | undefined | null): string {
  if (!base) {
    return '';
  }
  return base.replace(/\/$/, '');
}

function normalizePath(path: string): string {
  if (!path) {
    return '';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

const PORTAL_API_PREFIX =
  process.env.NEXT_PUBLIC_PORTAL_API_PREFIX ||
  process.env.PORTAL_API_PREFIX ||
  '/api/portal';

function remapPortalPath(path: string): string {
  const normalized = normalizePath(path);

  if (!normalized.startsWith('/api')) {
    return normalized;
  }

  if (normalized.startsWith(PORTAL_API_PREFIX)) {
    return normalized;
  }

  // Don't remap paths that go directly to gateway services (not through portal-bff)
  const directGatewayPrefixes = [
    '/api/license',
    '/api/support',
    '/api/admin/',
    '/api/users',
    '/api/sync',
    '/api/email',
  ];
  if (directGatewayPrefixes.some(prefix => normalized.startsWith(prefix))) {
    return normalized;
  }

  return normalized.replace(/^\/api/, PORTAL_API_PREFIX);
}

/**
 * Resolve API URL respecting environment config and BFF routing
 */
export function resolveApiUrl(path: string): string {
  const base = typeof window === 'undefined'
    ? normalizeBase(process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || '')
    : '';

  const remappedPath = remapPortalPath(path);
  return `${base}${remappedPath}`;
}

/**
 * Get base API path for the portal
 */
export function getApiBasePath(): string {
  return resolveApiUrl('/api');
}

// =============================================================================
// API Error Classes
// =============================================================================

/**
 * Base API error class with structured error information
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: any;
  public readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: any,
    requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication required', requestId?: string) {
    super(message, 401, 'AUTHENTICATION_REQUIRED', undefined, requestId);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends ApiError {
  constructor(message: string = 'Insufficient permissions', requestId?: string) {
    super(message, 403, 'AUTHORIZATION_FAILED', undefined, requestId);
    this.name = 'AuthorizationError';
  }
}

/**
 * Resource not found error (404)
 */
export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found', requestId?: string) {
    super(message, 404, 'NOT_FOUND', undefined, requestId);
    this.name = 'NotFoundError';
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends ApiError {
  constructor(message: string, details?: any, requestId?: string) {
    super(message, 400, 'VALIDATION_ERROR', details, requestId);
    this.name = 'ValidationError';
  }
}

/**
 * Server error (500+)
 */
export class ServerError extends ApiError {
  constructor(message: string = 'Internal server error', requestId?: string) {
    super(message, 500, 'SERVER_ERROR', undefined, requestId);
    this.name = 'ServerError';
  }
}

// =============================================================================
// API Request Configuration
// =============================================================================

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /**
   * Request body (will be JSON stringified automatically)
   */
  body?: any;

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeout?: number;

  /**
   * Whether to include credentials (cookies) in request (default: true)
   */
  includeCredentials?: boolean;

  /**
   * Whether to automatically retry on network errors (default: false)
   */
  retry?: boolean;

  /**
   * Number of retry attempts (default: 3)
   */
  retryAttempts?: number;

  /**
   * Custom error handler (overrides default)
   */
  onError?: (error: ApiError) => void;

  /**
   * Whether to throw on error (default: true)
   * If false, returns { success: false, error: ApiError } instead of throwing
   */
  throwOnError?: boolean;
}

// =============================================================================
// Main API Request Function
// =============================================================================

/**
 * Standardized API request with built-in security, error handling, and logging
 *
 * Security features:
 * - HTTP-only cookie authentication (CRIT-04 compliant)
 * - CSRF protection via custom X-Requested-With header
 * - Request timeout to prevent hanging
 * - Structured error handling with proper HTTP status codes
 *
 * @param path - API endpoint path (e.g., '/api/admin/users')
 * @param options - Request options (method, body, headers, etc.)
 * @returns Parsed JSON response
 * @throws ApiError or subclass on failure
 *
 * @example
 * // GET request
 * const { data } = await apiRequest<{ users: User[] }>('/api/admin/users');
 *
 * @example
 * // POST request with body
 * await apiRequest('/api/admin/users', {
 *   method: 'POST',
 *   body: { email: 'user@example.com', role: 'admin' }
 * });
 *
 * @example
 * // With custom error handling
 * try {
 *   const result = await apiRequest('/api/admin/users');
 * } catch (error) {
 *   if (error instanceof AuthenticationError) {
 *     router.push('/login');
 *   } else if (error instanceof AuthorizationError) {
 *     toast.error('You do not have permission');
 *   } else {
 *     toast.error('An error occurred');
 *   }
 * }
 */
export async function apiRequest<T = any>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    body,
    timeout = 30000,
    includeCredentials = true,
    onError,
    throwOnError = true,
    ...fetchOptions
  } = options;

  // Resolve full URL
  const url = resolveApiUrl(path);

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isStringBody = typeof body === 'string';

  // CRIT-04: Build headers - authentication now via HTTP-only cookies only
  const headers: HeadersInit = {
    'Accept': 'application/json',
    // CSRF protection: Custom header that cannot be set by simple forms
    'X-Requested-With': 'XMLHttpRequest',
    // No Authorization header - auth via HTTP-only cookies (credentials: 'include')
    ...(fetchOptions.headers || {}),
  };

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Prepare request options
  const requestOptions: RequestInit = {
    ...fetchOptions,
    headers,
    credentials: includeCredentials ? 'include' : 'same-origin',
  };

  if (body !== undefined && body !== null) {
    if (isFormData) {
      requestOptions.body = body;
      // Allow browser to set multipart boundary header automatically
      delete (requestOptions.headers as Record<string, string>)['Content-Type'];
    } else if (isStringBody) {
      requestOptions.body = body;
    } else {
      requestOptions.body = JSON.stringify(body);
    }
  }

  // Log outgoing request (debug level)
  clientLogger.debug('API Request', {
    method: requestOptions.method || 'GET',
    url,
    hasBody: !!body,
    // CRIT-04: Auth now via HTTP-only cookies
  });

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Make the request
    const response = await fetch(url, {
      ...requestOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Parse response body
    let data: any;
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      data = await response.json().catch(() => ({}));
    } else {
      // Non-JSON response
      const text = await response.text();
      data = { message: text };
    }

    // Extract request ID from response headers (for tracking)
    const requestId = response.headers.get('x-request-id') || undefined;

    // Handle HTTP error responses
    if (!response.ok) {
      const errorMessage = data?.error || data?.message || `Request failed with status ${response.status}`;
      const errorCode = data?.code;
      const errorDetails = data?.details;

      let error: ApiError;

      switch (response.status) {
        case 401:
          error = new AuthenticationError(errorMessage, requestId);
          break;
        case 403:
          error = new AuthorizationError(errorMessage, requestId);
          break;
        case 404:
          error = new NotFoundError(errorMessage, requestId);
          break;
        case 400:
          error = new ValidationError(errorMessage, errorDetails, requestId);
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          error = new ServerError(errorMessage, requestId);
          break;
        default:
          error = new ApiError(errorMessage, response.status, errorCode, errorDetails, requestId);
      }

      // Log error
      clientLogger.error('API Error', {
        method: requestOptions.method || 'GET',
        url,
        status: response.status,
        error: errorMessage,
        requestId,
      });

      // Call custom error handler if provided
      if (onError) {
        onError(error);
      }

      if (throwOnError) {
        throw error;
      } else {
        return { success: false, error } as T;
      }
    }

    // Handle successful response that indicates failure (e.g., { success: false })
    if (data && data.success === false) {
      const errorMessage = data.error || data.message || 'Request failed';
      const error = new ApiError(errorMessage, response.status, data.code, data.details, requestId);

      clientLogger.error('API Logical Error', {
        method: requestOptions.method || 'GET',
        url,
        error: errorMessage,
        requestId,
      });

      if (onError) {
        onError(error);
      }

      if (throwOnError) {
        throw error;
      } else {
        return { success: false, error } as T;
      }
    }

    // Log successful response (debug level)
    clientLogger.debug('API Response', {
      method: requestOptions.method || 'GET',
      url,
      status: response.status,
      requestId,
    });

    return data as T;

  } catch (error: any) {
    clearTimeout(timeoutId);

    // Handle abort/timeout
    if (error.name === 'AbortError') {
      const timeoutError = new ApiError(
        `Request timeout after ${timeout}ms`,
        408,
        'REQUEST_TIMEOUT'
      );

      clientLogger.error('API Timeout', {
        method: requestOptions.method || 'GET',
        url,
        timeout,
      });

      if (onError) {
        onError(timeoutError);
      }

      if (throwOnError) {
        throw timeoutError;
      } else {
        return { success: false, error: timeoutError } as T;
      }
    }

    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const networkError = new ApiError(
        'Network error. Please check your connection.',
        0,
        'NETWORK_ERROR'
      );

      clientLogger.error('Network Error', {
        method: requestOptions.method || 'GET',
        url,
        error: error.message,
      });

      if (onError) {
        onError(networkError);
      }

      if (throwOnError) {
        throw networkError;
      } else {
        return { success: false, error: networkError } as T;
      }
    }

    // Re-throw if already an ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    // Wrap unknown errors
    const unknownError = new ServerError(
      error.message || 'An unexpected error occurred'
    );

    clientLogger.error('Unknown API Error', {
      method: requestOptions.method || 'GET',
      url,
      error: error.message,
      stack: error.stack,
    });

    if (onError) {
      onError(unknownError);
    }

    if (throwOnError) {
      throw unknownError;
    } else {
      return { success: false, error: unknownError } as T;
    }
  }
}

// =============================================================================
// Convenience Methods
// =============================================================================

/**
 * GET request
 */
export async function get<T = any>(path: string, options?: ApiRequestOptions): Promise<T> {
  return apiRequest<T>(path, { ...options, method: 'GET' });
}

/**
 * POST request
 */
export async function post<T = any>(
  path: string,
  body?: any,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(path, { ...options, method: 'POST', body });
}

/**
 * PUT request
 */
export async function put<T = any>(
  path: string,
  body?: any,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(path, { ...options, method: 'PUT', body });
}

/**
 * PATCH request
 */
export async function patch<T = any>(
  path: string,
  body?: any,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(path, { ...options, method: 'PATCH', body });
}

/**
 * DELETE request
 */
export async function del<T = any>(path: string, options?: ApiRequestOptions): Promise<T> {
  return apiRequest<T>(path, { ...options, method: 'DELETE' });
}
