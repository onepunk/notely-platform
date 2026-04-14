/**
 * Logging Settings Tab
 * Log retention, Loki status, and cleanup configuration
 * Clean, minimal design - no icons, compact inputs
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  Grid,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError } from '@/utils/api';

type NullableDate = string | null;

interface RetentionSettings {
  retention_days: number;
  default_retention_days: number;
  last_enforced_at: NullableDate;
  last_enforcement_result: any;
  last_enforcement_error: any;
}

interface LokiStatus {
  healthy: boolean;
  build: any;
  runtime: any;
  retention: RetentionSettings;
  error?: string;
}

interface SchedulerStatus {
  running: boolean;
  last_trigger: NullableDate;
  last_run_started_at: NullableDate;
  last_run_completed_at: NullableDate;
  last_result: any;
  last_error: any;
  cron_expression: string;
  timezone: string;
}

function formatRelativeDate(iso?: NullableDate): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const minutesAgo = Math.round((Date.now() - date.getTime()) / (1000 * 60));
  return `${date.toLocaleString()} (${minutesAgo} min ago)`;
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

// Status row component
const StatusRow = ({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: 'healthy' | 'error' | 'unknown';
}) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 4, mb: 1.5 }}>
    <Box sx={{ flex: '0 0 200px' }}>
      <Typography variant="body2" fontWeight={500}>
        {label}
      </Typography>
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {status && (
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: status === 'healthy' ? 'success.main' : status === 'error' ? 'error.main' : 'warning.main',
          }}
        />
      )}
      <Typography variant="body2" color="text.secondary">
        {value}
      </Typography>
    </Box>
  </Box>
);

export default function LoggingSettingsTab() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [savingRetention, setSavingRetention] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);

  const [status, setStatus] = useState<{ loki: LokiStatus | null; scheduler: SchedulerStatus | null }>({
    loki: null,
    scheduler: null,
  });
  const [retention, setRetention] = useState<RetentionSettings | null>(null);
  const [retentionInput, setRetentionInput] = useState<string>('7');

  const loadMeta = useCallback(async () => {
    try {
      setLoading(true);

      const [statusPayload, loggingPayload] = await Promise.all([
        apiRequest<{ success: boolean; data: { loki: LokiStatus; scheduler: SchedulerStatus } }>(
          '/api/admin/logs/status'
        ),
        apiRequest<{ config: { retention?: RetentionSettings; scheduler?: SchedulerStatus } }>(
          '/api/admin/config/logging'
        ),
      ]);

      const loggingConfig = loggingPayload?.config || {};
      const retentionConfig = loggingConfig.retention || null;

      if (statusPayload?.data) {
        setStatus(statusPayload.data);
      }

      if (retentionConfig) {
        setRetention(retentionConfig);
        setRetentionInput(String(retentionConfig.retention_days));
      } else {
        setRetention(null);
        setRetentionInput('7');
      }
    } catch (error: any) {
      clientLogger.error('Failed to load logging config:', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/admin/login');
        return;
      }

      toast.error(error.message || 'Failed to load logging configuration');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const handleRetentionSave = async (enforce: boolean) => {
    const parsed = parseInt(retentionInput, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 365) {
      toast.error('Retention days must be between 1 and 365');
      return;
    }

    try {
      setSavingRetention(true);

      const response = await apiRequest<{ config: { retention?: RetentionSettings; scheduler?: SchedulerStatus } }>(
        '/api/admin/config/logging',
        {
          method: 'POST',
          body: {
            retention: {
              retention_days: parsed,
              default_retention_days: retention?.default_retention_days ?? parsed,
            },
          },
        }
      );

      const updatedConfig = response?.config || {};
      if (updatedConfig.retention) {
        setRetention(updatedConfig.retention);
        setRetentionInput(String(updatedConfig.retention.retention_days));
      }

      toast.success(`Retention updated to ${parsed} days${enforce ? ' and cleanup triggered' : ''}`);
      await loadMeta();
    } catch (error: any) {
      clientLogger.error('Failed to update retention:', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/admin/login');
        return;
      }

      toast.error(error.message || 'Failed to update retention');
    } finally {
      setSavingRetention(false);
    }
  };

  const handleManualCleanup = async () => {
    try {
      setRunningCleanup(true);

      await apiRequest<{ success: boolean; data: any }>('/api/admin/logs/cleanup', {
        method: 'POST',
        body: {},
      });

      toast.success('Manual cleanup triggered successfully');
      await loadMeta();
    } catch (error: any) {
      clientLogger.error('Failed to trigger cleanup:', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/admin/login');
        return;
      }

      toast.error(error.message || 'Failed to trigger cleanup');
    } finally {
      setRunningCleanup(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box>
      <Grid container spacing={3}>
        {/* Left Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Loki Status */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Loki Status</SectionHeader>
                <StatusRow
                  label="Status"
                  value={status.loki?.healthy ? 'Healthy' : 'Unavailable'}
                  status={status.loki?.healthy ? 'healthy' : 'error'}
                />
                <StatusRow
                  label="Retention policy"
                  value={`${status.loki?.retention?.retention_days ?? '—'} days`}
                />
                <StatusRow
                  label="Default retention"
                  value={`${status.loki?.retention?.default_retention_days ?? '—'} days`}
                />
                <StatusRow
                  label="Last enforcement"
                  value={formatRelativeDate(status.loki?.retention?.last_enforced_at)}
                />
                {status.loki?.retention?.last_enforcement_result && (
                  <StatusRow
                    label="Last cleanup"
                    value={`${status.loki.retention.last_enforcement_result.status} @ ${status.loki.retention.last_enforcement_result.cutoff}`}
                  />
                )}
                {status.loki?.retention?.last_enforcement_error && (
                  <Alert severity="warning" sx={{ mt: 2, fontSize: '0.75rem' }}>
                    {status.loki.retention.last_enforcement_error.message}
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Scheduler Status */}
            {status.scheduler && (
              <Card variant="outlined" sx={{ borderRadius: '6px' }}>
                <CardContent>
                  <SectionHeader>Scheduler Status</SectionHeader>
                  <StatusRow
                    label="Status"
                    value={status.scheduler.running ? 'Running' : 'Stopped'}
                    status={status.scheduler.running ? 'healthy' : 'unknown'}
                  />
                  <StatusRow
                    label="Cron expression"
                    value={status.scheduler.cron_expression}
                  />
                  <StatusRow
                    label="Timezone"
                    value={status.scheduler.timezone}
                  />
                  <StatusRow
                    label="Last trigger"
                    value={formatRelativeDate(status.scheduler.last_trigger)}
                  />
                  <StatusRow
                    label="Last completed"
                    value={formatRelativeDate(status.scheduler.last_run_completed_at)}
                  />
                  {status.scheduler.last_error && (
                    <Alert severity="error" sx={{ mt: 2, fontSize: '0.75rem' }}>
                      {typeof status.scheduler.last_error === 'string'
                        ? status.scheduler.last_error
                        : status.scheduler.last_error.message || JSON.stringify(status.scheduler.last_error)}
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Log Retention */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Log Retention</SectionHeader>
                <FieldRow label="Retention period" description="Days to keep logs">
                  <FormControl size="small" fullWidth>
                    <Select
                      value={retentionInput}
                      onChange={(e) => setRetentionInput(e.target.value)}
                    >
                      {[7, 14, 30, 60, 90, 180, 365].map((value) => (
                        <MenuItem key={value} value={String(value)}>
                          {value} days
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </FieldRow>
                <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleRetentionSave(false)}
                    disabled={savingRetention}
                  >
                    {savingRetention ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => handleRetentionSave(true)}
                    disabled={savingRetention}
                  >
                    Save & Clean
                  </Button>
                </Stack>
              </CardContent>
            </Card>

            {/* Manual Cleanup */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Manual Cleanup</SectionHeader>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Immediately remove logs older than retention period
                </Typography>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleManualCleanup}
                    disabled={runningCleanup}
                  >
                    {runningCleanup ? 'Running...' : 'Run Cleanup'}
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    Last: {formatRelativeDate(retention?.last_enforced_at)}
                  </Typography>
                </Stack>
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
          onClick={loadMeta}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>
    </Box>
  );
}
