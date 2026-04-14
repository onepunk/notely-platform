/**
 * Registration Page
 * Allows new users to create an account with email verification
 * Supports beta token flow for invited beta users
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAddOutlined';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { apiRequest } from '@/utils/api';

interface BetaSignupInfo {
  signupId: string;
  email: string;
  firstName: string;
  lastName: string;
  expiresAt: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [betaToken, setBetaToken] = useState<string | null>(null);
  const [betaSignupInfo, setBetaSignupInfo] = useState<BetaSignupInfo | null>(null);
  const [validatingToken, setValidatingToken] = useState(false);

  // Extract and validate beta token from sessionStorage (secure flow)
  // Note: Beta tokens are stored in sessionStorage by the login page after secure retrieval
  // from HTTP-only cookies. We no longer accept tokens via URL parameters.
  useEffect(() => {
    if (!router.isReady) return;

    // Only read from sessionStorage (tokens are transferred securely via HTTP-only cookie flow)
    const token = sessionStorage.getItem('beta_access_token');

    if (token) {
      setBetaToken(token);

      // Validate the token and get beta signup info
      setValidatingToken(true);
      fetch('/api/support/beta/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success && data.data) {
            setBetaSignupInfo(data.data);
            // Pre-fill form with beta signup info
            setFormData((prev) => ({
              ...prev,
              email: data.data.email || '',
              firstName: data.data.firstName || '',
              lastName: data.data.lastName || '',
            }));
            clientLogger.info('Beta token validated for registration', { signupId: data.data.signupId });
          } else {
            clientLogger.warn('Invalid beta token', { error: data.error });
            toast.error(data.message || 'This beta invitation link is no longer valid');
            setBetaToken(null);
            sessionStorage.removeItem('beta_access_token');
          }
        })
        .catch((err) => {
          clientLogger.error('Failed to validate beta token', { error: err.message });
          setBetaToken(null);
          sessionStorage.removeItem('beta_access_token');
        })
        .finally(() => {
          setValidatingToken(false);
        });
    }
  }, [router.isReady]);

  const handleChange = (field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [field]: event.target.value });
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    // Validation
    if (!formData.email || !formData.password || !formData.firstName || !formData.lastName) {
      setError('All fields are required');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setPending(true);

    try {
      // Build registration payload
      const registrationPayload: Record<string, unknown> = {
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
      };

      // Include beta token if present (allows registration even if signups disabled)
      if (betaToken) {
        registrationPayload.betaToken = betaToken;
      }

      // Public endpoint - apiRequest will work without token
      const response = await apiRequest<{ success: boolean; user: { emailVerified?: boolean; betaRedeemed?: boolean } }>(
        '/api/auth/register',
        {
          method: 'POST',
          body: registrationPayload,
        }
      );

      // Clear the beta token from storage after successful registration
      if (betaToken) {
        sessionStorage.removeItem('beta_access_token');
      }

      // If beta registration with pre-verified email, redirect to login
      if (response?.user?.emailVerified) {
        router.push('/login');
        return;
      }

      toast.success('Registration successful! Please check your email.');
      setRegistrationSuccess(true);

      // Redirect to verify email page after 2 seconds
      setTimeout(() => {
        router.push(`/verify-email?email=${encodeURIComponent(formData.email)}`);
      }, 2000);
    } catch (err: any) {
      clientLogger.error('Registration error:', { error: err instanceof Error ? err.message : String(err) });
      setError(err.message || 'Registration failed');
      toast.error(err.message || 'Registration failed');
    } finally {
      setPending(false);
    }
  };

  if (registrationSuccess) {
    return (
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
                bgcolor: 'success.main',
                color: 'success.contrastText',
              }}
            >
              <PersonAddIcon fontSize="large" />
            </Box>
            <Box textAlign="center">
              <Typography variant="h4" fontWeight={700} gutterBottom>
                Check Your Email
              </Typography>
              <Typography variant="body1" color="text.secondary" paragraph>
                We've sent a verification code to <strong>{formData.email}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Redirecting to verification page...
              </Typography>
            </Box>
          </Stack>
        </Paper>
      </Container>
    );
  }

  // Show loading state while validating beta token
  if (validatingToken) {
    return (
      <Container maxWidth="sm" sx={{ display: 'flex', alignItems: 'center', minHeight: '100vh' }}>
        <Paper elevation={4} sx={{ p: 5, width: '100%', borderRadius: 4 }}>
          <Stack spacing={3} alignItems="center">
            <CircularProgress size={48} />
            <Typography variant="body1" color="text.secondary">
              Validating your beta invitation...
            </Typography>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
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
              bgcolor: betaSignupInfo ? 'success.main' : 'primary.main',
              color: betaSignupInfo ? 'success.contrastText' : 'primary.contrastText',
            }}
          >
            <PersonAddIcon fontSize="large" />
          </Box>
          <Box textAlign="center">
            <Typography variant="h4" fontWeight={700} gutterBottom>
              {betaSignupInfo ? 'Welcome to Notely Beta!' : 'Create Account'}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {betaSignupInfo
                ? 'Complete your registration to activate your beta access'
                : 'Sign up to get started with Notely'}
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
            <Stack direction="row" spacing={2}>
              <TextField
                label="First Name"
                value={formData.firstName}
                onChange={handleChange('firstName')}
                required
                fullWidth
                disabled={pending}
              />
              <TextField
                label="Last Name"
                value={formData.lastName}
                onChange={handleChange('lastName')}
                required
                fullWidth
                disabled={pending}
              />
            </Stack>
            <TextField
              label="Email"
              type="email"
              value={formData.email}
              onChange={handleChange('email')}
              autoComplete="username"
              required
              fullWidth
              disabled={pending || !!betaSignupInfo}
              helperText={betaSignupInfo ? 'Email is pre-filled from your beta invitation' : undefined}
              InputProps={{
                readOnly: !!betaSignupInfo,
              }}
            />
            <TextField
              label="Password"
              type="password"
              value={formData.password}
              onChange={handleChange('password')}
              autoComplete="new-password"
              helperText="Minimum 8 characters"
              required
              fullWidth
              disabled={pending}
            />
            <TextField
              label="Confirm Password"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange('confirmPassword')}
              autoComplete="new-password"
              required
              fullWidth
              disabled={pending}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={pending}
            >
              {pending ? 'Creating Account…' : 'Create Account'}
            </Button>
          </Stack>
        </Box>

        <Box sx={{ mt: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Already have an account?{' '}
            <Link href="/login" passHref legacyBehavior>
              <MuiLink sx={{ fontWeight: 600 }}>Sign in</MuiLink>
            </Link>
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
}
