/**
 * Email Verification Page
 * Allows users to enter verification code sent to their email
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Container,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailReadOutlined';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { apiRequest } from '@/utils/api';

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);

  useEffect(() => {
    if (router.isReady && router.query.email) {
      setEmail(router.query.email as string);
    }
  }, [router.isReady, router.query.email]);

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email || !code) {
      setError('Email and verification code are required');
      return;
    }

    setPending(true);

    try {
      // Public endpoint - apiRequest will work without token
      const data = await apiRequest<{ message: string }>('/api/auth/verify-email', {
        method: 'POST',
        body: { email, code },
      });

      // Show the message from the API
      toast.success(data.message || 'Email verified successfully!');
      setVerificationSuccess(true);

      // Redirect to login after 5 seconds (longer to read pending approval message)
      setTimeout(() => {
        router.push('/login');
      }, 5000);
    } catch (err: any) {
      clientLogger.error('Verification error:', { error: err instanceof Error ? err.message : String(err) });
      setError(err.message || 'Verification failed');
      toast.error(err.message || 'Verification failed');
    } finally {
      setPending(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      toast.error('Please enter your email address');
      return;
    }

    setResendPending(true);
    setError(null);

    try {
      // Public endpoint - apiRequest will work without token
      await apiRequest('/api/auth/resend-verification', {
        method: 'POST',
        body: { email },
      });

      toast.success('Verification code sent! Please check your email.');
    } catch (err: any) {
      clientLogger.error('Resend error:', { error: err instanceof Error ? err.message : String(err) });
      setError(err.message || 'Failed to resend verification code');
      toast.error(err.message || 'Failed to resend verification code');
    } finally {
      setResendPending(false);
    }
  };

  if (verificationSuccess) {
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
              <MarkEmailReadIcon fontSize="large" />
            </Box>
            <Box textAlign="center">
              <Typography variant="h4" fontWeight={700} gutterBottom>
                Email Verified!
              </Typography>
              <Typography variant="body1" color="text.secondary" paragraph>
                Your email has been successfully verified.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Redirecting to login...
              </Typography>
            </Box>
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
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
            }}
          >
            <MarkEmailReadIcon fontSize="large" />
          </Box>
          <Box textAlign="center">
            <Typography variant="h4" fontWeight={700} gutterBottom>
              Verify Your Email
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Enter the 8-character code sent to your email
            </Typography>
          </Box>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mt: 3 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={handleVerify} sx={{ mt: 4 }}>
          <Stack spacing={3}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              disabled={pending}
            />
            <TextField
              label="Verification Code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXXXXXX"
              inputProps={{
                maxLength: 8,
                style: { textTransform: 'uppercase', letterSpacing: '0.1em' },
              }}
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
              {pending ? 'Verifying…' : 'Verify Email'}
            </Button>
          </Stack>
        </Box>

        <Box sx={{ mt: 3 }}>
          <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Didn't receive the code?
            </Typography>
            <Button
              variant="text"
              size="small"
              onClick={handleResend}
              disabled={resendPending || !email}
            >
              {resendPending ? 'Sending…' : 'Resend'}
            </Button>
          </Stack>
        </Box>

        <Box sx={{ mt: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Already verified?{' '}
            <Link href="/login" passHref legacyBehavior>
              <MuiLink sx={{ fontWeight: 600 }}>Sign in</MuiLink>
            </Link>
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
}
