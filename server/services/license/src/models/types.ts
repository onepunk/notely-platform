/**
 * TypeScript interfaces matching the licensing schema in the database
 */

/**
 * How a license was acquired
 */
export type LicenseGrantType = 'purchase' | 'beta' | 'trial' | 'promotional' | 'admin_grant';

/**
 * License record representing a Portal, Desktop, or Notely AI license
 */
export interface License {
  id: string;
  license_key: string;
  license_type: 'portal' | 'desktop' | 'notely-ai';
  organization_id: string | null;
  user_id: string | null;
  features: string[];  // JSONB array of feature keys (denormalized from tier)
  limits: Record<string, any>;  // JSONB object with limit configurations
  issued_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  revocation_reason: string | null;
  hardware_id: string | null;
  issued_by: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;

  // Tier reference (proper FK relationship)
  tier_id: string;

  // Grant type - how the license was acquired
  grant_type?: LicenseGrantType;

  // Activation fields (for notely-ai licenses)
  activation_limit?: number;       // Max number of email activations (default: 1)
  activation_count?: number;       // Current active activations
  offline_grace_days?: number;     // Days allowed offline (default: 30)
  revalidation_interval_hours?: number;  // Hours between required online checks (default: 168)

  // DEPRECATED: Use tier_id instead
  tier_key?: string;
}

/**
 * Tier record - defines what a tier is
 */
export interface Tier {
  id: string;
  tier_key: string;
  display_name: string;
  description: string | null;
  tier_level: number;
  is_active: boolean;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

/**
 * License validation record for tracking validation attempts
 */
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
  user_agent: string | null;
  request_metadata: Record<string, any>;  // JSONB
  validated_at: Date;
}

/**
 * Feature definition record
 */
export interface FeatureDefinition {
  id: string;
  feature_key: string;
  display_name: string;
  description: string | null;
  feature_category: 'desktop' | 'portal' | 'both';
  is_active: boolean;
  is_implemented: boolean;
  metadata: Record<string, any>;  // JSONB
  created_at: Date;
  updated_at: Date;
}

/**
 * Active session record for tracking concurrent usage
 */
export interface ActiveSession {
  id: string;
  user_id: string;
  client_id: string;
  session_token: string;
  license_id: string | null;
  organization_id: string | null;
  last_heartbeat: Date;
  first_seen: Date;
  client_version: string | null;
  platform: string | null;
  ip_address: string | null;
  is_active: boolean;
  metadata: Record<string, any>;  // JSONB
  created_at: Date;
}

/**
 * Input type for creating a new license (omits generated fields)
 */
export type CreateLicenseInput = Omit<License, 'id' | 'created_at' | 'updated_at'>;

/**
 * Input type for creating a new session
 */
export type CreateSessionInput = Omit<ActiveSession, 'id' | 'created_at' | 'first_seen' | 'last_heartbeat'>;

/**
 * Input type for logging a validation
 */
export type CreateValidationInput = Omit<LicenseValidation, 'id' | 'validated_at'>;
