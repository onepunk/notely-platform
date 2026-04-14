/**
 * Services Layer Exports
 *
 * Central export point for all service modules in the license service.
 * Services provide business logic and orchestration for license operations.
 */

// Key Manager - RSA key pair management
export * as keyManager from './keyManager';
export { initialize as initializeKeyManager, isInitialized as isKeyManagerInitialized } from './keyManager';

// License Generator - Create new licenses
export {
  generateLicense,
  GenerateLicenseParams,
  GenerateLicenseResult,
  LicenseValidationError,
} from './licenseGenerator';

// License Validator - Validate existing licenses
export {
  validateLicense,
  validateLicenseSync,
  ValidationResult,
  ValidationErrorCode,
} from './licenseValidator';

// Feature Flag Service - Manage feature flags
export * from './featureFlagService';

// Activation Service - License activation with email binding
export {
  activateLicense,
  revalidateLicense,
  deactivateLicense,
  type ActivateParams,
  type ActivationResult,
  type ActivationError,
  type ActivationErrorCode,
  type RevalidateParams,
  type RevalidationResult,
} from './activationService';
