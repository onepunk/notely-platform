/**
 * Teams Settings Tab
 * Microsoft Teams integration configuration and user management
 * Clean, minimal design - no icons, compact inputs
 */

import { useEffect, useState } from 'react';
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
import { toast } from 'react-hot-toast';
import settingsService, { TeamsConfig, TeamsStatus } from '@/services/settingsService';

type JoinMode = 'acs' | 'graph';

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
    <Box sx={{ flex: 1 }}>{children}</Box>
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

export default function TeamsSettingsTab() {
  const [config, setConfig] = useState<TeamsConfig>({
    teams_enabled: false,
    teams_bot_app_id: '',
    teams_tenant_id: '',
    teams_auto_join: false,
    teams_email_recipients: 'host_only',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<TeamsStatus | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [manageEmail, setManageEmail] = useState('');
  const [manageEnable, setManageEnable] = useState(true);
  const [manageJoinMode, setManageJoinMode] = useState<JoinMode>('acs');
  const [bulkEnable, setBulkEnable] = useState(true);
  const [bulkIncludeAdmins, setBulkIncludeAdmins] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState('');

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const data = await settingsService.getTeamsConfig();
      setConfig(data);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load Teams configuration');
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const data = await settingsService.getTeamsStatus();
      setStatus(data);
    } catch (e) {
      // Ignore status fetch errors
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await settingsService.updateTeamsConfig(config);
      toast.success('Teams settings saved');
      fetchStatus();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save Teams settings');
    } finally {
      setSaving(false);
    }
  };

  const sendTestEmail = async () => {
    try {
      const result = await settingsService.sendTestEmail(testEmail || undefined);
      if (result.success) {
        toast.success('Test email sent');
      } else {
        throw new Error(result.error || 'Failed to send test email');
      }
    } catch (e: any) {
      toast.error(`Test email failed: ${e.message}`);
    }
  };

  const toggleUserTeams = async () => {
    if (!manageEmail) {
      toast.error('Enter a user email');
      return;
    }
    try {
      const result = await settingsService.enableUserTeams(manageEmail, manageEnable);
      if (result.success) {
        toast.success(`${manageEnable ? 'Enabled' : 'Disabled'} Teams for ${manageEmail}`);
        setManageEmail('');
      } else {
        throw new Error(result.error || 'Failed to update user');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to update user');
    }
  };

  const updateUserJoinMode = async () => {
    if (!manageEmail) {
      toast.error('Enter a user email');
      return;
    }
    try {
      const result = await settingsService.updateUserJoinMode(manageEmail, manageJoinMode);
      if (result.success) {
        toast.success(`Updated join mode to ${manageJoinMode.toUpperCase()} for ${manageEmail}`);
      } else {
        throw new Error(result.error || 'Failed to update join mode');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to update join mode');
    }
  };

  const bulkToggleAll = async () => {
    if (bulkConfirm !== 'ENABLE_ALL') {
      toast.error('Type ENABLE_ALL to confirm');
      return;
    }
    try {
      const result = await settingsService.bulkEnableTeams(bulkEnable, bulkIncludeAdmins, 'ENABLE_ALL');
      if (result.success) {
        toast.success(`${bulkEnable ? 'Enabled' : 'Disabled'} Teams for ${result.data?.updated || 0} users`);
        setBulkConfirm('');
      } else {
        throw new Error(result.error || 'Bulk update failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Bulk update failed');
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchStatus();
  }, []);

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
            {/* Configuration */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Teams Configuration</SectionHeader>
                <ToggleRow
                  label="Enable Teams"
                  description="Allow bot to join meetings"
                  checked={!!config.teams_enabled}
                  onChange={(checked) => setConfig((c) => ({ ...c, teams_enabled: checked }))}
                  disabled={saving}
                />
                <ToggleRow
                  label="Auto-join"
                  description="Join meetings automatically"
                  checked={!!config.teams_auto_join}
                  onChange={(checked) => setConfig((c) => ({ ...c, teams_auto_join: checked }))}
                  disabled={saving}
                />
                <FieldRow label="Bot App ID" description="Microsoft Teams Bot ID">
                  <TextField
                    size="small"
                    fullWidth
                    value={config.teams_bot_app_id || ''}
                    onChange={(e) => setConfig((c) => ({ ...c, teams_bot_app_id: e.target.value }))}
                    disabled={saving}
                  />
                </FieldRow>
                <FieldRow label="Tenant ID" description="Azure Tenant ID">
                  <TextField
                    size="small"
                    fullWidth
                    value={config.teams_tenant_id || ''}
                    onChange={(e) => setConfig((c) => ({ ...c, teams_tenant_id: e.target.value }))}
                    disabled={saving}
                  />
                </FieldRow>
                <FieldRow label="Recipients" description="Summary email recipients">
                  <TextField
                    size="small"
                    fullWidth
                    value={
                      Array.isArray(config.teams_email_recipients)
                        ? (config.teams_email_recipients as string[]).join(', ')
                        : config.teams_email_recipients || ''
                    }
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setConfig((c) => ({
                        ...c,
                        teams_email_recipients:
                          val.length === 0 ? 'host_only' : val.split(',').map((s) => s.trim()).filter(Boolean),
                      }));
                    }}
                    placeholder="host only, or comma-separated"
                    disabled={saving}
                  />
                </FieldRow>
              </CardContent>
            </Card>

            {/* Microsoft Status */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Microsoft Status</SectionHeader>
                <StatusRow
                  label="Email via Graph"
                  value={status?.microsoftEmail ? 'Configured' : 'Not configured'}
                  status={status?.microsoftEmail ? 'healthy' : 'unknown'}
                />
                <StatusRow
                  label="Service account"
                  value={status?.ms?.sender || '—'}
                />
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Send Test Email
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      size="small"
                      placeholder="test@example.com"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      sx={{ width: 200 }}
                    />
                    <Button variant="outlined" size="small" onClick={sendTestEmail}>
                      Send
                    </Button>
                  </Stack>
                </Box>
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* User Management */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Manage User</SectionHeader>
                <FieldRow label="User email" description="Email to manage">
                  <TextField
                    size="small"
                    fullWidth
                    value={manageEmail}
                    onChange={(e) => setManageEmail(e.target.value)}
                    placeholder="user@example.com"
                  />
                </FieldRow>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <ToggleRow
                    label="Enable Teams"
                    checked={manageEnable}
                    onChange={setManageEnable}
                  />
                  <Button variant="contained" size="small" onClick={toggleUserTeams}>
                    Apply
                  </Button>
                </Box>
                <Box sx={{ mt: 3 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Join Mode
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      size="small"
                      select
                      value={manageJoinMode}
                      onChange={(e) => setManageJoinMode(e.target.value as JoinMode)}
                      SelectProps={{ native: true }}
                      sx={{ width: 150 }}
                    >
                      <option value="acs">ACS Mode</option>
                      <option value="graph">Graph Mode</option>
                    </TextField>
                    <Button variant="outlined" size="small" onClick={updateUserJoinMode}>
                      Update
                    </Button>
                  </Stack>
                </Box>
              </CardContent>
            </Card>

            {/* Bulk Operations */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Bulk Operations</SectionHeader>
                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                  <ToggleRow
                    label={bulkEnable ? 'Enable all' : 'Disable all'}
                    checked={bulkEnable}
                    onChange={setBulkEnable}
                  />
                  <ToggleRow
                    label="Include admins"
                    checked={bulkIncludeAdmins}
                    onChange={setBulkIncludeAdmins}
                  />
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small"
                    label="Type ENABLE_ALL"
                    value={bulkConfirm}
                    onChange={(e) => setBulkConfirm(e.target.value)}
                    sx={{ width: 200 }}
                  />
                  <Button variant="contained" color="warning" size="small" onClick={bulkToggleAll}>
                    Apply
                  </Button>
                </Stack>
                <Alert severity="warning" sx={{ mt: 2, fontSize: '0.75rem' }}>
                  Updates all active users. Use with caution.
                </Alert>
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
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}
