/**
 * Notification Settings Tab
 * Configure admin email alerts for user registrations
 * Clean, minimal design - no icons, compact inputs
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

interface NotificationsConfig {
  registration: {
    enabled: boolean;
    recipientEmail: string;
  };
}

const DEFAULT_CONFIG: NotificationsConfig = {
  registration: {
    enabled: false,
    recipientEmail: '',
  },
};

function isValidEmail(value: string): boolean {
  if (!value) return false;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(value.trim());
}

// Reusable field row component
const FieldRow = ({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, mb: 2.5 }}>
    <Box sx={{ flex: '0 0 200px', pt: 1 }}>
      <Typography variant="body2" fontWeight={500}>
        {label}
      </Typography>
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
    </Box>
    <Box sx={{ width: 200 }}>{children}</Box>
  </Box>
);

// Reusable toggle row component
const ToggleRow = ({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, mb: 2.5 }}>
    <Box sx={{ flex: '0 0 200px' }}>
      <Typography variant="body2" fontWeight={500}>
        {label}
      </Typography>
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
    </Box>
    <Box sx={{ width: 200 }}>
      <Switch
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        size="small"
        disabled={disabled}
      />
    </Box>
  </Box>
);

// Section header component
const SectionHeader = ({ children }: { children: React.ReactNode }) => (
  <Typography
    variant="body2"
    sx={{
      color: 'text.secondary',
      fontWeight: 600,
      mb: 2,
      mt: 0,
    }}
  >
    {children}
  </Typography>
);

export default function NotificationSettingsTab() {
  const router = useRouter();
  const [config, setConfig] = useState<NotificationsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiRequest<{ config: NotificationsConfig }>('/api/admin/config/notifications', {
        method: 'GET',
      });

      const nextConfig = response?.config || DEFAULT_CONFIG;
      setConfig({
        registration: {
          enabled: Boolean(nextConfig.registration?.enabled),
          recipientEmail: (nextConfig.registration?.recipientEmail || '').trim(),
        },
      });
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        toast.error('Please log in to continue');
        router.push('/login');
        return;
      }
      if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to view notification settings');
        setLoadError('Insufficient permissions');
        setConfig(null);
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      clientLogger.error('Failed to load notification config', { error: message });
      toast.error('Failed to load notifications configuration');
      setLoadError(message);
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (!config) return;

    const email = (config.registration.recipientEmail || '').trim();
    if (email && !isValidEmail(email)) {
      toast.error('Please enter a valid notification email address');
      return;
    }
    if (config.registration.enabled && !email) {
      toast.error('Add an email address to send registration notifications');
      return;
    }

    setSaving(true);
    try {
      const response = await apiRequest<{ config: NotificationsConfig }>('/api/admin/config/notifications', {
        method: 'POST',
        body: config,
      });

      const updated = response?.config || config;
      setConfig({
        registration: {
          enabled: Boolean(updated.registration?.enabled),
          recipientEmail: (updated.registration?.recipientEmail || '').trim(),
        },
      });
      toast.success('Notification settings saved');
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        toast.error('Please log in to continue');
        router.push('/login');
        return;
      }
      if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to edit notification settings');
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      clientLogger.error('Failed to save notification config', { error: message });
      toast.error(message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const sendTestEmail = async () => {
    const email = config?.registration.recipientEmail?.trim() || '';
    if (!email) {
      toast.error('Enter a recipient email for the test');
      return;
    }
    if (!isValidEmail(email)) {
      toast.error('Please enter a valid notification email address');
      return;
    }

    setSendingTest(true);
    try {
      await apiRequest<{ success: boolean; message?: string }>('/api/users/notifications/test', {
        method: 'POST',
        body: { to: email },
      });
      toast.success(`Test email sent to ${email}`);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      clientLogger.error('Failed to send test notification email', { error: message });
      toast.error(message || 'Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!config) {
    return (
      <Stack spacing={2} alignItems="flex-start">
        <Alert severity="error" sx={{ width: '100%' }}>
          Failed to load notification configuration.
          {loadError ? ` ${loadError}` : ''}
        </Alert>
        <Button variant="outlined" size="small" onClick={fetchConfig}>
          Retry
        </Button>
      </Stack>
    );
  }

  return (
    <Box>
      <Grid container spacing={3}>
        {/* Left Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Registration Notifications */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Registration Notifications</SectionHeader>
                <ToggleRow
                  label="Enable notifications"
                  description="Email on new sign-ups"
                  checked={config.registration.enabled}
                  onChange={(checked) =>
                    setConfig({
                      ...config,
                      registration: { ...config.registration, enabled: checked },
                    })
                  }
                  disabled={saving}
                />
                <FieldRow label="Recipient email" description="Where to send alerts">
                  <TextField
                    size="small"
                    placeholder="alerts@example.com"
                    value={config.registration.recipientEmail}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        registration: { ...config.registration, recipientEmail: e.target.value },
                      })
                    }
                    disabled={saving}
                    fullWidth
                  />
                </FieldRow>
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Test Email */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Test Email</SectionHeader>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Send a test email to verify configuration
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={sendTestEmail}
                  disabled={sendingTest || !config?.registration.recipientEmail}
                >
                  {sendingTest ? 'Sending...' : 'Send Test'}
                </Button>
              </CardContent>
            </Card>

            {/* Info */}
            <Alert severity="info" sx={{ fontSize: '0.75rem' }}>
              Notifications are sent via Microsoft Graph using app-only credentials.
            </Alert>
          </Stack>
        </Grid>
      </Grid>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={fetchConfig}
          disabled={loading || saving}
        >
          Reset
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={saveConfig}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}
