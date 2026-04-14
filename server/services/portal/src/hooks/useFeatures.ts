/**
 * Hook for checking feature flags from license
 */

import { useMemo } from 'react';
import { useLicense } from './useLicense';

interface UseFeatures {
  hasFeature: (featureKey: string) => boolean;
  enabledFeatures: string[];
  isLoading: boolean;
}

export function useFeatures(): UseFeatures {
  const { license, isLoading } = useLicense();

  const enabledFeatures = useMemo(() => {
    return license?.features || [];
  }, [license]);

  const hasFeature = useMemo(() => {
    return (featureKey: string): boolean => {
      return enabledFeatures.includes(featureKey);
    };
  }, [enabledFeatures]);

  return {
    hasFeature,
    enabledFeatures,
    isLoading,
  };
}
