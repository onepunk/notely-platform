/**
 * Security Settings Tab
 * SSL certificates, authentication, password policies, and access controls
 * Clean, minimal design - no icons, compact inputs
 */

import { useState, useEffect } from 'react';
import { keyframes } from '@mui/system';
import { useRouter } from 'next/router';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import {
  apiRequest,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  ApiError,
} from '@/utils/api';
import { dockerService } from '@/services/dockerService';

interface SecurityConfig {
  sslEnabled: boolean;
  httpsRedirect: boolean;
  sessionTimeout: number;
  maxLoginAttempts: number;
  localLoginEnabled: boolean;
  passwordComplexity: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
  };
  twoFactorAuth: boolean;
  ipWhitelist: string[];
}

interface Certificate {
  id: string;
  name: string;
  domain: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  status: 'active' | 'expired' | 'expiring';
}

const DEFAULT_CONFIG: SecurityConfig = {
  sslEnabled: true,
  httpsRedirect: true,
  sessionTimeout: 30,
  maxLoginAttempts: 5,
  localLoginEnabled: true,
  passwordComplexity: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
  },
  twoFactorAuth: false,
  ipWhitelist: [],
};

// Spinning animation for loading indicator
const spin = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

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

export default function SecuritySettingsTab() {
  const router = useRouter();
  const [config, setConfig] = useState<SecurityConfig>(DEFAULT_CONFIG);
  const [originalIpWhitelist, setOriginalIpWhitelist] = useState<string[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ipDialogOpen, setIpDialogOpen] = useState(false);
  const [newIp, setNewIp] = useState('');
  const [showNginxConfirmDialog, setShowNginxConfirmDialog] = useState(false);
  const [isReloadingNginx, setIsReloadingNginx] = useState(false);
  const [reloadCountdown, setReloadCountdown] = useState(30);
  const [oauthAdminCount, setOauthAdminCount] = useState<number | null>(null);

  const fetchSecurityConfig = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ config?: SecurityConfig; certificates?: Certificate[] }>(
        '/api/admin/config/security'
      );

      const loadedConfig = data.config || DEFAULT_CONFIG;
      setConfig(loadedConfig);
      setOriginalIpWhitelist(loadedConfig.ipWhitelist || []);
      setCertificates(data.certificates || []);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        clientLogger.warn('Authentication required, redirecting to login');
        toast.error('Session expired. Please log in again.');
        router.push('/admin/login');
      } else if (err instanceof AuthorizationError) {
        clientLogger.warn('Insufficient permissions for security config');
        toast.error('You do not have permission to access security settings');
      } else if (err instanceof ApiError) {
        clientLogger.error('Failed to fetch security config:', {
          status: err.status,
          message: err.message,
          requestId: err.requestId
        });
        toast.error(err.message || 'Failed to load security configuration');
      } else {
        clientLogger.error('Unexpected error fetching security config:', { error: String(err) });
        toast.error('Failed to load security configuration');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchOAuthAdminCount = async () => {
    try {
      const data = await apiRequest<{ count: number }>(
        '/api/admin/config/security/oauth-admin-count'
      );
      setOauthAdminCount(data.count || 0);
    } catch (err) {
      clientLogger.warn('Failed to fetch OAuth admin count:', { error: String(err) });
      setOauthAdminCount(0);
    }
  };

  const saveSecurityConfig = async () => {
    setSaving(true);
    try {
      if (config.localLoginEnabled === false && oauthAdminCount === 0) {
        toast.error('Cannot save: You must grant admin permissions to at least one user who has logged in via Microsoft OAuth before disabling local login.');
        setSaving(false);
        return;
      }

      await apiRequest('/api/admin/config/security', {
        method: 'POST',
        body: config,
      });

      const whitelistChanged =
        config.ipWhitelist.length !== originalIpWhitelist.length ||
        config.ipWhitelist.some((ip) => !originalIpWhitelist.includes(ip)) ||
        originalIpWhitelist.some((ip) => !config.ipWhitelist.includes(ip));

      if (whitelistChanged && (config.ipWhitelist.length > 0 || originalIpWhitelist.length > 0)) {
        setShowNginxConfirmDialog(true);
      } else {
        toast.success('Security settings saved successfully');
        setOriginalIpWhitelist([...config.ipWhitelist]);
      }
    } catch (err) {
      if (err instanceof AuthenticationError) {
        clientLogger.warn('Authentication required, redirecting to login');
        toast.error('Session expired. Please log in again.');
        router.push('/admin/login');
      } else if (err instanceof AuthorizationError) {
        clientLogger.warn('Insufficient permissions to save security config');
        toast.error('You do not have permission to modify security settings');
      } else if (err instanceof ValidationError) {
        clientLogger.warn('Validation error saving security config:', {
          message: err.message,
          details: err.details
        });
        toast.error(err.message || 'Invalid configuration settings');
      } else if (err instanceof ApiError) {
        const errorData = err as any;
        if (errorData.code === 'NO_OAUTH_ADMIN') {
          toast.error('Cannot disable local login: Grant admin permissions to at least one Microsoft OAuth user first.');
        } else {
          clientLogger.error('Failed to save security config:', {
            status: err.status,
            message: err.message,
            requestId: err.requestId
          });
          toast.error(err.message || 'Failed to save security settings');
        }
      } else {
        clientLogger.error('Unexpected error saving security config:', { error: String(err) });
        toast.error('Failed to save security settings');
      }
    } finally {
      setSaving(false);
    }
  };

  const applyNginxConfig = async () => {
    setShowNginxConfirmDialog(false);
    setIsReloadingNginx(true);
    setReloadCountdown(10); // Shorter countdown since reload is faster than restart

    const countdownInterval = setInterval(() => {
      setReloadCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          window.location.reload();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      // Step 1: Write the IP whitelist config file
      await apiRequest('/api/admin/config/security/write-nginx-config', {
        method: 'POST',
      });

      clientLogger.info('IP whitelist config file written, reloading nginx...');

      // Step 2: Gracefully reload nginx (validates config first, no connection interruption)
      const reloadResult = await dockerService.reloadNginx();

      if (!reloadResult.success) {
        throw new Error(reloadResult.message || 'Failed to reload nginx');
      }

      clientLogger.info('Nginx configuration reloaded successfully');
      toast.success('IP whitelist applied and nginx reloaded successfully');
      setOriginalIpWhitelist([...config.ipWhitelist]);
    } catch (err) {
      clearInterval(countdownInterval);
      setIsReloadingNginx(false);

      if (err instanceof AuthenticationError) {
        clientLogger.warn('Authentication required, redirecting to login');
        toast.error('Session expired. Please log in again.');
        router.push('/admin/login');
      } else if (err instanceof AuthorizationError) {
        clientLogger.warn('Insufficient permissions to apply nginx config');
        toast.error('You do not have permission to apply nginx configuration');
      } else if (err instanceof ApiError) {
        clientLogger.error('Failed to apply nginx config:', {
          status: err.status,
          message: err.message,
          requestId: err.requestId
        });
        // Show specific error for config validation failures
        if (err.message?.includes('validation failed')) {
          toast.error('Nginx configuration validation failed. Check the config file.');
        } else {
          toast.error(err.message || 'Failed to apply nginx configuration');
        }
      } else {
        clientLogger.error('Unexpected error applying nginx config:', { error: String(err) });
        toast.error(err instanceof Error ? err.message : 'Failed to apply nginx configuration');
      }
    }
  };

  const addIpToWhitelist = () => {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(\/\d{1,3})?$/;
    if (!newIp) {
      toast.error('Please enter an IP address');
      return;
    }
    if (!ipv4Regex.test(newIp) && !ipv6Regex.test(newIp)) {
      toast.error('Invalid IP address format');
      return;
    }
    if (config.ipWhitelist.includes(newIp)) {
      toast.error('IP address already in whitelist');
      return;
    }

    setConfig((prev) => ({
      ...prev,
      ipWhitelist: [...prev.ipWhitelist, newIp],
    }));
    setNewIp('');
    setIpDialogOpen(false);
    toast.success('IP address added to whitelist');
  };

  const removeIpFromWhitelist = (ip: string) => {
    setConfig((prev) => ({
      ...prev,
      ipWhitelist: prev.ipWhitelist.filter((item) => item !== ip),
    }));
    toast.success('IP address removed from whitelist');
  };

  const getCertificateStatus = (cert: Certificate) => {
    const today = new Date();
    const validTo = new Date(cert.validTo);
    const daysUntilExpiry = Math.ceil((validTo.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return { color: 'error.main', text: 'Expired', days: daysUntilExpiry };
    } else if (daysUntilExpiry <= 30) {
      return { color: 'warning.main', text: `${daysUntilExpiry}d`, days: daysUntilExpiry };
    } else {
      return { color: 'success.main', text: 'Active', days: daysUntilExpiry };
    }
  };

  useEffect(() => {
    fetchSecurityConfig();
    fetchOAuthAdminCount();
  }, []);

  useEffect(() => {
    return () => {
      if (isReloadingNginx) {
        setIsReloadingNginx(false);
      }
    };
  }, [isReloadingNginx]);

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
            {/* SSL/TLS Configuration */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>SSL/TLS Configuration</SectionHeader>
                <ToggleRow
                  label="Enable SSL/TLS"
                  description="Secure connections"
                  checked={config.sslEnabled}
                  onChange={(checked) => setConfig({ ...config, sslEnabled: checked })}
                  disabled={saving}
                />
                <ToggleRow
                  label="Force HTTPS"
                  description="Redirect HTTP to HTTPS"
                  checked={config.httpsRedirect}
                  onChange={(checked) => setConfig({ ...config, httpsRedirect: checked })}
                  disabled={!config.sslEnabled || saving}
                />
                {certificates.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      Certificates
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ py: 0.5, px: 1 }}>Domain</TableCell>
                            <TableCell sx={{ py: 0.5, px: 1 }}>Expires</TableCell>
                            <TableCell sx={{ py: 0.5, px: 1 }}>Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {certificates.map((cert) => {
                            const status = getCertificateStatus(cert);
                            return (
                              <TableRow key={cert.id}>
                                <TableCell sx={{ py: 0.5, px: 1 }}>
                                  <Typography variant="caption">{cert.domain}</Typography>
                                </TableCell>
                                <TableCell sx={{ py: 0.5, px: 1 }}>
                                  <Typography variant="caption">
                                    {new Date(cert.validTo).toLocaleDateString()}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ py: 0.5, px: 1 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: status.color }} />
                                    <Typography variant="caption">{status.text}</Typography>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Authentication Settings */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Authentication</SectionHeader>
                <FieldRow label="Session timeout" description="Minutes of inactivity">
                  <TextField
                    size="small"
                    type="number"
                    value={config.sessionTimeout}
                    onChange={(e) =>
                      setConfig({ ...config, sessionTimeout: parseInt(e.target.value) || 30 })
                    }
                    disabled={saving}
                    fullWidth
                    inputProps={{ min: 5, max: 480 }}
                  />
                </FieldRow>
                <FieldRow label="Max login attempts" description="Before account lockout">
                  <TextField
                    size="small"
                    type="number"
                    value={config.maxLoginAttempts}
                    onChange={(e) =>
                      setConfig({ ...config, maxLoginAttempts: parseInt(e.target.value) || 5 })
                    }
                    disabled={saving}
                    fullWidth
                    inputProps={{ min: 1, max: 10 }}
                  />
                </FieldRow>
                <ToggleRow
                  label="Disable local login"
                  description="OAuth only (except admins)"
                  checked={!config.localLoginEnabled}
                  onChange={(checked) => {
                    if (checked && (!oauthAdminCount || oauthAdminCount === 0)) {
                      toast.error('Grant admin to an OAuth user first');
                      return;
                    }
                    setConfig({ ...config, localLoginEnabled: !checked });
                  }}
                  disabled={saving || (config.localLoginEnabled && (!oauthAdminCount || oauthAdminCount === 0))}
                />
                <ToggleRow
                  label="Two-factor auth"
                  description="Require 2FA for admins"
                  checked={config.twoFactorAuth}
                  onChange={(checked) => setConfig({ ...config, twoFactorAuth: checked })}
                  disabled={saving}
                />
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Password Requirements */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Password Requirements</SectionHeader>
                <FieldRow label="Min length" description="Minimum characters">
                  <TextField
                    size="small"
                    type="number"
                    value={config.passwordComplexity.minLength}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        passwordComplexity: {
                          ...config.passwordComplexity,
                          minLength: parseInt(e.target.value) || 8,
                        },
                      })
                    }
                    disabled={saving}
                    fullWidth
                    inputProps={{ min: 4, max: 32 }}
                  />
                </FieldRow>
                <ToggleRow
                  label="Uppercase"
                  description="Require A-Z"
                  checked={config.passwordComplexity.requireUppercase}
                  onChange={(checked) =>
                    setConfig({
                      ...config,
                      passwordComplexity: { ...config.passwordComplexity, requireUppercase: checked },
                    })
                  }
                  disabled={saving}
                />
                <ToggleRow
                  label="Lowercase"
                  description="Require a-z"
                  checked={config.passwordComplexity.requireLowercase}
                  onChange={(checked) =>
                    setConfig({
                      ...config,
                      passwordComplexity: { ...config.passwordComplexity, requireLowercase: checked },
                    })
                  }
                  disabled={saving}
                />
                <ToggleRow
                  label="Numbers"
                  description="Require 0-9"
                  checked={config.passwordComplexity.requireNumbers}
                  onChange={(checked) =>
                    setConfig({
                      ...config,
                      passwordComplexity: { ...config.passwordComplexity, requireNumbers: checked },
                    })
                  }
                  disabled={saving}
                />
                <ToggleRow
                  label="Special chars"
                  description="Require !@#$..."
                  checked={config.passwordComplexity.requireSpecialChars}
                  onChange={(checked) =>
                    setConfig({
                      ...config,
                      passwordComplexity: { ...config.passwordComplexity, requireSpecialChars: checked },
                    })
                  }
                  disabled={saving}
                />
              </CardContent>
            </Card>

            {/* IP Whitelist */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <SectionHeader>IP Whitelist</SectionHeader>
                  <Button size="small" onClick={() => setIpDialogOpen(true)}>
                    Add IP
                  </Button>
                </Box>
                {config.ipWhitelist.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No IP restrictions. All addresses allowed.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {config.ipWhitelist.map((ip) => (
                      <Box
                        key={ip}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          p: 1,
                          bgcolor: 'action.hover',
                          borderRadius: '4px',
                        }}
                      >
                        <Typography variant="body2">{ip}</Typography>
                        <Button size="small" color="error" onClick={() => removeIpFromWhitelist(ip)}>
                          Remove
                        </Button>
                      </Box>
                    ))}
                  </Stack>
                )}
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
          onClick={fetchSecurityConfig}
          disabled={loading || saving || isReloadingNginx}
        >
          Reset
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={saveSecurityConfig}
          disabled={saving || isReloadingNginx}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>

      {/* Loading overlay during nginx reload */}
      {isReloadingNginx && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <Card sx={{ p: 4, maxWidth: 400, textAlign: 'center' }}>
            <Typography variant="h6" gutterBottom>
              Reloading Nginx...
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Page will refresh in {reloadCountdown}s
            </Typography>
            <CircularProgress size={32} />
          </Card>
        </Box>
      )}

      {/* Nginx Reload Confirmation Dialog */}
      <Dialog open={showNginxConfirmDialog} onClose={() => setShowNginxConfirmDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Apply IP Whitelist?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            IP Whitelist changes require an Nginx configuration reload. This is a graceful operation that does not interrupt existing connections.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowNginxConfirmDialog(false)}>Cancel</Button>
          <Button onClick={applyNginxConfig} variant="contained">
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add IP Dialog */}
      <Dialog open={ipDialogOpen} onClose={() => setIpDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add IP Address</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="IP Address"
            placeholder="192.168.1.1 or 2001:db8::1"
            fullWidth
            size="small"
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            helperText="IPv4 or IPv6 address, with optional CIDR notation"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIpDialogOpen(false)}>Cancel</Button>
          <Button onClick={addIpToWhitelist} variant="contained">
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
