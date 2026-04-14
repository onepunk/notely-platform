import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { CircularProgress, Container, Paper, Typography } from '@mui/material';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { completeOAuthLogin as fetchSession } from '@/lib/oauth/client';
import clientLogger from '@/lib/clientLogger';
import { sanitizeRedirectUrl } from '@/lib/urlSecurity';

function SpinnerMessage({ message }: { message: string }) {
  return (
    <Container
      maxWidth="sm"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}
    >
      <Paper elevation={3} sx={{ p: 6, borderRadius: 4, textAlign: 'center' }}>
        <CircularProgress size={48} />
        <Typography variant="h6" sx={{ mt: 3 }}>
          {message}
        </Typography>
      </Paper>
    </Container>
  );
}

/**
 * Redeem beta access token after successful OAuth login
 * Token is stored in sessionStorage by the login page when user arrives via beta invitation URL
 */
async function redeemBetaToken(token: string): Promise<boolean> {
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
      toast.success('Welcome to Notely Beta! Your Professional access is now active.');
      return true;
    } else {
      // Token invalid, expired, or email mismatch
      sessionStorage.removeItem('beta_access_token');
      const message = data.message || 'This beta invitation link is no longer valid.';
      clientLogger.warn('Beta token redemption failed', { error: data.error, message });
      toast.error(message);
      return false;
    }
  } catch (err) {
    sessionStorage.removeItem('beta_access_token');
    clientLogger.error('Beta token redemption error', { error: err });
    toast.error('Failed to activate beta access. Please try again.');
    return false;
  }
}

export default function OAuthCallbackPage() {
  const router = useRouter();
  const { completeOAuthLogin } = useAuth();
  const [statusMessage, setStatusMessage] = useState('Finishing sign-in…');

  const returnTo = useMemo(() => {
    // Support both 'redirect' and 'return_to' query parameters
    const redirectParam = router.query?.redirect || router.query?.return_to;
    return sanitizeRedirectUrl(redirectParam);
  }, [router.query?.redirect, router.query?.return_to]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    const { error, error_description: description } = router.query;

    // Check for OAuth errors from auth service
    if (error) {
      const message = Array.isArray(description) ? description[0] : description;
      toast.error(message || (Array.isArray(error) ? error[0] : error) || 'Sign-in cancelled');
      router.replace(`/login?redirect=${encodeURIComponent(returnTo)}`);
      return;
    }

    // With HTTP-only cookies, we don't need code/state here
    // Auth service already set the cookies during redirect
    // We just need to fetch the session to hydrate React state
    (async () => {
      try {
        setStatusMessage('Validating secure session…');

        // Fetch session from auth service (reads HTTP-only cookies server-side)
        const session = await fetchSession();

        if (!session?.user) {
          throw new Error('No user session found');
        }

        setStatusMessage('Loading your workspace…');

        // Update AuthContext with user data
        await completeOAuthLogin(session);

        // Check for beta access token in sessionStorage (from beta invitation flow)
        const betaToken = sessionStorage.getItem('beta_access_token');
        if (betaToken) {
          setStatusMessage('Activating beta access…');
          await redeemBetaToken(betaToken);
        }

        // Redirect to return_to destination
        router.replace(returnTo || '/');
      } catch (err: any) {
        const message = err?.message || 'Failed to complete sign-in';
        toast.error(message);
        router.replace(`/login?redirect=${encodeURIComponent(returnTo)}`);
      }
    })();
  }, [router, completeOAuthLogin, returnTo]);

  return <SpinnerMessage message={statusMessage} />;
}
