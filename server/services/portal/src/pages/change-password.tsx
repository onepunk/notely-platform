/**
 * Force Password Change Page
 * Shown when user must change their password on first login
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import toast from 'react-hot-toast';
import clientLogger from '@/lib/clientLogger';
import { sanitizeRedirectUrl, createLoginRedirectUrl } from '@/lib/urlSecurity';
import PasswordRequirements, {
  isPasswordValid,
  PasswordComplexity,
} from '@/components/auth/PasswordRequirements';

const DEFAULT_REQUIREMENTS: PasswordComplexity = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
};

export default function ChangePasswordPage() {
  const router = useRouter();
  const { credentialId, returnTo } = router.query;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requirements, setRequirements] = useState<PasswordComplexity>(DEFAULT_REQUIREMENTS);

  // Fetch password requirements on mount
  useEffect(() => {
    async function fetchRequirements() {
      try {
        const response = await fetch('/api/auth/security-settings');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.passwordComplexity) {
            setRequirements(data.data.passwordComplexity);
          }
        }
      } catch (err) {
        clientLogger.error('Failed to fetch security settings', { error: err });
      }
    }
    fetchRequirements();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    // Validate password complexity
    if (!isPasswordValid(newPassword, requirements)) {
      setError('Password does not meet requirements');
      return;
    }

    setPending(true);

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          credentialId,
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || data.message || 'Failed to change password');
        return;
      }

      toast.success('Password changed successfully! Please sign in with your new password.');

      // Redirect to login page with sanitized return URL
      const safeReturnTo = sanitizeRedirectUrl(returnTo);
      router.push(createLoginRedirectUrl(safeReturnTo));
    } catch (err: any) {
      clientLogger.error('Password change failed', { error: err });
      setError(err?.message || 'An error occurred');
    } finally {
      setPending(false);
    }
  };

  // Redirect if no credentialId provided
  if (router.isReady && !credentialId) {
    router.replace('/login');
    return null;
  }

  return (
    <>
      <Head>
        <title>Change Password - Notely</title>
      </Head>
      <Container maxWidth="sm" sx={{ display: 'flex', alignItems: 'center', minHeight: '100vh' }}>
        <Paper elevation={4} sx={{ p: 5, width: '100%', borderRadius: 4 }}>
          <Stack spacing={3} alignItems="center">
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 72,
                height: 72,
                borderRadius: '50%',
                bgcolor: 'warning.main',
                color: 'warning.contrastText',
              }}
            >
              <LockIcon fontSize="large" />
            </Box>
            <Box textAlign="center">
              <Typography variant="h4" fontWeight={700} gutterBottom>
                Change Password
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Your password must be changed before continuing
              </Typography>
            </Box>
          </Stack>

          {error && (
            <Alert severity="error" sx={{ mt: 3 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 4 }}>
            <Stack spacing={3}>
              <TextField
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                fullWidth
                disabled={pending}
                autoFocus
              />
              <TextField
                label="New Password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                fullWidth
                disabled={pending}
              />

              <PasswordRequirements password={newPassword} requirements={requirements} />

              <TextField
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                fullWidth
                disabled={pending}
                error={confirmPassword.length > 0 && newPassword !== confirmPassword}
                helperText={
                  confirmPassword.length > 0 && newPassword !== confirmPassword
                    ? 'Passwords do not match'
                    : ''
                }
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={
                  pending ||
                  !currentPassword ||
                  !newPassword ||
                  !confirmPassword ||
                  newPassword !== confirmPassword ||
                  !isPasswordValid(newPassword, requirements)
                }
                startIcon={pending ? <CircularProgress size={20} /> : undefined}
              >
                {pending ? 'Changing Password...' : 'Change Password'}
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Container>
    </>
  );
}
