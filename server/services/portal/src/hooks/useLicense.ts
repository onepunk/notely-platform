/**
 * Hook for managing user license state
 */

import { useState, useEffect, useCallback } from 'react';
import { licenseClient } from '@/lib/licenseClient';
import type { License, LicenseValidationResponse, LicenseUsageStats } from '@/types/license';
import clientLogger from '@/lib/clientLogger';
import toast from 'react-hot-toast';

function extractErrorMessage(error: any, fallback: string): string {
  if (!error) {
    return fallback;
  }

  const responseError = error?.response?.data?.error;

  if (typeof responseError === 'string' && responseError.trim()) {
    return responseError;
  }

  if (responseError && typeof responseError === 'object') {
    if (typeof responseError.message === 'string' && responseError.message.trim()) {
      return responseError.message;
    }
    if (typeof responseError.code === 'string' && responseError.code.trim()) {
      return responseError.code;
    }
  }

  if (typeof error?.response?.data?.message === 'string' && error.response.data.message.trim()) {
    return error.response.data.message;
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function isNoLicenseError(error: any): boolean {
  const rawStatus = error?.response?.status ?? error?.status;
  const statusCode = typeof rawStatus === 'string' ? Number(rawStatus) : rawStatus;
  const errorCode = error?.response?.data?.error?.code;

  return statusCode === 404 || errorCode === 'NO_LICENSE';
}

function isUnauthorizedError(error: any): boolean {
  const rawStatus = error?.response?.status ?? error?.status;
  const statusCode = typeof rawStatus === 'string' ? Number(rawStatus) : rawStatus;
  const errorCode = error?.response?.data?.error;
  const message = error?.response?.data?.message || error?.message;

  if (statusCode === 401) {
    return true;
  }

  if (typeof errorCode === 'string' && errorCode.toLowerCase().includes('unauthorized')) {
    return true;
  }

  if (typeof message === 'string' && message.toLowerCase().includes('unauthorized')) {
    return true;
  }

  return false;
}

interface UseLicenseReturn {
  license: License | null;
  isLoading: boolean;
  error: string | null;
  usageStats: LicenseUsageStats | null;
  activateLicense: (licenseKey: string) => Promise<void>;
  refreshLicense: () => Promise<void>;
  validateLicense: (licenseKey: string) => Promise<LicenseValidationResponse>;
}

export function useLicense(): UseLicenseReturn {
  const [license, setLicense] = useState<License | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageStats, setUsageStats] = useState<LicenseUsageStats | null>(null);

  const fetchLicense = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await licenseClient.getCurrentLicense();
      setLicense(data ?? null);

      if (data) {
        const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
        const expiresInDays = expiresAt
          ? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null;

        setUsageStats({
          active_sessions: 0, // Will be populated by separate endpoint
          total_validations: 0,
          last_validation: null,
          expires_in_days: expiresInDays,
        });
      } else {
        setUsageStats(null);
      }
    } catch (err: any) {
      if (isNoLicenseError(err) || isUnauthorizedError(err)) {
        clientLogger.info('[useLicense] No active license for current user/org');
        setError(null);
        setLicense(null);
        setUsageStats(null);
      } else {
        const message = extractErrorMessage(err, 'Failed to load license');
        clientLogger.error('[useLicense] Failed to fetch license', { error: err?.message });
        setError(message);
        setLicense(null);
        setUsageStats(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLicense();
  }, [fetchLicense]);

  const activateLicense = useCallback(async (licenseKey: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Validate the license first
      const validation = await licenseClient.validateLicense(licenseKey);

      if (!validation.valid) {
        throw new Error(validation.reason || 'Invalid license key');
      }

      // Refresh license data
      await fetchLicense();
      toast.success('License activated successfully');
    } catch (err: any) {
      const errorMsg = extractErrorMessage(err, 'Failed to activate license');
      setError(errorMsg);
      toast.error(errorMsg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchLicense]);

  const validateLicense = useCallback(async (licenseKey: string): Promise<LicenseValidationResponse> => {
    try {
      return await licenseClient.validateLicense(licenseKey);
    } catch (err: any) {
      clientLogger.error('[useLicense] Validation failed', { error: err.message });
      throw err;
    }
  }, []);

  return {
    license,
    isLoading,
    error,
    usageStats,
    activateLicense,
    refreshLicense: fetchLicense,
    validateLicense,
  };
}
