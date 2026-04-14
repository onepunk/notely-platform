/**
 * Placeholder Page Component
 * Used for pages that are not yet implemented
 */

import { ReactNode } from 'react';
import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { Construction as ConstructionIcon } from '@mui/icons-material';

interface PlaceholderPageProps {
  title: string;
  description?: string;
  icon?: ReactNode;
}

const PlaceholderPage = ({ title, description, icon }: PlaceholderPageProps) => {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
      <Card sx={{ maxWidth: 500, textAlign: 'center' }}>
        <CardContent>
          <Stack spacing={3} alignItems="center">
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: 'warning.lighter',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'warning.main',
              }}
            >
              {icon || <ConstructionIcon sx={{ fontSize: 40 }} />}
            </Box>
            <Stack spacing={1}>
              <Typography variant="h4" fontWeight={600}>
                {title}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {description || 'This page is under construction and will be available soon.'}
              </Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default PlaceholderPage;
