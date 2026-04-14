/**
 * TypeScript interfaces for the tier system in the licensing schema
 */

import { FeatureDefinition } from './types';

/**
 * Tier definition record from database
 */
export interface Tier {
  id: string;
  tier_key: string;
  display_name: string;
  description: string | null;
  tier_level: number;
  is_active: boolean;
  metadata: Record<string, any>;  // JSONB
  created_at: Date;
  updated_at: Date;
}

/**
 * Tier with its features resolved as an array of feature_key values
 */
export interface TierWithFeatures extends Tier {
  features: string[];  // Array of feature_key values
}

/**
 * Tier with full feature details
 */
export interface TierWithFeatureDetails extends Tier {
  features: FeatureDefinition[];
}

/**
 * Input type for creating a new tier
 */
export type CreateTierInput = {
  tier_key: string;
  display_name: string;
  description?: string;
  tier_level: number;
  is_active?: boolean;
  metadata?: Record<string, any>;
};

/**
 * Input type for updating a tier (partial update, tier_key is immutable)
 */
export type UpdateTierInput = Partial<Omit<CreateTierInput, 'tier_key'>>;

/**
 * Tier-feature mapping record
 */
export interface TierFeature {
  id: string;
  tier_id: string;
  feature_id: string;
  granted_at: Date;
  granted_by: string | null;
  notes: string | null;
}

/**
 * Feature with implementation status and tier information
 */
export interface FeatureWithImplementation {
  id: string;
  feature_key: string;
  display_name: string;
  description: string | null;
  feature_category: 'desktop' | 'portal' | 'both';
  is_active: boolean;
  is_implemented: boolean;
  metadata: Record<string, any>;  // JSONB
  minimum_tier_key?: string;
  minimum_tier_level?: number;
}

/**
 * API response type for listing tiers
 */
export interface TiersResponse {
  tiers: TierWithFeatures[];
}

/**
 * API response type for a single tier
 */
export interface TierResponse {
  tier: TierWithFeatures;
}

/**
 * API response type for tier features
 */
export interface TierFeaturesResponse {
  tier_key: string;
  features: string[];
  feature_details: FeatureWithImplementation[];
}
