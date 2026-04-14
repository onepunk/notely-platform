/**
 * Data access layer exports
 *
 * This module exports all repository classes and singleton instances
 * for easy importing throughout the application.
 *
 * Example usage:
 * ```typescript
 * import { licenseRepository, License } from './data';
 *
 * const license = await licenseRepository.findById('some-uuid');
 * ```
 */

// Repository classes
export { LicenseRepository } from './LicenseRepository';
export { ValidationRepository } from './ValidationRepository';
export { FeatureRepository } from './FeatureRepository';
export { SessionRepository } from './SessionRepository';
export { TierRepository } from './TierRepository';
export { ActivationRepository } from './ActivationRepository';

// Singleton instances (recommended for use)
export { licenseRepository } from './LicenseRepository';
export { validationRepository } from './ValidationRepository';
export { featureRepository } from './FeatureRepository';
export { sessionRepository } from './SessionRepository';
export { tierRepository } from './TierRepository';
export { activationRepository } from './ActivationRepository';

// Type definitions
export type {
  License,
  LicenseValidation,
  FeatureDefinition,
  ActiveSession,
  CreateLicenseInput,
  CreateSessionInput,
  CreateValidationInput,
} from '../models/types';

export type {
  Tier,
  TierWithFeatures,
  CreateTierInput,
  UpdateTierInput,
} from './TierRepository';

export type {
  LicenseActivation,
  CreateActivationInput,
  ActivationWithLicense,
} from './ActivationRepository';
