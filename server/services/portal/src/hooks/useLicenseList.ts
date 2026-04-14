/**
 * Hook for managing license list (admin use)
 */

import { useState, useEffect, useCallback } from 'react';
import { licenseClient } from '@/lib/licenseClient';
import type { License, FeatureDefinition } from '@/types/license';
import clientLogger from '@/lib/clientLogger';

interface Filters {
  license_type?: string;
  organization_id?: string;
  user_id?: string;
  status?: string;
}

interface UseLicenseListReturn {
  licenses: License[];
  features: FeatureDefinition[];
  total: number;
  isLoading: boolean;
  error: string | null;
  filters: Filters;
  pagination: {
    limit: number;
    offset: number;
  };
  setFilters: (filters: Filters) => void;
  setPagination: (pagination: { limit: number; offset: number }) => void;
  refreshLicenses: () => Promise<void>;
  revokeLicense: (licenseId: string, reason?: string) => Promise<void>;
}

export function useLicenseList(): UseLicenseListReturn {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [features, setFeatures] = useState<FeatureDefinition[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ status: 'active' });
  const [pagination, setPagination] = useState({ limit: 20, offset: 0 });

  const fetchLicenses = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [licenseData, featureData] = await Promise.all([
        licenseClient.listLicenses({ ...filters, ...pagination }),
        licenseClient.getFeatures(),
      ]);

      setLicenses(licenseData.licenses);
      setTotal(licenseData.total);
      setFeatures(featureData.features);
    } catch (err: any) {
      clientLogger.error('[useLicenseList] Failed to fetch licenses', { error: err.message });
      setError(err?.response?.data?.error || err?.message || 'Failed to load licenses');
    } finally {
      setIsLoading(false);
    }
  }, [filters, pagination]);

  useEffect(() => {
    fetchLicenses();
  }, [fetchLicenses]);

  const revokeLicense = useCallback(async (licenseId: string, reason?: string) => {
    try {
      await licenseClient.revokeLicense(licenseId, reason);
      await fetchLicenses(); // Refresh list
    } catch (err: any) {
      clientLogger.error('[useLicenseList] Failed to revoke license', { error: err.message });
      throw err;
    }
  }, [fetchLicenses]);

  return {
    licenses,
    features,
    total,
    isLoading,
    error,
    filters,
    pagination,
    setFilters,
    setPagination,
    refreshLicenses: fetchLicenses,
    revokeLicense,
  };
}
