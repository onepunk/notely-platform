/**
 * Card showing the Enterprise VM appliance license status
 * Displays license details including MAC address binding for enterprise deployments
 */

import { Card, CardContent, Stack, Typography, Button, Divider, Grid, Box, Chip } from '@mui/material';
import { Computer as ComputerIcon } from '@mui/icons-material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { LicenseStatusBadge } from '../shared/LicenseStatusBadge';
import { FeatureList } from '../shared/FeatureList';
import type { License, FeatureDefinition } from '@/types/license';
import { format } from 'date-fns';
import type { ReactNode } from 'react';

interface PortalLicenseCardProps {
  license: License;
  features?: FeatureDefinition[];
  onUpdate: () => void;
  title?: string;
  actions?: ReactNode;
  /** Override the features to display (for tier-based display) */
  displayFeatures?: string[];
  /** Hide the license status badge */
  hideStatus?: boolean;
  /** Custom subtitle text to display instead of status badge */
  subtitle?: string;
}

export function PortalLicenseCard({
  license,
  features = [],
  onUpdate,
  title = 'Enterprise License',
  actions,
  displayFeatures,
  hideStatus = false,
  subtitle,
}: PortalLicenseCardProps) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h5">{title}</Typography>
            {actions ? (
              actions
            ) : (
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={onUpdate}
              >
                Update License
              </Button>
            )}
          </Stack>

          {!hideStatus && <LicenseStatusBadge license={license} />}
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}

          <Divider />

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="caption" color="text.secondary">
                License ID
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {license.id}
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography variant="caption" color="text.secondary">
                License Type
              </Typography>
              <Typography variant="body1">
                {license.license_type === 'portal' ? 'Enterprise (VM Appliance)' : license.license_type}
              </Typography>
            </Grid>

            {license.organization_id && (
              <Grid item xs={12} md={6}>
                <Typography variant="caption" color="text.secondary">
                  Organization
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {license.organization_id}
                </Typography>
              </Grid>
            )}

            {license.hardware_id && (
              <Grid item xs={12} md={6}>
                <Typography variant="caption" color="text.secondary">
                  Bound MAC Address
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <ComputerIcon fontSize="small" color="action" />
                  <Chip
                    label={license.hardware_id}
                    size="small"
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
                  />
                </Box>
              </Grid>
            )}

            <Grid item xs={12} md={6}>
              <Typography variant="caption" color="text.secondary">
                Issued Date
              </Typography>
              <Typography variant="body1">
                {format(new Date(license.issued_at), 'PPP')}
              </Typography>
            </Grid>

            {license.expires_at && (
              <Grid item xs={12} md={6}>
                <Typography variant="caption" color="text.secondary">
                  Expiration Date
                </Typography>
                <Typography variant="body1">
                  {format(new Date(license.expires_at), 'PPP')}
                </Typography>
              </Grid>
            )}
          </Grid>

          <Divider />

          <Box>
            <Typography variant="subtitle1" gutterBottom>
              {displayFeatures ? 'Available Features' : 'Enabled Features'}
            </Typography>
            <FeatureList
              features={displayFeatures ?? license.features}
              featureDefinitions={features}
              variant="detailed"
            />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
