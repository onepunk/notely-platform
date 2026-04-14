/**
 * Admin Settings Page V2 - MOCKUP
 * Clean, minimal redesign for discussion purposes
 *
 * Design principles:
 * - Horizontal top navigation tabs
 * - No icon boxes next to headings
 * - Compact input fields (max-width constrained)
 * - Single content area (no multiple cards)
 * - Simple section headers with just text
 * - Professional, minimal aesthetic
 */

import { useState } from 'react';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import {
  Box,
  Typography,
  TextField,
  Switch,
  Button,
  Select,
  MenuItem,
  FormControl,
  Tabs,
  Tab,
} from '@mui/material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';

// Navigation categories
const categories = [
  { id: 'general', label: 'General' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'security', label: 'Security' },
  { id: 'passwords', label: 'Passwords' },
  { id: 'ai', label: 'AI Services' },
  { id: 'teams', label: 'Teams' },
  { id: 'sync', label: 'Sync' },
  { id: 'logging', label: 'Logging' },
  { id: 'backup', label: 'Backup' },
  { id: 'recordings', label: 'Recordings' },
  { id: 'rate-limits', label: 'Rate Limits' },
  { id: 'notifications', label: 'Notifications' },
];

// Reusable components for the mockup
const SectionHeader = ({ children }: { children: React.ReactNode }) => (
  <Typography
    variant="overline"
    sx={{
      display: 'block',
      color: 'text.secondary',
      fontWeight: 600,
      letterSpacing: 1,
      mb: 2,
      mt: 4,
      '&:first-of-type': { mt: 0 },
    }}
  >
    {children}
  </Typography>
);

const FieldRow = ({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, mb: 3 }}>
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
    <Box sx={{ flex: '0 0 240px' }}>{children}</Box>
  </Box>
);

const ToggleRow = ({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, mb: 2 }}>
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
    <Box sx={{ flex: '0 0 240px' }}>
      <Switch
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        size="small"
      />
    </Box>
  </Box>
);

// Content renderers for each category
const GeneralContent = () => {
  const [signupsEnabled, setSignupsEnabled] = useState(true);

  return (
    <>
      <SectionHeader>Registration</SectionHeader>
      <ToggleRow
        label="Allow sign-ups"
        description="New users can register"
        checked={signupsEnabled}
        onChange={setSignupsEnabled}
      />
    </>
  );
};

