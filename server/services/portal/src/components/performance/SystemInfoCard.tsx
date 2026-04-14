/**
 * System Info Card Component
 * Displays system information (Mantis theme style)
 */

import { Card, CardContent, Stack, Box, Typography } from '@mui/material';
import { Computer as SystemIcon } from '@mui/icons-material';

interface SystemInfoCardProps {
  uptime?: number;
  platform?: string;
  arch?: string;
  hostname?: string;
  processes?: number;
}

/**
 * Format uptime seconds to readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  } else if (hours > 0) {
    return `${hours}h ${mins}m`;
  } else {
    return `${mins}m`;
  }
}

const SystemInfoCard = ({
  uptime = 0,
  platform = 'N/A',
  arch = 'N/A',
  hostname = 'N/A',
  processes = 0,
}: SystemInfoCardProps) => {
  const infoItems = [
    { label: 'Uptime', value: formatUptime(uptime) },
    { label: 'Platform', value: platform },
    { label: 'Architecture', value: arch },
    { label: 'Hostname', value: hostname },
    { label: 'Processes', value: processes.toString() },
  ];

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
          <Box sx={{ color: 'primary.main' }}>
            <SystemIcon />
          </Box>
          <Typography variant="h6">System Info</Typography>
        </Stack>

        <Stack spacing={2}>
          {infoItems.map((item) => (
            <Stack
              key={item.label}
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="body2" color="text.secondary">
                {item.label}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {item.value}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default SystemInfoCard;
