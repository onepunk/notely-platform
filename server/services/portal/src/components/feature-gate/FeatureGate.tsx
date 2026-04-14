/**
 * FeatureGate Component
 * Controls access to features based on license entitlements
 */

import { ReactNode } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useFeatures } from '@/hooks/useFeatures';
import PlaceholderPage from '@/components/common/PlaceholderPage';

interface FeatureGateProps {
  featureKey: string;
  children: ReactNode;
  isImplemented?: boolean;
  placeholderTitle?: string;
  placeholderDescription?: string;
  placeholderIcon?: ReactNode;
  featureName?: string;
  upgradeDescription?: string;
  /** @deprecated Previously used for pricing upsell; accepted for backwards compatibility only. */
  upgradeBenefits?: string[];
}

const FeatureGate = ({
  featureKey,
  children,
  isImplemented = true,
  placeholderTitle,
  placeholderDescription,
  placeholderIcon,
  featureName,
  upgradeDescription,
}: FeatureGateProps) => {
  const { hasFeature, isLoading } = useFeatures();

  // Loading state
  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 400
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // Check if user has the feature
  const userHasFeature = hasFeature(featureKey);

  // User doesn't have the feature - show "not available" placeholder
  if (!userHasFeature) {
    return (
      <PlaceholderPage
        title={featureName || formatFeatureName(featureKey)}
        description={upgradeDescription || 'This feature is not available on your current license tier.'}
      />
    );
  }

  // User has the feature but it's not implemented yet - show placeholder
  if (!isImplemented) {
    return (
      <PlaceholderPage
        title={placeholderTitle || formatFeatureName(featureKey)}
        description={placeholderDescription}
        icon={placeholderIcon}
      />
    );
  }

  // User has the feature and it's implemented - render children
  return <>{children}</>;
};

/**
 * Formats a feature key into a readable name
 * Example: 'online-transcripts' -> 'Online Transcripts'
 */
function formatFeatureName(featureKey: string): string {
  return featureKey
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default FeatureGate;
