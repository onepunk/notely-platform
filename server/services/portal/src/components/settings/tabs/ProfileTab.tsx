/**
 * Profile Settings Tab
 * User profile information and timezone settings
 */

import { useState, useEffect, useCallback, SyntheticEvent } from 'react';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  ManageAccounts as ManageAccountsIcon,
  Public as PublicIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import settingsService from '@/services/settingsService';

interface TimezoneOption {
  value: string;
  label: string;
  offset: string;
}

// Common timezones with user-friendly labels
const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: 'America/New_York', label: 'Eastern Time (New York)', offset: 'UTC-5/-4' },
  { value: 'America/Chicago', label: 'Central Time (Chicago)', offset: 'UTC-6/-5' },
  { value: 'America/Denver', label: 'Mountain Time (Denver)', offset: 'UTC-7/-6' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)', offset: 'UTC-8/-7' },
  { value: 'America/Phoenix', label: 'Arizona Time (Phoenix)', offset: 'UTC-7' },
  { value: 'Europe/London', label: 'Greenwich Mean Time (London)', offset: 'UTC+0/+1' },
  { value: 'Europe/Paris', label: 'Central European Time (Paris)', offset: 'UTC+1/+2' },
  { value: 'Europe/Berlin', label: 'Central European Time (Berlin)', offset: 'UTC+1/+2' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time (Dubai)', offset: 'UTC+4' },
  { value: 'Asia/Tokyo', label: 'Japan Standard Time (Tokyo)', offset: 'UTC+9' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time (Sydney)', offset: 'UTC+10/+11' },
  { value: 'Pacific/Auckland', label: 'New Zealand Time (Auckland)', offset: 'UTC+12/+13' },
];

function formatDate(value: string | null, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return fallback;
  return date.toLocaleString();
}

function getInitials(firstName?: string, lastName?: string) {
  const initials = [firstName?.[0], lastName?.[0]].filter(Boolean).join('');
  return initials || 'N';
}

function detectUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function getTimezoneOffset(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(now);
    const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value || '';
    return timeZoneName;
  } catch {
    return 'Unknown';
  }
}

