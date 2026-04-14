/**
 * Unified Portal Login Page
 * Supports both local email/password and OAuth (OIDC) authentication
 * Local login can be disabled via admin settings
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LockIcon from '@mui/icons-material/LockOutlined';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { startMicrosoftLogin } from '@/lib/oauth/client';
import { sanitizeRedirectUrl } from '@/lib/urlSecurity';

interface SecuritySettings {
  localLoginEnabled: boolean;
  passwordComplexity: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
  };
}

interface SignupPolicy {
  signupsEnabled: boolean;
  requireEmailVerification: boolean;
}

function getStringParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default function LoginPage() {
  const router = useRouter();
  const { completePasswordSession, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingFlow, setPendingFlow] = useState<'password' | 'oidc' | null>(null);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [signupPolicy, setSignupPolicy] = useState<SignupPolicy | null>(null);
  const [betaToken, setBetaToken] = useState<string | null>(null);
  const [betaTokenHandled, setBetaTokenHandled] = useState(false);
  const [betaTokenError, setBetaTokenError] = useState<string | null>(null);
  const [betaTokenProcessing, setBetaTokenProcessing] = useState(false);

  const returnTo = useMemo(() => {
    const redirectParam = router?.query?.redirect || router?.query?.return_to;

    if (redirectParam) {
      return sanitizeRedirectUrl(redirectParam);
    }

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') || params.get('return_to');
      return sanitizeRedirectUrl(redirect);
    }

    return '/';
  }, [router.query?.redirect, router.query?.return_to]);

  // Handle authenticated users - if they have a beta token, try to redeem it first
  useEffect(() => {
    if (!isAuthenticated || !router.isReady) return;

    // Check for beta token in URL or sessionStorage
    const urlToken = getStringParam(router.query?.beta_token);
    const storedToken = typeof window !== 'undefined' ? sessionStorage.getItem('beta_access_token') : null;
    const tokenToRedeem = urlToken || storedToken;

    if (tokenToRedeem && !betaTokenHandled) {
      // Authenticated user with a beta token - attempt to redeem before redirecting
      setBetaTokenHandled(true);
      setBetaTokenProcessing(true);

      // Remove token from URL if present
      if (urlToken) {
        const { beta_token, ...restQuery } = router.query;
        router.replace(
          { pathname: router.pathname, query: restQuery },
          undefined,
          { shallow: true }
        );
      }

      // Attempt redemption
      (async () => {
        try {
          const response = await fetch('/api/support/beta/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ token: tokenToRedeem }),
          });

          const data = await response.json();

          if (response.ok && data.success) {
            sessionStorage.removeItem('beta_access_token');
            setBetaTokenProcessing(false);
            toast.success('Welcome to Notely Beta! Your Professional access is now active.');
            router.push(returnTo);
          } else {
            sessionStorage.removeItem('beta_access_token');
            setBetaTokenProcessing(false);
            // Show specific error based on response
            if (data.error === 'token_already_used') {
              setBetaTokenError('This beta invitation link has already been used.');
            } else if (data.error === 'token_expired') {
              setBetaTokenError('This beta invitation link has expired.');
            } else if (data.error === 'email_mismatch') {
              setBetaTokenError(data.message || 'This invitation was sent to a different email address.');
            } else if (data.error === 'token_not_found' || data.error === 'invalid_or_expired_token') {
              setBetaTokenError('This beta invitation link is no longer valid.');
            } else {
              setBetaTokenError(data.message || 'This beta invitation link is no longer valid.');
            }
            clientLogger.warn('Beta token redemption failed for authenticated user', { error: data.error });
          }
        } catch (err) {
          sessionStorage.removeItem('beta_access_token');
          setBetaTokenProcessing(false);
          setBetaTokenError('Failed to process beta invitation. Please try again.');
          clientLogger.error('Beta token redemption error for authenticated user', { error: err });
        }
      })();
    } else if (!tokenToRedeem) {
      // No beta token, just redirect
      router.push(returnTo);
    }
    // If betaTokenHandled is true and we have an error, stay on page to show error
  }, [isAuthenticated, router.isReady, router.query, betaTokenHandled, returnTo, router]);

  // Fetch security settings and signup policy on mount
  useEffect(() => {
    async function fetchSecuritySettings() {
      try {
        const response = await fetch('/api/auth/security-settings');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            setSecuritySettings(data.data);
          }
        }
      } catch (err) {
        clientLogger.error('Failed to fetch security settings', { error: err });
      } finally {
        setSettingsLoading(false);
      }
    }

    async function fetchSignupPolicy() {
      try {
        const response = await fetch('/api/public/config/signup-policy');
        if (response.ok) {
          const data = await response.json();
          setSignupPolicy(data);
        }
      } catch (err) {
        clientLogger.error('Failed to fetch signup policy', { error: err });
      }
    }

    fetchSecuritySettings();
    fetchSignupPolicy();
  }, []);

  // Retrieve beta token from secure cookie (for beta invitation flow)
  // This is triggered when user arrives via /api/portal/beta/init redirect
  useEffect(() => {
    if (!router.isReady) return;

    // Check if we arrived via secure beta token flow (beta=true indicates redirect from /api/portal/beta/init)
    const betaParam = getStringParam(router.query?.beta);
    const betaError = getStringParam(router.query?.beta_error);

    // Handle beta errors from the init endpoint
    if (betaError) {
      const errorMessages: Record<string, string> = {
        invalid_token: 'This beta invitation link is invalid.',
        token_not_found: 'This beta invitation link was not found.',
        token_already_used: 'This beta invitation link has already been used.',
        token_expired: 'This beta invitation link has expired.',
        server_error: 'An error occurred processing your invitation. Please try again.'
      };
      setBetaTokenError(errorMessages[betaError] || 'This beta invitation link is no longer valid.');

      // Clean up URL
      const { beta_error, ...restQuery } = router.query;
      router.replace(
        { pathname: router.pathname, query: restQuery },
        undefined,
        { shallow: true }
      );
      return;
    }

    // If beta=true, retrieve token from secure HTTP-only cookie via API
    if (betaParam === 'true') {
      (async () => {
        try {
          const response = await fetch('/api/portal/beta/token', {
            credentials: 'include'
          });
          const data = await response.json();

          if (data.success && data.token) {
            // Store token in sessionStorage for the existing login flow
            sessionStorage.setItem('beta_access_token', data.token);
            setBetaToken(data.token);
            clientLogger.info('Beta access token retrieved from secure cookie');
          }
        } catch (err) {
          clientLogger.error('Failed to retrieve beta token from secure cookie', { error: err });
        }

        // Clean up URL (remove beta=true)
        const { beta, ...restQuery } = router.query;
        router.replace(
          { pathname: router.pathname, query: restQuery },
          undefined,
          { shallow: true }
        );
      })();
    } else {
      // Check if beta_token is directly in the URL (e.g. /login?beta_token=xxx for unauthenticated users)
      const urlBetaToken = getStringParam(router.query?.beta_token);
      if (urlBetaToken) {
        sessionStorage.setItem('beta_access_token', urlBetaToken);
        router.replace('/register');
      } else {
        // Check if we have a stored token from a previous page load (backward compatibility)
        const storedToken = sessionStorage.getItem('beta_access_token');
        if (storedToken) {
          setBetaToken(storedToken);
        }
      }
    }
  }, [router.isReady, router.query, router.pathname]);

  // Handle error query params
  useEffect(() => {
    if (!router.isReady) return;

    const errorParam =
      getStringParam(router.query?.error) || getStringParam(router.query?.interaction_error);
    const descriptionParam =
      getStringParam(router.query?.error_description) ||
      getStringParam(router.query?.interaction_error_description);

    if (errorParam || descriptionParam) {
      const message = descriptionParam || errorParam || 'Unable to sign in';
      setError(message);
    }
  }, [router.isReady, router.query]);

  // Redeem beta access token after successful login
  const redeemBetaToken = async (token: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/support/beta/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Clear the stored token
        sessionStorage.removeItem('beta_access_token');
        setBetaToken(null);
        toast.success('Welcome to Notely Beta! Your Professional access is now active.');
        return true;
      } else {
        // Token invalid, expired, or email mismatch
        sessionStorage.removeItem('beta_access_token');
        setBetaToken(null);
        const message = data.message || 'This beta invitation link is no longer valid.';
        clientLogger.warn('Beta token redemption failed', { error: data.error, message });
        toast.error(message);
        return false;
      }
    } catch (err) {
      sessionStorage.removeItem('beta_access_token');
      setBetaToken(null);
      clientLogger.error('Beta token redemption error', { error: err });
      toast.error('Failed to activate beta access. Please try again.');
      return false;
    }
  };

  const handleEmailLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    setPendingFlow('password');

    try {
      // Call API directly to get mustChangePassword flag
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
          return;
        }
        const message = data.message || data.error || 'Login failed';
        setError(message);
        return;
      }

      // Check if password change is required
      if (data.data?.mustChangePassword) {
        const credentialId = data.data?.user?.credentialId;
        const redirectUrl = `/change-password?credentialId=${credentialId}&returnTo=${encodeURIComponent(returnTo)}`;
        router.push(redirectUrl);
        return;
      }

      // Complete the session - the login API already set the HTTP-only cookie,
      // so we just need to load the profile and update AuthContext state
      await completePasswordSession(data.data?.expiresAt);

      // If we have a beta token, attempt to redeem it after successful login
      const storedBetaToken = sessionStorage.getItem('beta_access_token') || betaToken;
      if (storedBetaToken) {
        await redeemBetaToken(storedBetaToken);
      }

      router.push(returnTo);
    } catch (loginError: any) {
      const message = loginError?.message || 'Login failed';
      setError(message);
    } finally {
      setPending(false);
      setPendingFlow(null);
    }
  };

  const handleOAuth2Login = async () => {
    try {
      setError(null);
      setPending(true);
      setPendingFlow('oidc');
      toast('Redirecting to Microsoft...');

      // Pass beta token to OAuth flow if available (for beta invite users)
      const storedBetaToken = sessionStorage.getItem('beta_access_token') || betaToken;
      startMicrosoftLogin(returnTo, storedBetaToken || undefined);
    } catch (oauthError: any) {
      clientLogger.error('OAuth2 sign-in failed:', oauthError);
      const message = oauthError?.message || 'Sign-in failed';
      setError(message);
      toast.error(message);
      setPending(false);
      setPendingFlow(null);
    }
  };

  // Determine what to show based on security settings
  const showLocalLogin = settingsLoading || securitySettings?.localLoginEnabled !== false;
  const showMicrosoftLogin = true; // Always show Microsoft login

  return (
    <>
      <Head>
        <title>Sign In - Notely</title>
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
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              <LockIcon fontSize="large" />
            </Box>
            <Box textAlign="center">
              <Typography variant="h4" fontWeight={700} gutterBottom>
                Notely Portal
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Sign in to access your dashboard
              </Typography>
            </Box>
          </Stack>

          {error && (
            <Alert severity="error" sx={{ mt: 3 }}>
              {error}
            </Alert>
          )}

          {betaTokenProcessing && isAuthenticated && (
            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <CircularProgress size={24} sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary">
                Processing your beta invitation...
              </Typography>
            </Box>
          )}

          {betaTokenError && isAuthenticated && !betaTokenProcessing && (
            <Box sx={{ mt: 3 }}>
              <Alert severity="warning" sx={{ mb: 2 }}>
                {betaTokenError}
              </Alert>
              <Button
                variant="contained"
                fullWidth
                onClick={() => router.push('/')}
              >
                Continue to Portal
              </Button>
            </Box>
          )}

          {!error && !betaTokenError && pendingFlow === 'oidc' && (
            <Alert severity="info" sx={{ mt: 3 }}>
              Redirecting to Microsoft for secure sign-in. This window will refresh when authentication completes.
            </Alert>
          )}

          {/* Hide login form when processing or showing beta token error to authenticated user */}
          {(betaTokenError || betaTokenProcessing) && isAuthenticated ? null : settingsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              {showLocalLogin && (
                <>
                  <Box component="form" onSubmit={handleEmailLogin} sx={{ mt: 4 }}>
                    <Stack spacing={3}>
                      <TextField
                        label="Email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="username"
                        required
                        fullWidth
                        disabled={pending}
                      />
                      <TextField
                        label="Password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                        required
                        fullWidth
                        disabled={pending}
                      />
                      <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        fullWidth
                        disabled={pending || !email || !password}
                      >
                        {pending && pendingFlow === 'password' ? 'Signing in...' : 'Sign in'}
                      </Button>
                    </Stack>
                  </Box>

                  {showMicrosoftLogin && (
                    <Divider sx={{ my: 3 }}>or continue with</Divider>
                  )}
                </>
              )}

              {showMicrosoftLogin && (
                <Button
                  variant="contained"
                  fullWidth
                  size="large"
                  startIcon={
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-grid',
                        gridTemplateColumns: 'repeat(2, 6px)',
                        gridTemplateRows: 'repeat(2, 6px)',
                        gap: '2px',
                      }}
                    >
                      <Box component="span" sx={{ width: 6, height: 6, backgroundColor: '#F35325' }} />
                      <Box component="span" sx={{ width: 6, height: 6, backgroundColor: '#81BC06' }} />
                      <Box component="span" sx={{ width: 6, height: 6, backgroundColor: '#05A6F0' }} />
                      <Box component="span" sx={{ width: 6, height: 6, backgroundColor: '#FFBA08' }} />
                    </Box>
                  }
                  onClick={handleOAuth2Login}
                  disabled={pending}
                  sx={{
                    mt: showLocalLogin ? 0 : 4,
                    backgroundColor: '#2F2F2F',
                    color: '#FFFFFF',
                    '&:hover': {
                      backgroundColor: '#1F1F1F',
                    },
                    '&:disabled': {
                      backgroundColor: '#E0E0E0',
                      color: '#9E9E9E',
                    },
                  }}
                >
                  {pending && pendingFlow === 'oidc' ? 'Redirecting to Microsoft...' : 'Sign in with Microsoft'}
                </Button>
              )}

              {!showLocalLogin && !showMicrosoftLogin && (
                <Alert severity="warning" sx={{ mt: 3 }}>
                  No login methods are currently enabled. Please contact your administrator.
                </Alert>
              )}
            </>
          )}

          {/* Show signup section based on signup policy */}
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            {betaToken || signupPolicy?.signupsEnabled !== false ? (
              <Typography variant="body2" color="text.secondary">
                Don't have an account?{' '}
                <Link
                  href="/register"
                  passHref
                  legacyBehavior
                >
                  <MuiLink sx={{ fontWeight: 600 }}>Create account</MuiLink>
                </Link>
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Sign ups are currently disabled.{' '}
                <MuiLink
                  href="https://yourdomain.com/#join-beta"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ fontWeight: 600 }}
                >
                  Sign up for the beta
                </MuiLink>
              </Typography>
            )}
          </Box>
        </Paper>
      </Container>
    </>
  );
}
