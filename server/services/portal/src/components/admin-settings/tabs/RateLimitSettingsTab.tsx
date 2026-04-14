/**
 * Rate Limit Settings Tab
 * Configure API rate limiting for gateway and auth service endpoints
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

interface RateLimitRule {
  enabled: boolean;
  points: number;
  duration: number;
  blockDuration: number;
}

interface DownloadsRateLimitConfig {
  enabled: boolean;
  requestsPerMinute: number;
  burstSize: number;
  maxConcurrentDownloads: number;
  bandwidthLimitMbps: number;
}

interface RateLimitConfig {
  global: RateLimitRule;
  auth: {
    login: {
      ip: RateLimitRule;
      email: RateLimitRule;
      consecutiveFails: RateLimitRule;
    };
    register: {
      ip: RateLimitRule;
    };
    changePassword: {
      user: RateLimitRule;
    };
    validate: {
      ip: RateLimitRule;
    };
    passwordReset: {
      ip: RateLimitRule;
      email: RateLimitRule;
    };
  };
  downloads?: DownloadsRateLimitConfig;
  downloadTracking?: RateLimitRule;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  global: { enabled: true, points: 100, duration: 60, blockDuration: 300 },
  auth: {
    login: {
      ip: { enabled: true, points: 10, duration: 900, blockDuration: 900 },
      email: { enabled: true, points: 5, duration: 900, blockDuration: 1800 },
      consecutiveFails: { enabled: true, points: 5, duration: 86400, blockDuration: 3600 },
    },
    register: {
      ip: { enabled: true, points: 5, duration: 3600, blockDuration: 3600 },
    },
    changePassword: {
      user: { enabled: true, points: 3, duration: 900, blockDuration: 1800 },
    },
    validate: {
      ip: { enabled: true, points: 100, duration: 60, blockDuration: 300 },
    },
    passwordReset: {
      ip: { enabled: true, points: 3, duration: 3600, blockDuration: 3600 },
      email: { enabled: true, points: 3, duration: 3600, blockDuration: 3600 },
    },
  },
  downloads: {
    enabled: true,
    requestsPerMinute: 5,
    burstSize: 5,
    maxConcurrentDownloads: 3,
    bandwidthLimitMbps: 10,
  },
  downloadTracking: {
    enabled: true,
    points: 30,
    duration: 60,
    blockDuration: 60,
  },
};

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

// Rate limit rule editor component
interface RateLimitRuleEditorProps {
  label: string;
  description: string;
  rule: RateLimitRule;
  onChange: (rule: RateLimitRule) => void;
  disabled?: boolean;
  pointsLabel?: string;
}

function RateLimitRuleEditor({
  label,
  description,
  rule,
  onChange,
  disabled = false,
  pointsLabel = 'Requests',
}: RateLimitRuleEditorProps) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box sx={{ flex: '0 0 200px' }}>
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
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label={pointsLabel}
            type="number"
            value={rule.points}
            onChange={(e) => onChange({ ...rule, points: parseInt(e.target.value) || 1 })}
            disabled={disabled}
            sx={{ width: 100 }}
            inputProps={{ min: 1, max: 100000 }}
          />
          <TextField
            size="small"
            label="Window (s)"
            type="number"
            value={rule.duration}
            onChange={(e) => onChange({ ...rule, duration: parseInt(e.target.value) || 1 })}
            disabled={disabled}
            sx={{ width: 100 }}
            inputProps={{ min: 1, max: 86400 }}
          />
          <TextField
            size="small"
            label="Block (s)"
            type="number"
            value={rule.blockDuration}
            onChange={(e) => onChange({ ...rule, blockDuration: parseInt(e.target.value) || 0 })}
            disabled={disabled}
            sx={{ width: 100 }}
            inputProps={{ min: 0, max: 86400 }}
          />
        </Stack>
      )}
    </Box>
  );
}

export default function RateLimitSettingsTab() {
  const router = useRouter();
  const [config, setConfig] = useState<RateLimitConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiRequest<{ config: RateLimitConfig }>('/api/admin/config/rate-limit', {
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
      clientLogger.error('Failed to fetch rate limit config:', { error: message });
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
        const auth = services.find((s) => s.containerName === 'notely-auth-v3');
        const gatewayHealthy = gateway?.status === 'running' && gateway?.health === 'healthy';
        const authHealthy = auth?.status === 'running' && auth?.health === 'healthy';
        if (gatewayHealthy && authHealthy) return true;
      } catch {
        // Expected while services are restarting
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
      try {
        await dockerService.restartService('notely-auth-v3');
      } catch {
        // Expected if gateway is still restarting
      }
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
      const response = await apiRequest<{ config: RateLimitConfig }>('/api/admin/config/rate-limit', {
        method: 'POST',
        body: config,
      });
      if (response?.config) setConfig(response.config);

      toast.success('Settings saved. Restarting services...');
      const restartSuccess = await restartServices();
      if (restartSuccess) {
        toast.success('Rate limit settings applied');
      } else {
        toast.error('Settings saved but restart failed. Restart gateway/auth manually.');
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
      clientLogger.error('Failed to save rate limit config:', { error: message });
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
          Failed to load rate limit configuration.
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
            {/* Global Rate Limit */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Global Rate Limit</SectionHeader>
                <RateLimitRuleEditor
                  label="All endpoints"
                  description="Max requests per IP"
                  rule={config.global}
                  onChange={(rule) => setConfig({ ...config, global: rule })}
                  disabled={loading || saving}
                />
              </CardContent>
            </Card>

            {/* Login Protection */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Login Protection</SectionHeader>
                <RateLimitRuleEditor
                  label="Per IP address"
                  description="Limit from single IP"
                  rule={config.auth.login.ip}
                  onChange={(rule) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, login: { ...config.auth.login, ip: rule } },
                    })
                  }
                  disabled={loading || saving}
                  pointsLabel="Attempts"
                />
                <RateLimitRuleEditor
                  label="Per email"
                  description="Limit for specific account"
                  rule={config.auth.login.email}
                  onChange={(rule) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, login: { ...config.auth.login, email: rule } },
                    })
                  }
                  disabled={loading || saving}
                  pointsLabel="Attempts"
                />
                <RateLimitRuleEditor
                  label="Account lockout"
                  description="Lock after consecutive fails"
                  rule={config.auth.login.consecutiveFails}
                  onChange={(rule) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, login: { ...config.auth.login, consecutiveFails: rule } },
                    })
                  }
                  disabled={loading || saving}
                  pointsLabel="Failures"
                />
              </CardContent>
            </Card>

            {/* Registration */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Registration Protection</SectionHeader>
                <RateLimitRuleEditor
                  label="Per IP address"
                  description="Prevent spam signups"
                  rule={config.auth.register.ip}
                  onChange={(rule) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, register: { ...config.auth.register, ip: rule } },
                    })
                  }
                  disabled={loading || saving}
                  pointsLabel="Signups"
                />
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Password Change */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Password Change</SectionHeader>
                <RateLimitRuleEditor
                  label="Per user"
                  description="Limit per authenticated user"
                  rule={config.auth.changePassword.user}
                  onChange={(rule) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, changePassword: { ...config.auth.changePassword, user: rule } },
                    })
                  }
                  disabled={loading || saving}
                  pointsLabel="Attempts"
                />
              </CardContent>
            </Card>

            {/* Token Validation */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Token Validation</SectionHeader>
                <RateLimitRuleEditor
                  label="Per IP address"
                  description="Higher limit for internal calls"
                  rule={config.auth.validate.ip}
                  onChange={(rule) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, validate: { ...config.auth.validate, ip: rule } },
                    })
                  }
                  disabled={loading || saving}
                />
              </CardContent>
            </Card>

            {/* Password Reset */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Password Reset</SectionHeader>
                <RateLimitRuleEditor
                  label="Per IP address"
                  description="Limit from single IP"
                  rule={config.auth.passwordReset.ip}
                  onChange={(rule) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, passwordReset: { ...config.auth.passwordReset, ip: rule } },
                    })
                  }
                  disabled={loading || saving}
                  pointsLabel="Requests"
                />
                <RateLimitRuleEditor
                  label="Per email"
                  description="Limit for specific email"
                  rule={config.auth.passwordReset.email}
                  onChange={(rule) =>
                    setConfig({
                      ...config,
                      auth: { ...config.auth, passwordReset: { ...config.auth.passwordReset, email: rule } },
                    })
                  }
                  disabled={loading || saving}
                  pointsLabel="Requests"
                />
              </CardContent>
            </Card>

            {/* Downloads Rate Limit */}
            {config.downloads && (
              <Card variant="outlined" sx={{ borderRadius: '6px' }}>
                <CardContent>
                  <SectionHeader>Downloads (get.yourdomain.com)</SectionHeader>
                  <Box sx={{ mb: 2.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Box sx={{ flex: '0 0 200px' }}>
                        <Typography variant="body2" fontWeight={500}>
                          Enable rate limiting
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Limit download requests per IP
                        </Typography>
                      </Box>
                      <Switch
                        checked={config.downloads.enabled}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            downloads: { ...config.downloads!, enabled: e.target.checked },
                          })
                        }
                        disabled={loading || saving}
                        size="small"
                      />
                    </Box>
                    {config.downloads.enabled && (
                      <Stack spacing={2}>
                        <Stack direction="row" spacing={1}>
                          <TextField
                            size="small"
                            label="Requests/min"
                            type="number"
                            value={config.downloads.requestsPerMinute}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                downloads: { ...config.downloads!, requestsPerMinute: parseInt(e.target.value) || 1 },
                              })
                            }
                            disabled={loading || saving}
                            sx={{ width: 110 }}
                            inputProps={{ min: 1, max: 60 }}
                          />
                          <TextField
                            size="small"
                            label="Burst size"
                            type="number"
                            value={config.downloads.burstSize}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                downloads: { ...config.downloads!, burstSize: parseInt(e.target.value) || 1 },
                              })
                            }
                            disabled={loading || saving}
                            sx={{ width: 100 }}
                            inputProps={{ min: 1, max: 20 }}
                          />
                        </Stack>
                        <Stack direction="row" spacing={1}>
                          <TextField
                            size="small"
                            label="Max concurrent"
                            type="number"
                            value={config.downloads.maxConcurrentDownloads}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                downloads: { ...config.downloads!, maxConcurrentDownloads: parseInt(e.target.value) || 1 },
                              })
                            }
                            disabled={loading || saving}
                            sx={{ width: 110 }}
                            inputProps={{ min: 1, max: 10 }}
                          />
                          <TextField
                            size="small"
                            label="Bandwidth (MB/s)"
                            type="number"
                            value={config.downloads.bandwidthLimitMbps}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                downloads: { ...config.downloads!, bandwidthLimitMbps: parseInt(e.target.value) || 1 },
                              })
                            }
                            disabled={loading || saving}
                            sx={{ width: 130 }}
                            inputProps={{ min: 1, max: 100 }}
                          />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          Note: Changes require nginx restart to take effect.
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                </CardContent>
              </Card>
            )}

            {/* Download Tracking Rate Limit */}
            {config.downloadTracking && (
              <Card variant="outlined" sx={{ borderRadius: '6px' }}>
                <CardContent>
                  <SectionHeader>Download Tracking API</SectionHeader>
                  <RateLimitRuleEditor
                    label="Per IP address"
                    description="Analytics tracking endpoint"
                    rule={config.downloadTracking}
                    onChange={(rule) => setConfig({ ...config, downloadTracking: rule })}
                    disabled={loading || saving}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Note: Changes require portal-bff restart to take effect.
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Stack>
        </Grid>
      </Grid>

      {/* Info Alert */}
      <Alert severity="info" sx={{ mt: 3, fontSize: '0.75rem' }}>
        Saving will automatically restart gateway and auth services to apply changes.
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