export default function ProfileTab() {
  const { user, refreshProfile } = useAuth();
  const [selectedTimezone, setSelectedTimezone] = useState<TimezoneOption | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [detectedTimezone, setDetectedTimezone] = useState<string>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Notely user';
  const initials = getInitials(user?.firstName || undefined, user?.lastName || undefined);

  // Detect browser timezone on mount
  useEffect(() => {
    const detected = detectUserTimezone();
    setDetectedTimezone(detected);
  }, []);

  // Set initial timezone value
  useEffect(() => {
    if (user?.timezone) {
      const option = COMMON_TIMEZONES.find((tz) => tz.value === user.timezone);
      if (option) {
        setSelectedTimezone(option);
      } else {
        setSelectedTimezone({
          value: user.timezone,
          label: user.timezone.replace(/_/g, ' '),
          offset: getTimezoneOffset(user.timezone),
        });
      }
    } else if (detectedTimezone) {
      const option = COMMON_TIMEZONES.find((tz) => tz.value === detectedTimezone);
      if (option) {
        setSelectedTimezone(option);
        setHasUnsavedChanges(true);
      }
    }
  }, [user?.timezone, detectedTimezone]);

  const handleTimezoneChange = useCallback(
    (event: SyntheticEvent<Element, Event>, newValue: TimezoneOption | string | null) => {
      if (!newValue) {
        setSelectedTimezone(null);
        setHasUnsavedChanges(false);
        return;
      }

      const option: TimezoneOption =
        typeof newValue === 'string'
          ? {
              value: newValue,
              label: String(newValue).replace(/_/g, ' '),
              offset: getTimezoneOffset(String(newValue)),
            }
          : newValue;

      setSelectedTimezone(option);
      setHasUnsavedChanges(option.value !== user?.timezone);
    },
    [user?.timezone]
  );

  const handleSave = useCallback(async () => {
    if (!selectedTimezone) return;

    setIsLoading(true);
    try {
      await settingsService.updateProfile({ timezone: selectedTimezone.value });
      await refreshProfile();
      setHasUnsavedChanges(false);
      toast.success('Timezone updated successfully');
    } catch (error: any) {
      clientLogger.error('Failed to update timezone:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error?.message || 'Failed to update timezone');
    } finally {
      setIsLoading(false);
    }
  }, [selectedTimezone, refreshProfile]);

  const currentTime = selectedTimezone
    ? new Date().toLocaleString('en-US', {
        timeZone: selectedTimezone.value,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : '';

  return (
    <Stack spacing={3}>
      {/* Profile Card */}
      <Card sx={{ borderRadius: 1 }}>
        <CardContent>
          <Grid container spacing={4} alignItems="center">
            <Grid item xs={12} md={4}>
              <Stack alignItems="center" spacing={2}>
                <Avatar
                  sx={{
                    width: 96,
                    height: 96,
                    bgcolor: 'primary.main',
                    fontSize: 32,
                  }}
                >
                  {initials.toUpperCase()}
                </Avatar>
                <Stack spacing={0.5} textAlign="center">
                  <Typography variant="h6" fontWeight={700}>
                    {fullName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {user?.email}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap">
                  <Chip
                    icon={<ManageAccountsIcon fontSize="small" />}
                    label={user?.role?.replace(/_/g, ' ') || 'User'}
                    color="primary"
                    variant="outlined"
                  />
                  <Chip
                    label={user?.isActive ? 'Active' : 'Inactive'}
                    color={user?.isActive ? 'success' : 'warning'}
                    variant="outlined"
                  />
                </Stack>
              </Stack>
            </Grid>

            <Grid item xs={12} md={8}>
              <Stack spacing={3}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Profile details
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">
                        First name
                      </Typography>
                      <Typography variant="body1">{user?.firstName || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">
                        Last name
                      </Typography>
                      <Typography variant="body1">{user?.lastName || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">
                        Account created
                      </Typography>
                      <Typography variant="body1">{formatDate(user?.createdAt || null)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">
                        Last active
                      </Typography>
                      <Typography variant="body1">
                        {formatDate(user?.lastLogin || null, 'No recent activity')}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Timezone Settings Card */}
      <Card sx={{ borderRadius: 1 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Time zone
          </Typography>

          {detectedTimezone && detectedTimezone !== user?.timezone && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Your browser timezone is detected as{' '}
              <strong>
                {COMMON_TIMEZONES.find((tz) => tz.value === detectedTimezone)?.label ||
                  detectedTimezone}
              </strong>
              . Consider updating your account timezone for accurate meeting times.
            </Alert>
          )}

          <Autocomplete<TimezoneOption, false, false, true>
            value={selectedTimezone}
            onChange={handleTimezoneChange}
            options={COMMON_TIMEZONES}
            getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
            renderOption={(props, option) => {
              const label =
                typeof option === 'string' ? String(option).replace(/_/g, ' ') : option.label;
              const offset = typeof option === 'string' ? getTimezoneOffset(String(option)) : option.offset;
              return (
                <Box component="li" {...props}>
                  <Box>
                    <Typography variant="body2">{label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {offset}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Select your timezone..."
                InputProps={{
                  ...params.InputProps,
                  startAdornment: <PublicIcon color="action" sx={{ mr: 1 }} />,
                }}
              />
            )}
            freeSolo
            sx={{ mb: 2, maxWidth: 450 }}
          />

          {selectedTimezone && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Current time in {selectedTimezone.label}:
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {currentTime}
              </Typography>
            </Box>
          )}

          {hasUnsavedChanges && (
            <Button
              variant="contained"
              startIcon={isLoading ? <CircularProgress size={16} /> : <CheckIcon />}
              onClick={handleSave}
              disabled={isLoading || !selectedTimezone}
            >
              {isLoading ? 'Saving...' : 'Save timezone'}
            </Button>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
