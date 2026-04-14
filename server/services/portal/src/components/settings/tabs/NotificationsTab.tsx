/**
 * Notifications Settings Tab
 * Email and in-app notification preferences (placeholder for future implementation)
 */

import { Card, CardContent, Stack, Typography } from '@mui/material';
import { Notifications as NotificationsIcon } from '@mui/icons-material';

export default function NotificationsTab() {
  return (
    <Card sx={{ borderRadius: 4 }}>
      <CardContent>
        <Stack spacing={3} alignItems="center" py={4}>
          <NotificationsIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
          <Typography variant="h6" color="text.secondary">
            Notification Settings
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Notification preferences and settings will be available soon.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
