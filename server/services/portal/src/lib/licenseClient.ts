/**
 * License API Client
 * Extends the base APIClient with license-specific methods
 */

import { apiClient } from './apiClient';
import type {
  License,
  LicenseValidationResponse,
  FeatureDefinition,
  LicenseValidation,
  GenerateLicenseRequest,
  GeneratedLicense,
  ActiveSession,
  TierWithFeatures,
  TierFeaturesResponse,
} from '@/types/license';

type LicenseApiSuccessResponse<T> = {
  success: true;
  data: T;
};

type LicenseApiErrorResponse = {
  success: false;
  error?: {
    code?: string;
    message?: string;
    [key: string]: any;
  };
};

type LicenseApiResponse<T> = T | LicenseApiSuccessResponse<T> | LicenseApiErrorResponse;

interface LicenseListApiResponse {
  licenses?: License[];
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    pages?: number;
  };
}

interface FeatureListApiResponse {
  features?: FeatureDefinition[];
}

const LICENSE_API_BASE = '/api/license';

export class LicenseAPIClient {
  // =========================================================================
  // Public Endpoints (no auth required)
  // =========================================================================

  /**
   * Validate a license key
   */
  async validateLicense(licenseKey: string): Promise<LicenseValidationResponse> {
    return apiClient.post(`${LICENSE_API_BASE}/validate`, { license_key: licenseKey });
  }

  /**
   * Get public key for offline validation
   */
  async getPublicKey(): Promise<{ public_key: string }> {
    return apiClient.get(`${LICENSE_API_BASE}/public-key`);
  }

  // =========================================================================
  // User Endpoints (requires auth)
  // =========================================================================

  /**
   * Get current user's license
   */
  async getCurrentLicense(): Promise<License | null> {
    try {
      const response = await apiClient.get<
        LicenseApiResponse<License | { license?: License | null }>
      >(`${LICENSE_API_BASE}/current`);

      const data = this.unwrapResponse(response);

      if (!data) {
        return null;
      }

      if (typeof data === 'object' && data !== null && 'license' in data) {
        const licenseData = (data as { license?: License | null }).license;
        return licenseData ?? null;
      }

      return data as License;
    } catch (error: any) {
      const rawStatus = error?.response?.status;
      const statusCode = typeof rawStatus === 'string' ? Number(rawStatus) : rawStatus;
      const errorCode = error?.response?.data?.error?.code;

      if (statusCode === 404 || errorCode === 'NO_LICENSE') {
        return null;
      }

      throw error;
    }
  }

  /**
   * Get all current licenses (cloud + notely-ai) for the authenticated user
   */
  async getAllCurrentLicenses(): Promise<{ cloud: License | null; notelyAi: License | null }> {
    const response = await apiClient.get<
      LicenseApiResponse<{ cloud: License | null; notelyAi: License | null }>
    >(`${LICENSE_API_BASE}/current/all`);
    return this.unwrapResponse(response);
  }

  /**
   * Send desktop heartbeat
   */
  async sendHeartbeat(data: {
    client_id: string;
    client_version?: string;
    platform?: string;
  }): Promise<{ session_id: string; status: string }> {
    return apiClient.post(`${LICENSE_API_BASE}/heartbeat`, data);
  }

  // =========================================================================
  // Tier Endpoints (public, for feature gating)
  // =========================================================================

  /**
   * Get all tiers with their features
   */
  async getTiers(): Promise<{ tiers: TierWithFeatures[] }> {
    const response = await apiClient.get<LicenseApiResponse<{ tiers: TierWithFeatures[] }>>(
      `${LICENSE_API_BASE}/tiers`
    );
    return this.unwrapResponse(response);
  }

  /**
   * Get a single tier by key with all its features
   */
  async getTier(tierKey: string): Promise<{ tier: TierWithFeatures }> {
    const response = await apiClient.get<LicenseApiResponse<{ tier: TierWithFeatures }>>(
      `${LICENSE_API_BASE}/tiers/${tierKey}`
    );
    return this.unwrapResponse(response);
  }

  /**
   * Get features for a specific tier (includes inherited features)
   */
  async getTierFeatures(tierKey: string): Promise<TierFeaturesResponse> {
    const response = await apiClient.get<LicenseApiResponse<TierFeaturesResponse>>(
      `${LICENSE_API_BASE}/tiers/${tierKey}/features`
    );
    return this.unwrapResponse(response);
  }

  // =========================================================================
  // Admin Endpoints (requires admin role)
  // =========================================================================

  /**
   * Generate a new license
   */
  async generateLicense(data: GenerateLicenseRequest): Promise<GeneratedLicense> {
    const payload = this.buildGenerateLicensePayload(data);

    const response = await apiClient.post<
      LicenseApiResponse<LicenseServiceGenerateResponse>
    >(`${LICENSE_API_BASE}/admin/generate`, payload);

    const raw = this.unwrapResponse(response);
    return this.normalizeGeneratedLicense(raw, data);
  }

