/**
 * General Settings Tab
 * Session management and system limits configuration
 * Clean, minimal design - no cards, no icons, compact inputs
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import clientLogger from '@/lib/clientLogger';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  TextField,
  Typography,
  Switch,
  Alert,
} from '@mui/material';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

interface GeneralConfig {
  adminPortalTimeout: number;
  inactiveSessionTimeout: number;
  maxConcurrentSessions: number;
  sessionCleanupInterval: number;
  signupsEnabled: boolean;
  requireBetaToken: boolean;
}

const DEFAULT_CONFIG: GeneralConfig = {
  adminPortalTimeout: 60,
  inactiveSessionTimeout: 60,
  maxConcurrentSessions: 100,
  sessionCleanupInterval: 15,
  signupsEnabled: true,
  requireBetaToken: true,
};

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
      mt: 4,
      '&:first-of-type': { mt: 0 },
    }}
  >
    {children}
  </Typography>
);

export default function GeneralSettingsTab() {
  const router = useRouter();
  const [config, setConfig] = useState<GeneralConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchConfig = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiRequest<GeneralConfig>('/api/admin/config/general', {
        method: 'GET',
      });

      setConfig({
        adminPortalTimeout:
          typeof data.adminPortalTimeout === 'number'
            ? data.adminPortalTimeout
            : DEFAULT_CONFIG.adminPortalTimeout,
        inactiveSessionTimeout:
          typeof data.inactiveSessionTimeout === 'number'
            ? data.inactiveSessionTimeout
            : DEFAULT_CONFIG.inactiveSessionTimeout,
        maxConcurrentSessions:
          typeof data.maxConcurrentSessions === 'number'
            ? data.maxConcurrentSessions
            : DEFAULT_CONFIG.maxConcurrentSessions,
        sessionCleanupInterval:
          typeof data.sessionCleanupInterval === 'number'
            ? data.sessionCleanupInterval
            : DEFAULT_CONFIG.sessionCleanupInterval,
        signupsEnabled:
          typeof data.signupsEnabled === 'boolean'
            ? data.signupsEnabled
            : DEFAULT_CONFIG.signupsEnabled,
        requireBetaToken:
          typeof data.requireBetaToken === 'boolean'
            ? data.requireBetaToken
            : DEFAULT_CONFIG.requireBetaToken,
      });
    } catch (err) {
      if (err instanceof AuthenticationError) {
        clientLogger.warn('Authentication required, redirecting to login');
        toast.error('Please log in to continue');
        router.push('/login');
        return;
      }

      if (err instanceof AuthorizationError) {
        clientLogger.warn('Insufficient permissions to access general config');
        toast.error('You do not have permission to access these settings');
        setLoadError('Insufficient permissions');
        setConfig(null);
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      clientLogger.error('Failed to fetch general config:', { error: message });
      toast.error('Failed to load configuration');
      setLoadError(message);
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (!config) {
      toast.error('Configuration not loaded yet');
      return;
    }

    setSaving(true);

    try {
      const responseData = await apiRequest<GeneralConfig>('/api/admin/config/general', {
        method: 'POST',
        body: config,
      });

      if (responseData && typeof responseData === 'object') {
        setConfig({
          adminPortalTimeout:
            typeof responseData.adminPortalTimeout === 'number'
              ? responseData.adminPortalTimeout
              : config.adminPortalTimeout,
          inactiveSessionTimeout:
            typeof responseData.inactiveSessionTimeout === 'number'
              ? responseData.inactiveSessionTimeout
              : config.inactiveSessionTimeout,
          maxConcurrentSessions:
            typeof responseData.maxConcurrentSessions === 'number'
              ? responseData.maxConcurrentSessions
              : config.maxConcurrentSessions,
          sessionCleanupInterval:
            typeof responseData.sessionCleanupInterval === 'number'
              ? responseData.sessionCleanupInterval
              : config.sessionCleanupInterval,
          signupsEnabled:
            typeof responseData.signupsEnabled === 'boolean'
              ? responseData.signupsEnabled
              : config.signupsEnabled,
          requireBetaToken:
            typeof responseData.requireBetaToken === 'boolean'
              ? responseData.requireBetaToken
              : config.requireBetaToken,
        });
      }
      toast.success('Settings saved successfully');
    } catch (err) {
      if (err instanceof AuthenticationError) {
        clientLogger.warn('Authentication required, redirecting to login');
        toast.error('Please log in to continue');
        router.push('/login');
        return;
      }

      if (err instanceof AuthorizationError) {
        clientLogger.warn('Insufficient permissions to save general config');
        toast.error('You do not have permission to modify these settings');
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      clientLogger.error('Failed to save general config:', { error: message });
      toast.error(message || 'Failed to save settings');
    } finally {
      setSaving(false);
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
          Failed to load general configuration.
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
            {/* Registration */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Registration</SectionHeader>
                <ToggleRow
                  label="Allow sign-ups"
                  description="New users can register"
                  checked={config.signupsEnabled}
                  onChange={(checked) => setConfig({ ...config, signupsEnabled: checked })}
                  disabled={loading || saving}
                />
                <ToggleRow
                  label="Require beta token"
                  description="Only beta invitees can register"
                  checked={config.requireBetaToken}
                  onChange={(checked) => setConfig({ ...config, requireBetaToken: checked })}
                  disabled={loading || saving}
                />
              </CardContent>
            </Card>

            {/* System Limits */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>System Limits</SectionHeader>
                <FieldRow label="Max sessions" description="Concurrent user sessions">
                  <TextField
                    size="small"
                    type="number"
                    value={config.maxConcurrentSessions}
                    onChange={(e) =>
                      setConfig({ ...config, maxConcurrentSessions: parseInt(e.target.value) || 0 })
                    }
                    disabled={loading || saving}
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
            {/* Session Management */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Session Management</SectionHeader>
                <FieldRow label="Admin timeout" description="Minutes of inactivity">
                  <TextField
                    size="small"
                    type="number"
                    value={config.adminPortalTimeout}
                    onChange={(e) =>
                      setConfig({ ...config, adminPortalTimeout: parseInt(e.target.value) || 0 })
                    }
                    disabled={loading || saving}
                    fullWidth
                  />
                </FieldRow>
                <FieldRow label="Session timeout" description="Client session cleanup">
                  <TextField
                    size="small"
                    type="number"
                    value={config.inactiveSessionTimeout}
                    onChange={(e) =>
                      setConfig({ ...config, inactiveSessionTimeout: parseInt(e.target.value) || 0 })
                    }
                    disabled={loading || saving}
                    fullWidth
                  />
                </FieldRow>
                <FieldRow label="Cleanup interval" description="Check frequency (min)">
                  <TextField
                    size="small"
                    type="number"
                    value={config.sessionCleanupInterval}
                    onChange={(e) =>
                      setConfig({ ...config, sessionCleanupInterval: parseInt(e.target.value) || 0 })
                    }
                    disabled={loading || saving}
                    fullWidth
                  />
                </FieldRow>
              </CardContent>
            </Card>
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
          disabled={loading || saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}
