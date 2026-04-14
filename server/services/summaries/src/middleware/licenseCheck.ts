import { Response, NextFunction } from 'express';
import { config } from '../config/env';
import { AuthenticatedRequest } from './auth';

interface LicenseResponse {
  valid: boolean;
  tier?: {
    id: string;
    name: string;
    features: Record<string, boolean>;
  };
  features?: Record<string, boolean>;
  error?: string;
}

export function licenseCheckMiddleware(requiredFeature: string) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      // Use GET /api/license/current with format=desktop for auth user's license status
      // (POST /validate is for validating raw license keys, not user sessions)
      const licenseUrl = `${config.license.url}/api/license/current?format=desktop`;

      const response = await fetch(licenseUrl, {
        method: 'GET',
        headers: {
          'Authorization': req.headers.authorization || '',
          'Content-Type': 'application/json',
          // License service is internal and expects pre-validated auth context
          'x-auth-subject': req.user.userId,
          'x-auth-email': req.user.email || '',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          res.status(401).json({ error: 'License validation failed: unauthorized' });
          return;
        }
        // License service returns 404 with { valid: false } for desktop format when user has no license
        if (response.status === 404) {
          const noLicenseData = (await response.json()) as { valid: boolean; reason?: string };
          res.status(403).json({
            error: 'No valid license',
            code: 'LICENSE_NOT_FOUND',
            reason: noLicenseData.reason || 'No license found for this user'
          });
          return;
        }
        console.error('License service error:', response.status, await response.text());
        res.status(503).json({ error: 'License service unavailable' });
        return;
      }

      const licenseData = (await response.json()) as LicenseResponse;

      if (!licenseData.valid) {
        res.status(403).json({
          error: 'No valid license',
          code: 'LICENSE_INVALID'
        });
        return;
      }

      // Check for the required feature
      const features = licenseData.features || licenseData.tier?.features || {};

      if (!features[requiredFeature]) {
        res.status(403).json({
          error: `Feature '${requiredFeature}' not available in your license tier`,
          code: 'FEATURE_NOT_AVAILABLE',
          requiredFeature,
          currentTier: licenseData.tier?.name || 'unknown'
        });
        return;
      }

      // Attach license info to request for downstream use
      (req as AuthenticatedRequest & { license?: LicenseResponse }).license = licenseData;

      next();
    } catch (error) {
      console.error('License check error:', error);
      res.status(503).json({ error: 'License service unavailable' });
    }
  };
}
