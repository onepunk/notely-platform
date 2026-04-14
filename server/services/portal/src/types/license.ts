/**
 * License Types for Portal
 * Mirrors the license service API types
 */

export type LicenseType = 'portal' | 'desktop' | 'notely-ai';
export type LicenseTerm = 'perpetual' | 'subscription' | 'trial';
export type LicenseStatus = 'active' | 'expired' | 'revoked' | 'pending';
export type TierType = 'free' | 'starter' | 'professional' | 'enterprise';

export type LicenseGrantType = 'purchase' | 'beta' | 'trial' | 'promotional' | 'admin_grant';

export interface License {
  id: string;
  license_key: string;
  license_type: LicenseType;
  organization_id: string | null;
  user_id: string | null;
  features: string[];
  limits: Record<string, any>;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  hardware_id: string | null;
  issued_by: string;
  notes: string | null;
  created_at: string;
  updated_at: string;

  // Resolved user email (from user_credentials JOIN)
  user_email?: string | null;

  // Tier information
  tier_id?: string | null;
  tier_key?: TierType;
  tier_name?: string;
  grant_type?: LicenseGrantType;
}

export interface LicenseValidationResponse {
  valid: boolean;
  license?: {
    type: LicenseType;
    features: string[];
    limits: Record<string, any>;
    organization_id: string | null;
    user_id: string | null;
    issued_at: string;
    expires_at: string | null;
  };
  error?: string;
  reason?: string;
}

export interface FeatureDefinition {
  id: string;
  feature_key: string;
  display_name: string;
  description: string | null;
  feature_category: 'desktop' | 'portal' | 'both';
  is_active: boolean;
}

export interface LicenseValidation {
  id: string;
  license_id: string | null;
  license_key_hash: string;
  is_valid: boolean;
  validation_type: 'online' | 'offline';
  failure_reason: string | null;
  validated_by_service: string;
  client_version: string | null;
  ip_address: string | null;
  validated_at: string;
}

export interface GenerateLicenseRequest {
  /**
   * Product family this license belongs to (portal vs desktop vs notely-ai).
   */
  productType: LicenseType;
  /**
   * Billing/entitlement term required by the license service.
   */
  type: LicenseTerm;
  organizationId?: string;
  userId: string;
  tier: TierType;
  expiresAt?: string;
  hardwareId?: string;
  notes?: string;
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
  /**
   * Maximum number of activations allowed (notely-ai only, default: 1, range: 1-100)
   */
  activationLimit?: number;
  /**
   * Number of days the license can work offline before requiring revalidation (notely-ai only, default: 30, range: 1-365)
   */
  offlineGraceDays?: number;
  /**
   * How often (in hours) the client should revalidate the license online (notely-ai only, default: 168 = 7 days, range: 1-720)
   */
  revalidationIntervalHours?: number;
}

export interface GeneratedLicense {
  licenseKey: string;
  licenseId: string;
  type: LicenseTerm;
  productType: LicenseType;
  organizationId: string | null;
  userId: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  issuedAt: string;
  expiresAt?: string;
  hardwareId?: string;
}

export interface ActiveSession {
  id: string;
  user_id: string;
  client_id: string;
  last_heartbeat: string;
  client_version: string | null;
  platform: string | null;
  is_active: boolean;
}

export interface LicenseUsageStats {
  active_sessions: number;
  total_validations: number;
  last_validation: string | null;
  expires_in_days: number | null;
}

/**
 * Tier definition with resolved feature list
 */
export interface TierWithFeatures {
  id: string;
  tier_key: string;
  display_name: string;
  description: string | null;
  tier_level: number;
  is_active: boolean;
  metadata: Record<string, any>;
  features: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Feature with implementation status and tier information
 */
export interface FeatureWithImplementation {
  feature_key: string;
  display_name: string;
  description: string | null;
  feature_category: 'desktop' | 'portal' | 'both';
  is_implemented: boolean;
  minimum_tier_key: string;
  minimum_tier_level: number;
}

/**
 * Response for tier features endpoint
 */
export interface TierFeaturesResponse {
  tier_key: string;
  features: string[];
  feature_details: FeatureWithImplementation[];
}
