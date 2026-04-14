/**
 * Recording Quotas Settings Tab
 * Configure tier-based upload quotas and retention policies for recordings
 * Clean, minimal design - no icons, compact inputs
 */

import { useState, useEffect } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

interface TierQuota {
  enabled: boolean;
  maxFileSizeMB: number;
  retentionDays: number;
}

interface RetentionCleanup {
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  batchSize: number;
}

interface RecordingQuotasConfig {
  quotas: {
    free: TierQuota;
    professional: TierQuota;
    enterprise: TierQuota;
  };
  retentionCleanup: RetentionCleanup;
  allowedMimeTypes: string[];
}

const DEFAULT_CONFIG: RecordingQuotasConfig = {
  quotas: {
    free: { enabled: false, maxFileSizeMB: 0, retentionDays: 0 },
    professional: { enabled: true, maxFileSizeMB: 500, retentionDays: 7 },
    enterprise: { enabled: true, maxFileSizeMB: 1024, retentionDays: 7 },
  },
  retentionCleanup: {
    enabled: true,
    cronExpression: '0 2 * * *',
    timezone: 'UTC',
    batchSize: 100,
  },
  allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav'],
};

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

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

export default function RecordingQuotasSettingsTab() {
  const router = useRouter();
  const [config, setConfig] = useState<RecordingQuotasConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchConfig = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiRequest<{ config: RecordingQuotasConfig }>(
        '/api/admin/config/recording-quotas',
        { method: 'GET' }
      );

      const data = response.config || DEFAULT_CONFIG;
      setConfig({
        quotas: {
          free: { ...DEFAULT_CONFIG.quotas.free, ...data.quotas?.free },
          professional: { ...DEFAULT_CONFIG.quotas.professional, ...data.quotas?.professional },
          enterprise: { ...DEFAULT_CONFIG.quotas.enterprise, ...data.quotas?.enterprise },
        },
        retentionCleanup: { ...DEFAULT_CONFIG.retentionCleanup, ...data.retentionCleanup },
        allowedMimeTypes: data.allowedMimeTypes || DEFAULT_CONFIG.allowedMimeTypes,
      });
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Please log in to continue');
        router.push('/login');
        return;
      }
      if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to access these settings');
        setLoadError('Insufficient permissions');
        setConfig(null);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      clientLogger.error('Failed to fetch recording quotas config:', { error: message });
      toast.error('Failed to load configuration');
      setLoadError(message);
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const response = await apiRequest<{ config: RecordingQuotasConfig }>(
        '/api/admin/config/recording-quotas',
        { method: 'POST', body: config }
      );
      if (response.config) {
        setConfig({
          quotas: {
            free: { ...DEFAULT_CONFIG.quotas.free, ...response.config.quotas?.free },
            professional: { ...DEFAULT_CONFIG.quotas.professional, ...response.config.quotas?.professional },
            enterprise: { ...DEFAULT_CONFIG.quotas.enterprise, ...response.config.quotas?.enterprise },
          },
          retentionCleanup: { ...DEFAULT_CONFIG.retentionCleanup, ...response.config.retentionCleanup },
          allowedMimeTypes: response.config.allowedMimeTypes || DEFAULT_CONFIG.allowedMimeTypes,
        });
      }
      toast.success('Recording quotas saved');
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Please log in to continue');
        router.push('/login');
        return;
      }
      if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to modify these settings');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      clientLogger.error('Failed to save recording quotas config:', { error: message });
      toast.error(message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const updateTierQuota = (
    tier: 'free' | 'professional' | 'enterprise',
    field: keyof TierQuota,
    value: boolean | number
  ) => {
    if (!config) return;
    setConfig({
      ...config,
      quotas: {
        ...config.quotas,
        [tier]: { ...config.quotas[tier], [field]: value },
      },
    });
  };

  const updateRetentionCleanup = (field: keyof RetentionCleanup, value: boolean | number | string) => {
    if (!config) return;
    setConfig({
      ...config,
      retentionCleanup: { ...config.retentionCleanup, [field]: value },
    });
  };

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
          Failed to load recording quotas configuration.
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
            {/* Tier Quotas */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Upload Quotas by Tier</SectionHeader>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ py: 0.5 }}>Tier</TableCell>
                        <TableCell sx={{ py: 0.5 }}>Max Size (MB)</TableCell>
                        <TableCell sx={{ py: 0.5 }}>Retention (Days)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(['free', 'professional', 'enterprise'] as const).map((tier) => (
                        <TableRow key={tier}>
                          <TableCell sx={{ py: 1 }}>
                            <Typography variant="body2" fontWeight={500}>
                              {TIER_LABELS[tier]}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ py: 1 }}>
                            <TextField
                              type="number"
                              size="small"
                              value={config.quotas[tier].maxFileSizeMB}
                              onChange={(e) =>
                                updateTierQuota(tier, 'maxFileSizeMB', parseInt(e.target.value) || 0)
                              }
                              disabled={loading || saving}
                              sx={{ width: 100 }}
                              inputProps={{ min: 0, max: 10240 }}
                            />
                          </TableCell>
                          <TableCell sx={{ py: 1 }}>
                            <TextField
                              type="number"
                              size="small"
                              value={config.quotas[tier].retentionDays}
                              onChange={(e) =>
                                updateTierQuota(tier, 'retentionDays', parseInt(e.target.value) || 0)
                              }
                              disabled={loading || saving}
                              sx={{ width: 100 }}
                              inputProps={{ min: 0, max: 365 }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Retention Cleanup */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Retention Cleanup</SectionHeader>
                <ToggleRow
                  label="Enable auto cleanup"
                  description="Delete expired recordings"
                  checked={config.retentionCleanup.enabled}
                  onChange={(checked) => updateRetentionCleanup('enabled', checked)}
                  disabled={loading || saving}
                />
                <FieldRow label="Cron schedule" description="e.g., 0 2 * * * = 2 AM daily">
                  <TextField
                    size="small"
                    value={config.retentionCleanup.cronExpression}
                    onChange={(e) => updateRetentionCleanup('cronExpression', e.target.value)}
                    disabled={loading || saving || !config.retentionCleanup.enabled}
                    fullWidth
                  />
                </FieldRow>
                <FieldRow label="Timezone" description="Default: UTC">
                  <TextField
                    size="small"
                    value={config.retentionCleanup.timezone}
                    onChange={(e) => updateRetentionCleanup('timezone', e.target.value)}
                    disabled={loading || saving || !config.retentionCleanup.enabled}
                    fullWidth
                  />
                </FieldRow>
                <FieldRow label="Batch size" description="Files per run">
                  <TextField
                    type="number"
                    size="small"
                    value={config.retentionCleanup.batchSize}
                    onChange={(e) => updateRetentionCleanup('batchSize', parseInt(e.target.value) || 100)}
                    disabled={loading || saving || !config.retentionCleanup.enabled}
                    fullWidth
                    inputProps={{ min: 1, max: 1000 }}
                  />
                </FieldRow>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
        <Button variant="outlined" size="small" onClick={fetchConfig} disabled={loading || saving}>
          Reset
        </Button>
        <Button variant="contained" size="small" onClick={saveConfig} disabled={loading || saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}
