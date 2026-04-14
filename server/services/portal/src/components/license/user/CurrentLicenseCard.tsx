/**
 * Card displaying current license details
 */

import { Card, CardContent, Stack, Typography, Box, Divider, Grid } from '@mui/material';
import { LicenseStatusBadge } from '../shared/LicenseStatusBadge';
import { FeatureList } from '../shared/FeatureList';
import type { License, FeatureDefinition } from '@/types/license';
import { format } from 'date-fns';

interface CurrentLicenseCardProps {
  license: License;
  features: FeatureDefinition[];
}

export function CurrentLicenseCard({ license, features }: CurrentLicenseCardProps) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h5">Current License</Typography>
            <LicenseStatusBadge license={license} />
          </Stack>

          <Divider />

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="caption" color="text.secondary">
                License Type
              </Typography>
              <Typography variant="body1" textTransform="capitalize">
                {license.license_type}
              </Typography>
            </Grid>

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

            {license.organization_id && (
              <Grid item xs={12} md={6}>
                <Typography variant="caption" color="text.secondary">
                  Organization ID
                </Typography>
                <Typography variant="body1" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {license.organization_id}
                </Typography>
              </Grid>
            )}
          </Grid>

          <Divider />

          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Enabled Features
            </Typography>
            <FeatureList
              features={license.features}
              featureDefinitions={features}
              variant="detailed"
            />
          </Box>

          {Object.keys(license.limits).length > 0 && (
            <>
              <Divider />
              <Box>
                <Typography variant="subtitle1" gutterBottom>
                  Limits
                </Typography>
                <Grid container spacing={2}>
                  {Object.entries(license.limits).map(([key, value]) => (
                    <Grid item xs={6} md={4} key={key}>
                      <Typography variant="caption" color="text.secondary">
                        {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </Typography>
                      <Typography variant="body1">
                        {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}
                      </Typography>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
