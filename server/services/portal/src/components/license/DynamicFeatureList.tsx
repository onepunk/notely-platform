/**
 * Dynamic Feature List Component
 * Displays features with "Available Now" vs "Coming Soon" indicators
 * Fetches features dynamically from the license service based on tier
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  CircularProgress,
  Alert,
  Divider,
  Stack,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import type { FeatureWithImplementation } from '@/types/license';
import { licenseClient } from '@/lib/licenseClient';

export interface DynamicFeatureListProps {
  /**
   * Tier key to fetch features for. Defaults to "professional" if not provided.
   */
  tierKey?: string;
  /**
   * Whether to show "Coming Soon" features. Defaults to true.
   */
  showComingSoon?: boolean;
  /**
   * If true, use dense list styling for a more compact appearance.
   */
  compact?: boolean;
}

export function DynamicFeatureList({
  tierKey = 'professional',
  showComingSoon = true,
  compact = false,
}: DynamicFeatureListProps) {
  const [features, setFeatures] = useState<FeatureWithImplementation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFeatures = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await licenseClient.getTierFeatures(tierKey);

      // Filter to show only portal-relevant features
      const portalFeatures = response.feature_details.filter(
        (feature) =>
          feature.feature_category === 'portal' || feature.feature_category === 'both'
      );

      setFeatures(portalFeatures);
    } catch (err) {
      console.error('Failed to fetch tier features:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load features';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [tierKey]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (features.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No features available for this tier
      </Typography>
    );
  }

  // Group features by implementation status
  const implementedFeatures = features.filter((f) => f.is_implemented);
  const comingSoonFeatures = features.filter((f) => !f.is_implemented);

  return (
    <Stack spacing={compact ? 2 : 3}>
      {/* Available Now Section */}
      {implementedFeatures.length > 0 && (
        <Box>
          <Typography
            variant={compact ? 'subtitle2' : 'subtitle1'}
            fontWeight={600}
            gutterBottom
            color="success.main"
          >
            Available Now
          </Typography>
          <List dense={compact} disablePadding>
            {implementedFeatures.map((feature, index) => (
              <ListItem
                key={feature.feature_key}
                disableGutters
                sx={{
                  py: compact ? 0.5 : 1,
                  borderBottom:
                    index < implementedFeatures.length - 1 && !compact
                      ? '1px solid'
                      : 'none',
                  borderColor: 'divider',
                }}
              >
                <ListItemIcon sx={{ minWidth: compact ? 32 : 40 }}>
                  <CheckCircleIcon
                    color="success"
                    fontSize={compact ? 'small' : 'medium'}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      variant={compact ? 'body2' : 'body1'}
                      fontWeight={compact ? 400 : 500}
                    >
                      {feature.display_name}
                    </Typography>
                  }
                  secondary={
                    !compact && feature.description ? (
                      <Typography variant="body2" color="text.secondary">
                        {feature.description}
                      </Typography>
                    ) : undefined
                  }
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {/* Divider between sections */}
      {implementedFeatures.length > 0 && showComingSoon && comingSoonFeatures.length > 0 && (
        <Divider />
      )}

      {/* Coming Soon Section */}
      {showComingSoon && comingSoonFeatures.length > 0 && (
        <Box>
          <Typography
            variant={compact ? 'subtitle2' : 'subtitle1'}
            fontWeight={600}
            gutterBottom
            color="warning.main"
          >
            Coming Soon
          </Typography>
          <List dense={compact} disablePadding>
            {comingSoonFeatures.map((feature, index) => (
              <ListItem
                key={feature.feature_key}
                disableGutters
                sx={{
                  py: compact ? 0.5 : 1,
                  borderBottom:
                    index < comingSoonFeatures.length - 1 && !compact
                      ? '1px solid'
                      : 'none',
                  borderColor: 'divider',
                }}
              >
                <ListItemIcon sx={{ minWidth: compact ? 32 : 40 }}>
                  <ScheduleIcon
                    color="warning"
                    fontSize={compact ? 'small' : 'medium'}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      variant={compact ? 'body2' : 'body1'}
                      fontWeight={compact ? 400 : 500}
                    >
                      {feature.display_name}
                    </Typography>
                  }
                  secondary={
                    !compact && feature.description ? (
                      <Typography variant="body2" color="text.secondary">
                        {feature.description}
                      </Typography>
                    ) : undefined
                  }
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Stack>
  );
}

// Default export for easier importing
export default DynamicFeatureList;