  /**
   * List all licenses with filtering
   */
  async listLicenses(params?: {
    license_type?: string;
    organization_id?: string;
    user_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ licenses: License[]; total: number; limit: number; offset: number }> {
    const limit = params?.limit ?? 20;
    const normalizedLimit = limit > 0 ? limit : 20;
    const offset = params?.offset ?? 0;
    const page = Math.max(Math.floor(offset / normalizedLimit) + 1, 1);

    const queryParams: Record<string, any> = {
      page,
      limit: normalizedLimit,
    };

    if (params?.license_type) {
      queryParams.type = params.license_type;
    }

    if (params?.status) {
      queryParams.status = params.status;
    }

    if (params?.organization_id) {
      queryParams.search = params.organization_id;
    } else if (params?.user_id) {
      queryParams.search = params.user_id;
    }

    const response = await apiClient.get<LicenseApiResponse<LicenseListApiResponse>>(
      `${LICENSE_API_BASE}/admin/licenses`,
      { params: queryParams }
    );

    const data = this.unwrapResponse(response);
    const resolvedLicenses = data.licenses ?? [];
    const pagination = data.pagination ?? {
      page,
      limit: normalizedLimit,
      total: resolvedLicenses.length,
      pages: 1,
    };

    const resolvedLimit = pagination.limit && pagination.limit > 0 ? pagination.limit : normalizedLimit;
    const resolvedPage = pagination.page && pagination.page > 0 ? pagination.page : page;

    return {
      licenses: resolvedLicenses,
      total: pagination.total ?? resolvedLicenses.length,
      limit: resolvedLimit,
      offset: (resolvedPage - 1) * resolvedLimit,
    };
  }

  /**
   * Get license details by ID
   */
  async getLicense(licenseId: string): Promise<{ license: License }> {
    return apiClient.get(`${LICENSE_API_BASE}/admin/licenses/${licenseId}`);
  }

  /**
   * Revoke a license by ID
   */
  async revokeLicense(licenseId: string, reason?: string): Promise<{ license: License }> {
    return apiClient.post(`${LICENSE_API_BASE}/admin/revoke/${licenseId}`, {
      reason,
    });
  }

  /**
   * Get available features
   */
  async getFeatures(): Promise<{ features: FeatureDefinition[] }> {
    const response = await apiClient.get<LicenseApiResponse<FeatureListApiResponse>>(
      `${LICENSE_API_BASE}/admin/features`
    );

    const data = this.unwrapResponse(response);

    return {
      features: data.features ?? [],
    };
  }

  /**
   * Get validation history
   */
  async getValidations(params?: {
    license_id?: string;
    is_valid?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ validations: LicenseValidation[]; total: number }> {
    const response = await apiClient.get<
      LicenseApiResponse<{ validations: LicenseValidation[]; pagination: { total: number } }>
    >(`${LICENSE_API_BASE}/admin/validations`, { params });

    const data = this.unwrapResponse(response);

    return {
      validations: data.validations ?? [],
      total: data.pagination?.total ?? 0,
    };
  }

  /**
   * Get active sessions
   */
  async getActiveSessions(params?: {
    license_id?: string;
    organization_id?: string;
  }): Promise<{ sessions: ActiveSession[]; total: number }> {
    const response = await apiClient.get<
      LicenseApiResponse<{ sessions: ActiveSession[]; pagination: { total: number } }>
    >(`${LICENSE_API_BASE}/admin/sessions`, { params });

    const data = this.unwrapResponse(response);

    return {
      sessions: data.sessions ?? [],
      total: data.pagination?.total ?? 0,
    };
  }

  /**
   * Update a feature's implementation status
   */
  async updateFeatureImplementation(
    featureKey: string,
    isImplemented: boolean
  ): Promise<{ success: boolean }> {
    return apiClient.put(`${LICENSE_API_BASE}/admin/features/${featureKey}/implementation`, {
      is_implemented: isImplemented,
    });
  }

  /**
   * Add a feature to a tier
   */
  async addFeatureToTier(tierId: string, featureKey: string): Promise<{ success: boolean }> {
    return apiClient.post(`${LICENSE_API_BASE}/admin/tiers/${tierId}/features/${featureKey}`);
  }

  /**
   * Remove a feature from a tier
   */
  async removeFeatureFromTier(tierId: string, featureKey: string): Promise<{ success: boolean }> {
    return apiClient.delete(`${LICENSE_API_BASE}/admin/tiers/${tierId}/features/${featureKey}`);
  }

  /**
   * Create a new feature definition
   */
  async createFeature(data: {
    feature_key: string;
    display_name: string;
    description?: string | null;
    feature_category?: 'desktop' | 'portal' | 'both';
    is_implemented?: boolean;
  }): Promise<{ feature: FeatureDefinition }> {
    const response = await apiClient.post<LicenseApiResponse<{ feature: FeatureDefinition }>>(
      `${LICENSE_API_BASE}/admin/features`,
      data
    );
    return this.unwrapResponse(response);
  }

  /**
   * Update a feature definition
   */
  async updateFeature(
    featureKey: string,
    data: {
      display_name?: string;
      description?: string | null;
      feature_category?: 'desktop' | 'portal' | 'both';
      is_implemented?: boolean;
    }
  ): Promise<{ feature: FeatureDefinition }> {
    const response = await apiClient.put<LicenseApiResponse<{ feature: FeatureDefinition }>>(
      `${LICENSE_API_BASE}/admin/features/${featureKey}`,
      data
    );
    return this.unwrapResponse(response);
  }

  /**
   * Delete (deactivate) a feature
   */
  async deleteFeature(featureKey: string): Promise<{ success: boolean }> {
    return apiClient.delete(`${LICENSE_API_BASE}/admin/features/${featureKey}`);
  }

  private buildGenerateLicensePayload(data: GenerateLicenseRequest) {
    const payload: LicenseServiceGenerateRequest = {
      productType: data.productType ?? 'portal',
      type: data.type,
      organizationId: data.organizationId,
      userId: data.userId,
      features: data.features ?? {},
      limits: data.limits ?? {},
    };

    if (data.hardwareId) {
      payload.hardwareId = data.hardwareId;
    }

    if (data.expiresAt) {
      payload.expiresAt = data.expiresAt;
    }

    const trimmedOrgId = data.organizationId?.trim();
    if (trimmedOrgId) {
      payload.organizationId = trimmedOrgId;
    }

    // Pass through notely-ai activation fields
    if (data.productType === 'notely-ai') {
      if (data.activationLimit !== undefined) {
        payload.activationLimit = data.activationLimit;
      }
      if (data.offlineGraceDays !== undefined) {
        payload.offlineGraceDays = data.offlineGraceDays;
      }
      if (data.revalidationIntervalHours !== undefined) {
        payload.revalidationIntervalHours = data.revalidationIntervalHours;
      }
    }

    return payload;
  }

  private normalizeGeneratedLicense(
    response: LicenseServiceGenerateResponse,
    request: GenerateLicenseRequest
  ): GeneratedLicense {
    if (response?.licenseKey) {
      return {
        licenseKey: response.licenseKey,
        licenseId: response.licenseId ?? 'pending',
        type: (response.type as GenerateLicenseRequest['type']) ?? request.type,
        productType: (response.productType as GenerateLicenseRequest['productType']) ?? request.productType,
        organizationId: response.organizationId ?? request.organizationId ?? null,
        userId: response.userId ?? request.userId,
        features: response.features ?? request.features ?? {},
        limits: response.limits ?? request.limits ?? {},
        issuedAt: response.issuedAt ?? new Date().toISOString(),
        expiresAt: response.expiresAt,
        hardwareId: response.hardwareId,
      };
    }

    if (response && 'license' in response && response.license) {
      const license = response.license as License;
      return {
        licenseKey: license.license_key,
        licenseId: license.id,
        type: request.type,
        productType: request.productType,
        organizationId: license.organization_id || request.organizationId || null,
        userId: license.user_id || request.userId,
        features: this.convertFeaturesFromLicense(license),
        limits: license.limits ?? {},
        issuedAt: license.issued_at,
        expiresAt: license.expires_at ?? undefined,
        hardwareId: license.hardware_id ?? undefined,
      };
    }

    throw new Error('Unexpected response from license generation endpoint');
  }

  private convertFeaturesFromLicense(license: License): Record<string, boolean> {
    if (!Array.isArray(license.features)) {
      return {};
    }

    return license.features.reduce<Record<string, boolean>>((acc, feature) => {
      acc[feature] = true;
      return acc;
    }, {});
  }

  private unwrapResponse<T>(response: LicenseApiResponse<T>): T {
    if (this.isSuccessResponse<T>(response)) {
      return response.data;
    }

    if (this.isErrorResponse(response)) {
      const errorMessage = response.error?.message || 'License API request failed';
      throw new Error(errorMessage);
    }

    return response as T;
  }

  private isSuccessResponse<T>(response: any): response is LicenseApiSuccessResponse<T> {
    return (
      Boolean(response) &&
      typeof response === 'object' &&
      response.success === true &&
      'data' in response
    );
  }

  private isErrorResponse(response: any): response is LicenseApiErrorResponse {
    return (
      Boolean(response) &&
      typeof response === 'object' &&
      response.success === false &&
      'error' in response
    );
  }
}

// Export singleton instance
export const licenseClient = new LicenseAPIClient();

interface LicenseServiceGenerateRequest {
  productType: GenerateLicenseRequest['productType'];
  type: GenerateLicenseRequest['type'];
  organizationId?: string;
  userId: string;
  hardwareId?: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  expiresAt?: string;
  // Notely AI activation fields
  activationLimit?: number;
  offlineGraceDays?: number;
  revalidationIntervalHours?: number;
}

interface LicenseServiceGenerateResponse {
  license?: License;
  licenseKey?: string;
  licenseId?: string;
  type?: GenerateLicenseRequest['type'];
  productType?: GenerateLicenseRequest['productType'];
  organizationId?: string;
  userId?: string;
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
  issuedAt?: string;
  expiresAt?: string;
  hardwareId?: string;
}