const SessionsContent = () => {
  const [adminTimeout, setAdminTimeout] = useState('60');
  const [sessionTimeout, setSessionTimeout] = useState('60');
  const [cleanupInterval, setCleanupInterval] = useState('15');
  const [maxSessions, setMaxSessions] = useState('100');

  return (
    <>
      <SectionHeader>Timeouts</SectionHeader>
      <FieldRow label="Admin timeout" description="Minutes of inactivity">
        <TextField
          size="small"
          type="number"
          value={adminTimeout}
          onChange={(e) => setAdminTimeout(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Session timeout" description="Client session cleanup">
        <TextField
          size="small"
          type="number"
          value={sessionTimeout}
          onChange={(e) => setSessionTimeout(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Cleanup interval" description="Check frequency (min)">
        <TextField
          size="small"
          type="number"
          value={cleanupInterval}
          onChange={(e) => setCleanupInterval(e.target.value)}
          fullWidth
        />
      </FieldRow>

      <SectionHeader>Limits</SectionHeader>
      <FieldRow label="Max sessions" description="Concurrent user sessions">
        <TextField
          size="small"
          type="number"
          value={maxSessions}
          onChange={(e) => setMaxSessions(e.target.value)}
          fullWidth
        />
      </FieldRow>
    </>
  );
};

const SecurityContent = () => {
  const [sslEnabled, setSslEnabled] = useState(true);
  const [httpsRedirect, setHttpsRedirect] = useState(true);
  const [localLogin, setLocalLogin] = useState(true);
  const [twoFactor, setTwoFactor] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState('5');

  return (
    <>
      <SectionHeader>SSL/TLS</SectionHeader>
      <ToggleRow
        label="Enable SSL"
        description="Secure connections"
        checked={sslEnabled}
        onChange={setSslEnabled}
      />
      <ToggleRow
        label="Force HTTPS"
        description="Redirect HTTP traffic"
        checked={httpsRedirect}
        onChange={setHttpsRedirect}
      />

      <SectionHeader>Authentication</SectionHeader>
      <ToggleRow
        label="Local login"
        description="Email/password sign-in"
        checked={localLogin}
        onChange={setLocalLogin}
      />
      <ToggleRow
        label="Two-factor auth"
        description="Require for admins"
        checked={twoFactor}
        onChange={setTwoFactor}
      />
      <FieldRow label="Max login attempts" description="Before lockout">
        <TextField
          size="small"
          type="number"
          value={maxAttempts}
          onChange={(e) => setMaxAttempts(e.target.value)}
          fullWidth
        />
      </FieldRow>
    </>
  );
};

const PasswordsContent = () => {
  const [minLength, setMinLength] = useState('8');
  const [requireUpper, setRequireUpper] = useState(true);
  const [requireLower, setRequireLower] = useState(true);
  const [requireNumbers, setRequireNumbers] = useState(true);
  const [requireSpecial, setRequireSpecial] = useState(true);

  return (
    <>
      <SectionHeader>Complexity Requirements</SectionHeader>
      <FieldRow label="Minimum length" description="Characters required">
        <TextField
          size="small"
          type="number"
          value={minLength}
          onChange={(e) => setMinLength(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <ToggleRow
        label="Uppercase"
        description="Require A-Z"
        checked={requireUpper}
        onChange={setRequireUpper}
      />
      <ToggleRow
        label="Lowercase"
        description="Require a-z"
        checked={requireLower}
        onChange={setRequireLower}
      />
      <ToggleRow
        label="Numbers"
        description="Require 0-9"
        checked={requireNumbers}
        onChange={setRequireNumbers}
      />
      <ToggleRow
        label="Special characters"
        description="Require !@#$%"
        checked={requireSpecial}
        onChange={setRequireSpecial}
      />
    </>
  );
};

const AIContent = () => {
  const [whisperModel, setWhisperModel] = useState('base');
  const [whisperAutoReload, setWhisperAutoReload] = useState(true);
  const [llmGpu, setLlmGpu] = useState(false);
  const [llmAutoReload, setLlmAutoReload] = useState(true);

  return (
    <>
      <SectionHeader>Whisper (Speech-to-Text)</SectionHeader>
      <FieldRow label="Model" description="Accuracy vs speed">
        <FormControl size="small" fullWidth>
          <Select
            value={whisperModel}
            onChange={(e) => setWhisperModel(e.target.value)}
          >
            <MenuItem value="tiny">tiny - Fastest</MenuItem>
            <MenuItem value="base">base - Balanced</MenuItem>
            <MenuItem value="small">small - Better accuracy</MenuItem>
            <MenuItem value="medium">medium - High accuracy</MenuItem>
            <MenuItem value="large-v2">large-v2 - Very high</MenuItem>
            <MenuItem value="large-v3">large-v3 - Highest</MenuItem>
          </Select>
        </FormControl>
      </FieldRow>
      <ToggleRow
        label="Auto-reload"
        description="Restart on model change"
        checked={whisperAutoReload}
        onChange={setWhisperAutoReload}
      />

      <SectionHeader>LLM (Text Processing)</SectionHeader>
      <ToggleRow
        label="GPU acceleration"
        description="Use CUDA if available"
        checked={llmGpu}
        onChange={setLlmGpu}
      />
      <ToggleRow
        label="Auto-reload"
        description="Restart on config change"
        checked={llmAutoReload}
        onChange={setLlmAutoReload}
      />
    </>
  );
};

const TeamsContent = () => {
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [autoJoin, setAutoJoin] = useState(false);
  const [botAppId, setBotAppId] = useState('');
  const [tenantId, setTenantId] = useState('');

  return (
    <>
      <SectionHeader>Microsoft Teams Integration</SectionHeader>
      <ToggleRow
        label="Enable Teams"
        description="Meeting integration"
        checked={teamsEnabled}
        onChange={setTeamsEnabled}
      />
      <ToggleRow
        label="Auto-join meetings"
        description="Automatic participation"
        checked={autoJoin}
        onChange={setAutoJoin}
      />
      <FieldRow label="Bot App ID" description="Azure application">
        <TextField
          size="small"
          value={botAppId}
          onChange={(e) => setBotAppId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx"
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Tenant ID" description="Azure tenant">
        <TextField
          size="small"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx"
          fullWidth
        />
      </FieldRow>
    </>
  );
};

const SyncContent = () => {
  const [pushBatchSize, setPushBatchSize] = useState('100');
  const [pullBatchSize, setPullBatchSize] = useState('500');
  const [compressionEnabled, setCompressionEnabled] = useState(true);
  const [conflictResolution, setConflictResolution] = useState('last-write-wins');

  return (
    <>
      <SectionHeader>Batch Operations</SectionHeader>
      <FieldRow label="Push batch size" description="Records per push">
        <TextField
          size="small"
          type="number"
          value={pushBatchSize}
          onChange={(e) => setPushBatchSize(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Pull batch size" description="Records per pull">
        <TextField
          size="small"
          type="number"
          value={pullBatchSize}
          onChange={(e) => setPullBatchSize(e.target.value)}
          fullWidth
        />
      </FieldRow>

      <SectionHeader>Options</SectionHeader>
      <ToggleRow
        label="Compression"
        description="Compress sync payloads"
        checked={compressionEnabled}
        onChange={setCompressionEnabled}
      />
      <FieldRow label="Conflict resolution" description="Merge strategy">
        <FormControl size="small" fullWidth>
          <Select
            value={conflictResolution}
            onChange={(e) => setConflictResolution(e.target.value)}
          >
            <MenuItem value="last-write-wins">Last write wins</MenuItem>
            <MenuItem value="server-wins">Server wins</MenuItem>
            <MenuItem value="client-wins">Client wins</MenuItem>
          </Select>
        </FormControl>
      </FieldRow>
    </>
  );
};

const LoggingContent = () => {
  const [retentionDays, setRetentionDays] = useState('30');
  const [cleanupEnabled, setCleanupEnabled] = useState(true);
  const [cleanupSchedule, setCleanupSchedule] = useState('0 2 * * *');

  return (
    <>
      <SectionHeader>Retention</SectionHeader>
      <FieldRow label="Retention period" description="Days to keep logs">
        <TextField
          size="small"
          type="number"
          value={retentionDays}
          onChange={(e) => setRetentionDays(e.target.value)}
          fullWidth
        />
      </FieldRow>

      <SectionHeader>Cleanup</SectionHeader>
      <ToggleRow
        label="Auto cleanup"
        description="Remove old logs"
        checked={cleanupEnabled}
        onChange={setCleanupEnabled}
      />
      <FieldRow label="Schedule" description="Cron expression">
        <TextField
          size="small"
          value={cleanupSchedule}
          onChange={(e) => setCleanupSchedule(e.target.value)}
          fullWidth
        />
      </FieldRow>
    </>
  );
};

const BackupContent = () => {
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [includeUserData, setIncludeUserData] = useState(true);
  const [compressionEnabled, setCompressionEnabled] = useState(true);
  const [retentionDays, setRetentionDays] = useState('30');
  const [schedule, setSchedule] = useState('0 3 * * *');

  return (
    <>
      <SectionHeader>Backup Options</SectionHeader>
      <ToggleRow
        label="Enable backups"
        description="Automated backups"
        checked={backupEnabled}
        onChange={setBackupEnabled}
      />
      <ToggleRow
        label="Include user data"
        description="Notes and files"
        checked={includeUserData}
        onChange={setIncludeUserData}
      />
      <ToggleRow
        label="Compression"
        description="Compress backup files"
        checked={compressionEnabled}
        onChange={setCompressionEnabled}
      />

      <SectionHeader>Schedule</SectionHeader>
      <FieldRow label="Cron schedule" description="When to run">
        <TextField
          size="small"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Retention" description="Days to keep backups">
        <TextField
          size="small"
          type="number"
          value={retentionDays}
          onChange={(e) => setRetentionDays(e.target.value)}
          fullWidth
        />
      </FieldRow>
    </>
  );
};

const RecordingsContent = () => {
  const [freeMaxSize, setFreeMaxSize] = useState('100');
  const [freeRetention, setFreeRetention] = useState('7');
  const [proMaxSize, setProMaxSize] = useState('500');
  const [proRetention, setProRetention] = useState('30');
  const [enterpriseMaxSize, setEnterpriseMaxSize] = useState('2000');
  const [enterpriseRetention, setEnterpriseRetention] = useState('365');

  return (
    <>
      <SectionHeader>Free Tier</SectionHeader>
      <FieldRow label="Max file size" description="MB per recording">
        <TextField
          size="small"
          type="number"
          value={freeMaxSize}
          onChange={(e) => setFreeMaxSize(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Retention" description="Days to keep">
        <TextField
          size="small"
          type="number"
          value={freeRetention}
          onChange={(e) => setFreeRetention(e.target.value)}
          fullWidth
        />
      </FieldRow>

      <SectionHeader>Professional Tier</SectionHeader>
      <FieldRow label="Max file size" description="MB per recording">
        <TextField
          size="small"
          type="number"
          value={proMaxSize}
          onChange={(e) => setProMaxSize(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Retention" description="Days to keep">
        <TextField
          size="small"
          type="number"
          value={proRetention}
          onChange={(e) => setProRetention(e.target.value)}
          fullWidth
        />
      </FieldRow>

      <SectionHeader>Enterprise Tier</SectionHeader>
      <FieldRow label="Max file size" description="MB per recording">
        <TextField
          size="small"
          type="number"
          value={enterpriseMaxSize}
          onChange={(e) => setEnterpriseMaxSize(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Retention" description="Days to keep">
        <TextField
          size="small"
          type="number"
          value={enterpriseRetention}
          onChange={(e) => setEnterpriseRetention(e.target.value)}
          fullWidth
        />
      </FieldRow>
    </>
  );
};

const RateLimitsContent = () => {
  const [globalPoints, setGlobalPoints] = useState('100');
  const [globalDuration, setGlobalDuration] = useState('60');
  const [loginPoints, setLoginPoints] = useState('5');
  const [loginDuration, setLoginDuration] = useState('300');
  const [blockDuration, setBlockDuration] = useState('900');

  return (
    <>
      <SectionHeader>Global Limits</SectionHeader>
      <FieldRow label="Requests" description="Per time window">
        <TextField
          size="small"
          type="number"
          value={globalPoints}
          onChange={(e) => setGlobalPoints(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Window" description="Seconds">
        <TextField
          size="small"
          type="number"
          value={globalDuration}
          onChange={(e) => setGlobalDuration(e.target.value)}
          fullWidth
        />
      </FieldRow>

      <SectionHeader>Login Limits</SectionHeader>
      <FieldRow label="Attempts" description="Before block">
        <TextField
          size="small"
          type="number"
          value={loginPoints}
          onChange={(e) => setLoginPoints(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Window" description="Seconds">
        <TextField
          size="small"
          type="number"
          value={loginDuration}
          onChange={(e) => setLoginDuration(e.target.value)}
          fullWidth
        />
      </FieldRow>
      <FieldRow label="Block duration" description="Seconds">
        <TextField
          size="small"
          type="number"
          value={blockDuration}
          onChange={(e) => setBlockDuration(e.target.value)}
          fullWidth
        />
      </FieldRow>
    </>
  );
};

const NotificationsContent = () => {
  const [registrationAlerts, setRegistrationAlerts] = useState(true);
  const [alertEmail, setAlertEmail] = useState('admin@example.com');

  return (
    <>
      <SectionHeader>Email Alerts</SectionHeader>
      <ToggleRow
        label="Registration alerts"
        description="New user sign-ups"
        checked={registrationAlerts}
        onChange={setRegistrationAlerts}
      />
      <FieldRow label="Recipient email" description="Where to send alerts">
        <TextField
          size="small"
          type="email"
          value={alertEmail}
          onChange={(e) => setAlertEmail(e.target.value)}
          fullWidth
        />
      </FieldRow>
    </>
  );
};

// Content renderer map
const contentRenderers: Record<string, () => JSX.Element> = {
  general: GeneralContent,
  sessions: SessionsContent,
  security: SecurityContent,
  passwords: PasswordsContent,
  ai: AIContent,
  teams: TeamsContent,
  sync: SyncContent,
  logging: LoggingContent,
  backup: BackupContent,
  recordings: RecordingsContent,
  'rate-limits': RateLimitsContent,
  notifications: NotificationsContent,
};

export default function AdminSettingsPage2() {
  const [activeCategory, setActiveCategory] = useState('general');

  const ContentRenderer = contentRenderers[activeCategory] || GeneralContent;
  const activeIndex = categories.findIndex((c) => c.id === activeCategory);

  return (
    <>
      <Head>
        <title>Admin Settings · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Admin Settings"
          subtitle="System-wide configuration and preferences"
        >
          {/* Top Navigation Tabs */}
          <Box
            sx={{
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              mb: 4,
            }}
          >
            <Tabs
              value={activeIndex}
              onChange={(_, newValue) => setActiveCategory(categories[newValue].id)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                '& .MuiTab-root': {
                  textTransform: 'none',
                  minWidth: 'auto',
                  px: 2,
                  py: 1.5,
                  fontSize: '0.875rem',
                },
              }}
            >
              {categories.map((cat) => (
                <Tab key={cat.id} label={cat.label} />
              ))}
            </Tabs>
          </Box>

          {/* Main Content Area */}
          <Box sx={{ maxWidth: 560 }}>
            <ContentRenderer />

            {/* Action Buttons */}
            <Box sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 2 }}>
              <Button variant="outlined" size="small">
                Reset
              </Button>
              <Button variant="contained" size="small">
                Save Changes
              </Button>
            </Box>
          </Box>
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'system:admin' });
