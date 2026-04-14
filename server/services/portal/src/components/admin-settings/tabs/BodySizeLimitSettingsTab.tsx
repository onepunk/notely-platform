/**
 * Body Size Limit Settings Tab
 * Configure request body size limits for gateway and individual services
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
  TextField,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';
import { dockerService } from '@/services/dockerService';

interface BodySizeLimitRule {
  enabled: boolean;
  limitKb: number;
}

interface BodySizeLimitConfig {
  gateway: BodySizeLimitRule;
  services: {
    auth: BodySizeLimitRule;
    users: BodySizeLimitRule;
    calendar: BodySizeLimitRule;
    support: BodySizeLimitRule;
    adminConfig: BodySizeLimitRule;
    dockerManager: BodySizeLimitRule;
    sync: BodySizeLimitRule;
    license: BodySizeLimitRule;
    portalBff: BodySizeLimitRule;
    adminDatabase: BodySizeLimitRule;
    observability: BodySizeLimitRule;
  };
}

const DEFAULT_CONFIG: BodySizeLimitConfig = {
  gateway: { enabled: true, limitKb: 1024 },
  services: {
    auth: { enabled: true, limitKb: 100 },
    users: { enabled: true, limitKb: 512 },
    calendar: { enabled: true, limitKb: 256 },
    support: { enabled: true, limitKb: 512 },
    adminConfig: { enabled: true, limitKb: 256 },
    dockerManager: { enabled: true, limitKb: 100 },
    sync: { enabled: true, limitKb: 5120 },
    license: { enabled: true, limitKb: 5120 },
    portalBff: { enabled: true, limitKb: 5120 },
    adminDatabase: { enabled: true, limitKb: 1024 },
    observability: { enabled: true, limitKb: 1024 },
  },
};

const SERVICE_INFO: Record<string, { label: string; description: string }> = {
  auth: { label: 'Authentication', description: 'Login, register, token operations' },
  users: { label: 'Users', description: 'User profiles, preferences' },
  calendar: { label: 'Calendar', description: 'Calendar events, scheduling' },
  support: { label: 'Support', description: 'Support tickets, messages' },
  adminConfig: { label: 'Admin Config', description: 'System configuration' },
  dockerManager: { label: 'Docker Manager', description: 'Container management' },
  sync: { label: 'Sync', description: 'Document synchronization' },
  license: { label: 'License', description: 'License validation, billing' },
  portalBff: { label: 'Portal BFF', description: 'Portal backend aggregation' },
  adminDatabase: { label: 'Admin Database', description: 'Database operations' },
  observability: { label: 'Observability', description: 'Logs, metrics collection' },
};

function formatSize(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

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

// Body size limit editor component
interface BodySizeLimitRuleEditorProps {
  label: string;
  description: string;
  rule: BodySizeLimitRule;
  onChange: (rule: BodySizeLimitRule) => void;
  disabled?: boolean;
}

function BodySizeLimitRuleEditor({
  label,
  description,
  rule,
  onChange,
  disabled = false,
}: BodySizeLimitRuleEditorProps) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box sx={{ flex: '0 0 180px' }}>
          <Typography variant="body2" fontWeight={500}>
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        </Box>
        <Switch
          checked={rule.enabled}
          onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
          disabled={disabled}
          size="small"
        />
      </Box>
      {rule.enabled && (
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            label="Max KB"
            type="number"
            value={rule.limitKb}
            onChange={(e) => onChange({ ...rule, limitKb: parseInt(e.target.value) || 1 })}
            disabled={disabled}
            sx={{ width: 120 }}
            inputProps={{ min: 1, max: 51200 }}
          />
          <Typography variant="caption" color="text.secondary">
            = {formatSize(rule.limitKb)}
          </Typography>
        </Stack>
      )}
    </Box>
  );
}

export default function BodySizeLimitSettingsTab() {
  const router = useRouter();
  const [config, setConfig] = useState<BodySizeLimitConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiRequest<{ config: BodySizeLimitConfig }>('/api/admin/config/body-size-limit', {
        method: 'GET',
      });
      setConfig(response?.config || DEFAULT_CONFIG);
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
      clientLogger.error('Failed to fetch body size limit config:', { error: message });
      toast.error('Failed to load configuration');
      setLoadError(message);
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  const waitForServiceHealth = async (maxAttempts = 12, intervalMs = 5000): Promise<boolean> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const services = await dockerService.getServiceStatus();
        const gateway = services.find((s) => s.containerName === 'notely-gateway-v3');
        if (gateway?.status === 'running' && gateway?.health === 'healthy') return true;
      } catch {
        // Expected while restarting
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    return false;
  };

  const restartServices = async (): Promise<boolean> => {
    setRestarting(true);
    try {
      const gatewayResult = await dockerService.restartService('notely-gateway-v3');
      if (!gatewayResult?.success) throw new Error(gatewayResult?.message || 'Failed to restart gateway');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const healthy = await waitForServiceHealth();
      return healthy;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clientLogger.error('Failed to restart services:', { error: message });
      return false;
    } finally {
      setRestarting(false);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const response = await apiRequest<{ config: BodySizeLimitConfig }>('/api/admin/config/body-size-limit', {
        method: 'POST',
        body: config,
      });
      if (response?.config) setConfig(response.config);

      toast.success('Settings saved. Restarting gateway...');
      const restartSuccess = await restartServices();
      if (restartSuccess) {
        toast.success('Body size limits applied');
      } else {
        toast.error('Settings saved but restart failed. Restart gateway manually.');
      }
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
      clientLogger.error('Failed to save body size limit config:', { error: message });
      toast.error(message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const updateServiceConfig = (serviceName: keyof BodySizeLimitConfig['services'], rule: BodySizeLimitRule) => {
    if (!config) return;
    setConfig({
      ...config,
      services: { ...config.services, [serviceName]: rule },
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
          Failed to load body size limit configuration.
          {loadError ? ` ${loadError}` : ''}
        </Alert>
        <Button variant="outlined" size="small" onClick={fetchConfig}>
          Retry
        </Button>
      </Stack>
    );
  }

  // Split services into two columns
  const serviceKeys = Object.keys(SERVICE_INFO) as Array<keyof BodySizeLimitConfig['services']>;
  const leftServices = serviceKeys.slice(0, Math.ceil(serviceKeys.length / 2));
  const rightServices = serviceKeys.slice(Math.ceil(serviceKeys.length / 2));

  return (
    <Box>
      {/* Info Alert */}
      <Alert severity="info" sx={{ mb: 3, fontSize: '0.75rem' }}>
        Body size limits protect against DoS attacks. Gateway limit is applied first, then service-specific limits.
      </Alert>

      <Grid container spacing={3}>
        {/* Left Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Gateway Limit */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Gateway Limit (Global)</SectionHeader>
                <BodySizeLimitRuleEditor
                  label="Max request size"
                  description="Applied to all requests"
                  rule={config.gateway}
                  onChange={(rule) => setConfig({ ...config, gateway: rule })}
                  disabled={loading || saving}
                />
              </CardContent>
            </Card>

            {/* Left services */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Service Limits</SectionHeader>
                {leftServices.map((key) => (
                  <BodySizeLimitRuleEditor
                    key={key}
                    label={SERVICE_INFO[key].label}
                    description={SERVICE_INFO[key].description}
                    rule={config.services[key]}
                    onChange={(rule) => updateServiceConfig(key, rule)}
                    disabled={loading || saving}
                  />
                ))}
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Right services */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Service Limits (continued)</SectionHeader>
                {rightServices.map((key) => (
                  <BodySizeLimitRuleEditor
                    key={key}
                    label={SERVICE_INFO[key].label}
                    description={SERVICE_INFO[key].description}
                    rule={config.services[key]}
                    onChange={(rule) => updateServiceConfig(key, rule)}
                    disabled={loading || saving}
                  />
                ))}
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      {/* Warning */}
      <Alert severity="warning" sx={{ mt: 3, fontSize: '0.75rem' }}>
        Service-specific limits require service restarts to take effect. Gateway limit applies after restart.
      </Alert>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
        <Button variant="outlined" size="small" onClick={fetchConfig} disabled={loading || saving || restarting}>
          Reset
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={saveConfig}
          disabled={loading || saving || restarting}
        >
          {saving ? 'Saving...' : restarting ? 'Restarting...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}
