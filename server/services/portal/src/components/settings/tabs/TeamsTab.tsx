/**
 * Teams Settings Tab
 * User-facing Teams connection and bot configuration
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  Groups as TeamsIcon,
  Shield as ShieldIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import settingsService, { TeamsSelfStatus, BotProfile } from '@/services/settingsService';

const DEFAULT_ACS_PREFIX = 'Note-taker';
const DEFAULT_ALLOWED_PREFIXES = [
  'Note-taker',
  'Meeting Assistant',
  'Scribe',
  'Recorder',
  'AI Assistant',
];

const computeDisplayName = (rawFirstName: string, rawPrefix: string) => {
  const trimmedName = (rawFirstName || '').trim();
  const base = trimmedName
    ? trimmedName.endsWith('s') || trimmedName.endsWith('S')
      ? `${trimmedName}'`
      : `${trimmedName}'s`
    : "Notely's";
  const safePrefix = (rawPrefix || DEFAULT_ACS_PREFIX).trim() || DEFAULT_ACS_PREFIX;
  return `${base} ${safePrefix} (Notely)`;
};

export default function TeamsTab() {
  const { user, hasRole } = useAuth();
  const [status, setStatus] = useState<TeamsSelfStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botProfile, setBotProfile] = useState<BotProfile>({
    acsDisplayFirstName: user?.firstName || '',
    acsDisplayPrefix: DEFAULT_ACS_PREFIX,
    displayName: computeDisplayName(user?.firstName || '', DEFAULT_ACS_PREFIX),
    allowedPrefixes: DEFAULT_ALLOWED_PREFIXES,
    defaultPrefix: DEFAULT_ACS_PREFIX,
  });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);

  const isAdmin = hasRole('admin') || hasRole('super_admin');

  const loadStatus = useCallback(async (forceRefresh = false) => {
    try {
      if (!forceRefresh) {
        setIsLoading(true);
        setError(null);
      }
      const data = await settingsService.getTeamsSelfStatus();
      setStatus(data);
      setError(null);
    } catch (error: any) {
      clientLogger.error('[Teams] Failed to load status', { error: error instanceof Error ? error.message : String(error) });
      const errorMessage = error?.response?.status === 401
        ? 'Authentication failed. Please try logging out and back in.'
        : error?.message || 'Unable to load Teams status';
      if (!forceRefresh) {
        setError(errorMessage);
      }
    } finally {
      if (!forceRefresh) setIsLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const data = await settingsService.getBotProfile();
      // Always use the user's first name from auth context
      const firstName = user?.firstName || '';
      setBotProfile({
        acsDisplayFirstName: firstName,
        acsDisplayPrefix: data.acsDisplayPrefix || data.defaultPrefix || DEFAULT_ACS_PREFIX,
        displayName: computeDisplayName(firstName, data.acsDisplayPrefix || DEFAULT_ACS_PREFIX),
        allowedPrefixes: data.allowedPrefixes?.length ? data.allowedPrefixes : DEFAULT_ALLOWED_PREFIXES,
        defaultPrefix: data.defaultPrefix || DEFAULT_ACS_PREFIX,
      });
      setProfileDirty(false);
    } catch (error: any) {
      clientLogger.error('[Teams] Failed to load bot profile', { error: error instanceof Error ? error.message : String(error) });
      // Profile loading errors are non-critical, don't show to user
    } finally {
      setProfileLoading(false);
    }
  }, [user?.firstName]);

  const handleProfileSave = useCallback(async () => {
    setProfileSaving(true);
    try {
      setError(null);
      // Always use the user's first name from auth context
      const result = await settingsService.updateBotProfile(
        user?.firstName || '',
        botProfile.acsDisplayPrefix
      );
      if (result.success && result.data) {
        setBotProfile((prev) => ({
          ...prev,
          acsDisplayFirstName: user?.firstName || '',
          acsDisplayPrefix: result.data.acsDisplayPrefix || prev.acsDisplayPrefix,
          displayName: result.data.displayName || computeDisplayName(user?.firstName || '', result.data.acsDisplayPrefix || prev.acsDisplayPrefix),
        }));
        setProfileDirty(false);
        toast.success('Meeting bot name updated');
      }
    } catch (error: any) {
      clientLogger.error('[Teams] Failed to update bot profile', { error: error instanceof Error ? error.message : String(error) });
      setError(error?.message || 'Unable to update meeting bot name');
    } finally {
      setProfileSaving(false);
    }
  }, [botProfile.acsDisplayPrefix, user?.firstName]);

  const handleProfileReset = useCallback(() => {
    loadProfile();
  }, [loadProfile]);

  const handleEnable = async () => {
    if (!status?.licenseActive) {
      setError('Activate your Teams license before enabling the bot.');
      return;
    }
    try {
      setIsWorking(true);
      setError(null);
      // Always use notely_smtp mode (allowPersonal=true)
      const result = await settingsService.enableTeamsSelf(true, true, status.tenantId);
      if (result.success) {
        toast.success('Teams auto-join enabled');
        await Promise.all([loadStatus(true), loadProfile()]);
      }
    } catch (error: any) {
      clientLogger.error('[Teams] Enable failed', { error: error instanceof Error ? error.message : String(error) });
      setError(error?.message || 'Unable to enable Teams auto-join');
    } finally {
      setIsWorking(false);
    }
  };

  const handleDisable = async () => {
    try {
      setIsWorking(true);
      setError(null);
      const result = await settingsService.disableTeamsSelf();
      if (result.success) {
        toast.success('Teams auto-join disabled');
        await Promise.all([loadStatus(true), loadProfile()]);
      }
    } catch (error: any) {
      clientLogger.error('[Teams] Disable failed', { error: error instanceof Error ? error.message : String(error) });
      setError(error?.message || 'Unable to disable Teams');
    } finally {
      setIsWorking(false);
    }
  };

  useEffect(() => {
    loadStatus();
    loadProfile();
  }, [loadStatus, loadProfile]);

  if (isLoading) {
    return (
      <Card sx={{ borderRadius: 4 }}>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="center" py={4}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary" ml={2}>
              Loading Teams settings...
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  const connectionStatus = !status?.licenseActive
    ? { text: 'License required', color: 'text.secondary' }
    : status.enabled && status.autoJoin
    ? { text: 'Active', color: 'success.main' }
    : status.enabled
    ? { text: 'Configured', color: 'info.main' }
    : { text: 'Not configured', color: 'text.secondary' };

  const statusMessage = !status?.licenseActive
    ? 'Activate your Teams license to enable meeting transcription and summaries.'
    : !status.enabled
    ? 'Configure your note-taking bot name below, then enable auto-join to start automatically attending your Teams meetings.'
    : 'Teams integration is active. Notely will automatically attend and summarize your meetings.';

  return (
    <Stack spacing={3}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Card sx={{ borderRadius: 4 }}>
        <CardContent>
          <Stack spacing={3}>
            {/* Header */}
            <Box display="flex" alignItems="center" gap={2}>
              <TeamsIcon color="primary" sx={{ fontSize: 32 }} />
              <Box flex={1}>
                <Typography variant="h6" fontWeight={600}>
                  Microsoft Teams
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="body2" color="text.secondary">
                    Status:
                  </Typography>
                  <Typography variant="body2" color={connectionStatus.color} fontWeight={500}>
                    {connectionStatus.text}
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* Description */}
            <Typography variant="body2" color="text.secondary">
              {statusMessage}
            </Typography>

            {/* License Warning */}
            {!status?.licenseActive && (
              <Alert severity="info">
                Your Teams license is inactive. Please contact an administrator to activate it.
              </Alert>
            )}

            {/* Bot Name Configuration */}
            <Box>
              <Typography variant="subtitle2" fontWeight={600} color="text.primary" mb={1}>
                Note-taking bot name
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Your bot name is based on your first name ({user?.firstName || 'your name'}). Choose a suffix below to customize how the bot appears in the Teams roster.
              </Typography>

              {profileLoading ? (
                <Box display="flex" justifyContent="center" py={3}>
                  <CircularProgress size={20} />
                </Box>
              ) : (
                <Stack spacing={2} mt={2}>
                  <TextField
                    label="Bot suffix"
                    select
                    sx={{ maxWidth: 250 }}
                    helperText="How the bot identifies itself"
                    value={botProfile.acsDisplayPrefix}
                    onChange={(event) => {
                      const value = event.target.value;
                      setBotProfile((prev) => ({
                        ...prev,
                        acsDisplayPrefix: value,
                        displayName: computeDisplayName(user?.firstName || '', value),
                      }));
                      setProfileDirty(true);
                    }}
                    disabled={profileSaving || !status?.licenseActive}
                  >
                    {botProfile.allowedPrefixes.map((option) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ))}
                  </TextField>

                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      Display name:
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {computeDisplayName(user?.firstName || '', botProfile.acsDisplayPrefix)}
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      onClick={handleProfileSave}
                      disabled={!profileDirty || profileSaving || !status?.licenseActive}
                    >
                      {profileSaving ? <CircularProgress size={18} color="inherit" /> : 'Save'}
                    </Button>
                    <Button
                      variant="text"
                      onClick={handleProfileReset}
                      disabled={!profileDirty || profileSaving || !status?.licenseActive}
                    >
                      Reset
                    </Button>
                  </Stack>
                </Stack>
              )}
            </Box>

            <Divider />

            {/* Auto-join Toggle */}
            {status && (
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    Auto-join meetings
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Automatically attend and transcribe your meetings
                  </Typography>
                </Box>
                <Switch
                  checked={status.enabled && status.autoJoin}
                  disabled={isWorking || !status.licenseActive}
                  onChange={(event) => {
                    if (event.target.checked) {
                      handleEnable();
                    } else {
                      handleDisable();
                    }
                  }}
                />
              </Box>
            )}

            {/* Admin Link */}
            {isAdmin && (
              <>
                <Divider />
                <Alert severity="info">
                  You have administrator access. Visit the{' '}
                  <strong>Teams Admin</strong> page from the sidebar to manage global Teams settings.
                </Alert>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
