/**
 * Display list of enabled features with descriptions
 */

import { Box, Stack, Typography, Chip } from '@mui/material';
import { Check as CheckIcon } from '@mui/icons-material';
import type { FeatureDefinition } from '@/types/license';

interface FeatureListProps {
  features: string[];
  featureDefinitions: FeatureDefinition[];
  variant?: 'detailed' | 'compact';
}

function formatFeatureLabel(key: string): string {
  if (!key) return '';
  return key
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function FeatureList({ features, featureDefinitions, variant = 'detailed' }: FeatureListProps) {
  if (!features || features.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        No features enabled
      </Typography>
    );
  }

  const matchedDefinitions = featureDefinitions.filter((def) =>
    features.includes(def.feature_key)
  );

  const resolvedFeatures = matchedDefinitions.length > 0
    ? matchedDefinitions.map((def) => ({
        key: def.feature_key,
        label: def.display_name,
        description: def.description,
      }))
    : features.map((featureKey) => ({
        key: featureKey,
        label: formatFeatureLabel(featureKey),
        description: undefined,
      }));

  if (variant === 'compact') {
    return (
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {resolvedFeatures.map((feature) => (
          <Chip
            key={feature.key}
            label={feature.label}
            size="small"
            icon={<CheckIcon />}
          />
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {resolvedFeatures.map((feature) => (
        <Box key={feature.key}>
          <Stack direction="row" spacing={1} alignItems="center">
            <CheckIcon color="success" fontSize="small" />
            <Typography variant="body1" fontWeight={600}>
              {feature.label}
            </Typography>
          </Stack>
          {feature.description && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 3 }}>
              {feature.description}
            </Typography>
          )}
        </Box>
      ))}
    </Stack>
  );
}
