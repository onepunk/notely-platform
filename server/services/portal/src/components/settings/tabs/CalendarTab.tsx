/**
 * Calendar Settings Tab
 * Microsoft Outlook calendar integration
 */

import { useState, useEffect, useCallback } from 'react';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import {
  CalendarMonth as CalendarMonthIcon,
  LinkOff as LinkOffIcon,
  CheckCircle as CheckCircleIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import settingsService, { CalendarStatus } from '@/services/settingsService';

export default function CalendarTab() {
  const { refreshProfile } = useAuth();
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  const loadCalendarStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await settingsService.getCalendarStatus();
      setCalendarStatus(data);
    } catch (error) {
      clientLogger.error('[CalendarTab] Failed to load calendar status', { error: error instanceof Error ? error.message : String(error) });
      setCalendarStatus({ connected: false });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    setShowDisconnectDialog(false);

    try {
      const result = await settingsService.disconnectCalendar();

      if (!result.success) {
        throw new Error(result.error || 'Failed to disconnect calendar');
      }

      toast.success('Calendar disconnected successfully');

      // Refresh calendar status
      setCalendarStatus({ connected: false });

      // Refresh user profile
      await refreshProfile();

      // Reload status
      loadCalendarStatus();
    } catch (error: any) {
      clientLogger.error('[CalendarTab] Failed to disconnect calendar', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error?.message || 'Unable to disconnect calendar');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const formatLastSyncTime = (timestamp: string | null | undefined) => {
    if (!timestamp) return 'Never';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

    return date.toLocaleDateString();
  };

  useEffect(() => {
    loadCalendarStatus();
  }, [loadCalendarStatus]);

  if (isLoading) {
    return (
      <Card sx={{ borderRadius: 4 }}>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="center" py={4}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary" ml={2}>
              Loading calendar settings...
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card sx={{ borderRadius: 4 }}>
        <CardContent>
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6" gutterBottom>
                Calendar Integration
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Connect your calendar to sync meetings and enable Teams bot access
              </Typography>
            </Box>

            <Stack spacing={2}>
              <Box display="flex" alignItems="center" gap={2}>
                <CalendarMonthIcon color={calendarStatus?.connected ? 'primary' : 'disabled'} />
                <Box flex={1}>
                  <Typography variant="body1" fontWeight={500}>
                    Microsoft Outlook
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {calendarStatus?.connected
                      ? 'Sync your meetings and enable Teams bot access'
                      : 'Not connected'}
                  </Typography>
                </Box>
                <Chip
                  icon={calendarStatus?.connected ? <CheckCircleIcon /> : undefined}
                  label={calendarStatus?.connected ? 'Connected' : 'Not connected'}
                  color={calendarStatus?.connected ? 'success' : 'default'}
                  variant="outlined"
                  size="small"
                />
              </Box>

              {calendarStatus?.connected && (
                <>
                  <Box display="flex" alignItems="center" gap={1}>
                    <SyncIcon fontSize="small" color="action" />
                    <Typography variant="body2" color="text.secondary">
                      Last synced: {formatLastSyncTime(calendarStatus.lastSyncTime)}
                    </Typography>
                  </Box>

                  {calendarStatus?.syncStatus && calendarStatus.syncStatus !== 'idle' && (
                    <Alert severity="info" variant="outlined">
                      Sync status: {calendarStatus.syncStatus}
                    </Alert>
                  )}

                  {calendarStatus?.errorMessage && (
                    <Alert severity="warning" variant="outlined">
                      {calendarStatus.errorMessage}
                    </Alert>
                  )}

                  <Box mt={2}>
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<LinkOffIcon />}
                      onClick={() => setShowDisconnectDialog(true)}
                      disabled={isDisconnecting}
                    >
                      {isDisconnecting ? 'Disconnecting...' : 'Disconnect Calendar'}
                    </Button>
                  </Box>
                </>
              )}

              {!calendarStatus?.connected && (
                <Alert severity="info" variant="outlined">
                  Connect your Microsoft Outlook calendar to automatically sync meetings and enable the
                  Notely bot to join Teams calls.
                </Alert>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Disconnect Confirmation Dialog */}
      <Dialog
        open={showDisconnectDialog}
        onClose={() => setShowDisconnectDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Disconnect Calendar?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to disconnect your Microsoft Outlook calendar?
          </DialogContentText>
          <Alert severity="warning" sx={{ mt: 2 }}>
            <Typography variant="body2" component="div">
              This action will:
              <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                <li>Remove all synced calendar events and meetings</li>
                <li>Stop the Notely bot from joining Teams meetings</li>
                <li>Delete your Microsoft authentication tokens</li>
              </ul>
            </Typography>
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            You can reconnect your calendar at any time to restore syncing.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDisconnectDialog(false)} disabled={isDisconnecting}>
            Cancel
          </Button>
          <Button
            onClick={handleDisconnect}
            color="error"
            variant="contained"
            disabled={isDisconnecting}
            startIcon={isDisconnecting ? <CircularProgress size={16} /> : <LinkOffIcon />}
          >
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
