/**
 * Tier Controller
 *
 * Handles tier and tier-feature management operations
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { tierRepository, featureRepository } from '../../data';
import { logger } from '../../utils/logger';

// ============================================================================
// Validation Schemas
// ============================================================================

const createTierSchema = z.object({
  tier_key: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/),
  display_name: z.string().min(1).max(100),
  description: z.string().nullable().optional().default(null),
  tier_level: z.number().int().min(0),
  is_active: z.boolean().optional().default(true),
  metadata: z.record(z.any()).optional().default({}),
});

const updateTierSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

const setTierFeaturesSchema = z.object({
  features: z.array(z.string()),
});

const updateImplementationSchema = z.object({
  is_implemented: z.boolean(),
});

const createFeatureSchema = z.object({
  feature_key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_-]*$/, {
    message: 'Feature key must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores',
  }),
  display_name: z.string().min(1).max(200),
  description: z.string().nullable().optional().default(null),
  feature_category: z.enum(['desktop', 'portal', 'both']).default('both'),
  is_implemented: z.boolean().optional().default(false),
  metadata: z.record(z.any()).optional().default({}),
});

const updateFeatureSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  feature_category: z.enum(['desktop', 'portal', 'both']).optional(),
  is_implemented: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

// ============================================================================
// Public Endpoints
// ============================================================================

/**
 * GET /api/license/tiers
 * List all active tiers with their features
 */
export async function listTiers(req: Request, res: Response): Promise<void> {
  try {
    const tiers = await tierRepository.getAllWithFeatures();

    res.json({
      success: true,
      data: { tiers },
    });
  } catch (error) {
    logger.error('Failed to list tiers', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tiers' },
    });
  }
}

/**
 * GET /api/license/tiers/:tierKey
 * Get a single tier by key with all its features
 */
export async function getTier(req: Request, res: Response): Promise<void> {
  try {
    const { tierKey } = req.params;

    const tier = await tierRepository.getByKeyWithFeatures(tierKey);

    if (!tier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Tier '${tierKey}' not found` },
      });
      return;
    }

    res.json({
      success: true,
      data: { tier },
    });
  } catch (error) {
    logger.error('Failed to get tier', { error, tierKey: req.params.tierKey });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tier' },
    });
  }
}

/**
 * GET /api/license/tiers/:tierKey/features
 * Get features for a specific tier (includes inherited features)
 */
export async function getTierFeatures(req: Request, res: Response): Promise<void> {
  try {
    const { tierKey } = req.params;

    // Check if tier exists
    const tier = await tierRepository.getByKey(tierKey);
    if (!tier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Tier '${tierKey}' not found` },
      });
      return;
    }

    // Get features with full details
    const featureDetails = await featureRepository.getFeaturesForTierWithDetails(tierKey);
    const features = featureDetails.map(f => f.feature_key);

    res.json({
      success: true,
      data: {
        tier_key: tierKey,
        features,
        feature_details: featureDetails,
      },
    });
  } catch (error) {
    logger.error('Failed to get tier features', { error, tierKey: req.params.tierKey });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tier features' },
    });
  }
}

// ============================================================================
// Admin Endpoints
// ============================================================================

/**
 * GET /api/license/admin/tiers
 * List all tiers (including inactive) for admin
 */
export async function adminListTiers(req: Request, res: Response): Promise<void> {
  try {
    const tiers = await tierRepository.getAll();
    const tiersWithFeatures = await Promise.all(
      tiers.map(async tier => ({
        ...tier,
        features: await tierRepository.getDirectFeaturesForTier(tier.id),
      }))
    );

    res.json({
      success: true,
      data: { tiers: tiersWithFeatures },
    });
  } catch (error) {
    logger.error('Failed to list all tiers', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tiers' },
    });
  }
}

/**
 * POST /api/license/admin/tiers
 * Create a new tier
 */
export async function adminCreateTier(req: Request, res: Response): Promise<void> {
  try {
    const parsed = createTierSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid tier data',
          details: parsed.error.format(),
        },
      });
      return;
    }

    const tierData = parsed.data;

    // Check if tier_key already exists
    const existing = await tierRepository.getByKey(tierData.tier_key);
    if (existing) {
      res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: `Tier key '${tierData.tier_key}' already exists` },
      });
      return;
    }

    // Check if tier_level is available
    const levelAvailable = await tierRepository.isTierLevelAvailable(tierData.tier_level);
    if (!levelAvailable) {
      res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: `Tier level ${tierData.tier_level} is already in use` },
      });
      return;
    }

    const tier = await tierRepository.create(tierData);

    logger.info('Tier created', { tierKey: tier.tier_key, adminId: (req as any).user?.id });

    res.status(201).json({
      success: true,
      data: { tier },
    });
  } catch (error) {
    logger.error('Failed to create tier', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create tier' },
    });
  }
}

