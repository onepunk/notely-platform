/**
 * Service Status Card Component
 * Displays a summary metric for services (running, healthy, total, etc.)
 * Clean, minimal design matching Releases page styling
 */

import { ReactNode } from 'react';
import { Card, CardContent, Stack, Box, Typography } from '@mui/material';

interface ServiceStatusCardProps {
  icon: ReactNode;
  value: number;
  label: string;
  color?: 'success' | 'info' | 'error' | 'warning';
}

const ServiceStatusCard = ({ icon, value, label, color = 'info' }: ServiceStatusCardProps) => {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Box
            sx={{
              color: `${color}.main`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography variant="h5">{value}</Typography>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ServiceStatusCard;