/**
 * PUT /api/license/admin/tiers/:id
 * Update a tier's metadata
 */
export async function adminUpdateTier(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const parsed = updateTierSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid update data',
          details: parsed.error.format(),
        },
      });
      return;
    }

    const tier = await tierRepository.getById(id);
    if (!tier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tier not found' },
      });
      return;
    }

    await tierRepository.update(id, parsed.data);

    const updated = await tierRepository.getById(id);

    logger.info('Tier updated', { tierId: id, adminId: (req as any).user?.id });

    res.json({
      success: true,
      data: { tier: updated },
    });
  } catch (error) {
    logger.error('Failed to update tier', { error, tierId: req.params.id });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update tier' },
    });
  }
}

/**
 * PUT /api/license/admin/tiers/:id/features
 * Set all features for a tier (replaces existing)
 */
export async function adminSetTierFeatures(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const parsed = setTierFeaturesSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid features data',
          details: parsed.error.format(),
        },
      });
      return;
    }

    const tier = await tierRepository.getById(id);
    if (!tier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tier not found' },
      });
      return;
    }

    // Validate all feature keys exist
    const invalidFeatures = await featureRepository.getInvalidFeatures(parsed.data.features);
    if (invalidFeatures.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FEATURES',
          message: `Invalid feature keys: ${invalidFeatures.join(', ')}`,
        },
      });
      return;
    }

    await tierRepository.setTierFeatures(id, parsed.data.features);

    const features = await tierRepository.getDirectFeaturesForTier(id);

    logger.info('Tier features updated', {
      tierId: id,
      tierKey: tier.tier_key,
      features: parsed.data.features,
      adminId: (req as any).user?.id,
    });

    res.json({
      success: true,
      data: {
        tier_id: id,
        tier_key: tier.tier_key,
        features,
      },
    });
  } catch (error) {
    logger.error('Failed to set tier features', { error, tierId: req.params.id });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to set tier features' },
    });
  }
}

/**
 * POST /api/license/admin/tiers/:id/features/:featureKey
 * Add a single feature to a tier
 */
export async function adminAddFeatureToTier(req: Request, res: Response): Promise<void> {
  try {
    const { id, featureKey } = req.params;

    const tier = await tierRepository.getById(id);
    if (!tier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tier not found' },
      });
      return;
    }

    const feature = await featureRepository.getByKey(featureKey);
    if (!feature) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Feature '${featureKey}' not found` },
      });
      return;
    }

    await tierRepository.addFeatureToTier(id, featureKey);

    const features = await tierRepository.getDirectFeaturesForTier(id);

    logger.info('Feature added to tier', {
      tierId: id,
      tierKey: tier.tier_key,
      featureKey,
      adminId: (req as any).user?.id,
    });

    res.json({
      success: true,
      data: {
        tier_id: id,
        tier_key: tier.tier_key,
        features,
      },
    });
  } catch (error) {
    logger.error('Failed to add feature to tier', {
      error,
      tierId: req.params.id,
      featureKey: req.params.featureKey,
    });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to add feature to tier' },
    });
  }
}

/**
 * DELETE /api/license/admin/tiers/:id/features/:featureKey
 * Remove a feature from a tier
 */
export async function adminRemoveFeatureFromTier(req: Request, res: Response): Promise<void> {
  try {
    const { id, featureKey } = req.params;

    const tier = await tierRepository.getById(id);
    if (!tier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tier not found' },
      });
      return;
    }

    await tierRepository.removeFeatureFromTier(id, featureKey);

    const features = await tierRepository.getDirectFeaturesForTier(id);

    logger.info('Feature removed from tier', {
      tierId: id,
      tierKey: tier.tier_key,
      featureKey,
      adminId: (req as any).user?.id,
    });

    res.json({
      success: true,
      data: {
        tier_id: id,
        tier_key: tier.tier_key,
        features,
      },
    });
  } catch (error) {
    logger.error('Failed to remove feature from tier', {
      error,
      tierId: req.params.id,
      featureKey: req.params.featureKey,
    });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to remove feature from tier' },
    });
  }
}

/**
 * PUT /api/license/admin/features/:featureKey/implementation
 * Set the implementation status of a feature
 */
export async function adminUpdateFeatureImplementation(req: Request, res: Response): Promise<void> {
  try {
    const { featureKey } = req.params;
    const parsed = updateImplementationSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid data',
          details: parsed.error.format(),
        },
      });
      return;
    }

    const feature = await featureRepository.getByKey(featureKey);
    if (!feature) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Feature '${featureKey}' not found` },
      });
      return;
    }

    await featureRepository.updateImplementationStatus(featureKey, parsed.data.is_implemented);

    const updated = await featureRepository.getByKey(featureKey);

    logger.info('Feature implementation status updated', {
      featureKey,
      isImplemented: parsed.data.is_implemented,
      adminId: (req as any).user?.id,
    });

    res.json({
      success: true,
      data: { feature: updated },
    });
  } catch (error) {
    logger.error('Failed to update feature implementation', {
      error,
      featureKey: req.params.featureKey,
    });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update feature' },
    });
  }
}

/**
 * DELETE /api/license/admin/tiers/:id
 * Deactivate (soft delete) a tier
 */
export async function adminDeactivateTier(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const tier = await tierRepository.getById(id);
    if (!tier) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tier not found' },
      });
      return;
    }

    // Prevent deactivating the 'free' tier
    if (tier.tier_key === 'free') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_OPERATION', message: 'Cannot deactivate the free tier' },
      });
      return;
    }

    await tierRepository.deactivate(id);

    logger.info('Tier deactivated', {
      tierId: id,
      tierKey: tier.tier_key,
      adminId: (req as any).user?.id,
    });

    res.json({
      success: true,
      message: 'Tier deactivated successfully',
    });
  } catch (error) {
    logger.error('Failed to deactivate tier', { error, tierId: req.params.id });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to deactivate tier' },
    });
  }
}

// ============================================================================
// Feature CRUD Endpoints
// ============================================================================

/**
 * POST /api/license/admin/features
 * Create a new feature definition
 */
export async function adminCreateFeature(req: Request, res: Response): Promise<void> {
  try {
    const parsed = createFeatureSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid feature data',
          details: parsed.error.format(),
        },
      });
      return;
    }

    const featureData = parsed.data;

    // Check if feature_key already exists
    const existing = await featureRepository.getByKey(featureData.feature_key);
    if (existing) {
      res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: `Feature key '${featureData.feature_key}' already exists` },
      });
      return;
    }

    const feature = await featureRepository.create({
      feature_key: featureData.feature_key,
      display_name: featureData.display_name,
      description: featureData.description,
      feature_category: featureData.feature_category,
      is_active: true,
      is_implemented: featureData.is_implemented,
      metadata: featureData.metadata,
    });

    logger.info('Feature created', { featureKey: feature.feature_key, adminId: (req as any).user?.id });

    res.status(201).json({
      success: true,
      data: { feature },
    });
  } catch (error) {
    logger.error('Failed to create feature', { error });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create feature' },
    });
  }
}

/**
 * PUT /api/license/admin/features/:featureKey
 * Update a feature definition
 */
export async function adminUpdateFeature(req: Request, res: Response): Promise<void> {
  try {
    const { featureKey } = req.params;
    const parsed = updateFeatureSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid update data',
          details: parsed.error.format(),
        },
      });
      return;
    }

    const feature = await featureRepository.getByKey(featureKey);
    if (!feature) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Feature '${featureKey}' not found` },
      });
      return;
    }

    await featureRepository.update(feature.id, parsed.data);

    const updated = await featureRepository.getByKey(featureKey);

    logger.info('Feature updated', { featureKey, adminId: (req as any).user?.id });

    res.json({
      success: true,
      data: { feature: updated },
    });
  } catch (error) {
    logger.error('Failed to update feature', { error, featureKey: req.params.featureKey });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update feature' },
    });
  }
}

/**
 * DELETE /api/license/admin/features/:featureKey
 * Deactivate (soft delete) a feature
 */
export async function adminDeleteFeature(req: Request, res: Response): Promise<void> {
  try {
    const { featureKey } = req.params;

    const feature = await featureRepository.getByKey(featureKey);
    if (!feature) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Feature '${featureKey}' not found` },
      });
      return;
    }

    await featureRepository.deactivate(feature.id);

    logger.info('Feature deactivated', { featureKey, adminId: (req as any).user?.id });

    res.json({
      success: true,
      message: 'Feature deactivated successfully',
    });
  } catch (error) {
    logger.error('Failed to delete feature', { error, featureKey: req.params.featureKey });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete feature' },
    });
  }
}
