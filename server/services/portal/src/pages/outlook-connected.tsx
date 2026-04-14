/**
 * OAuth Callback Success Page
 * Displayed after successful Microsoft Outlook calendar connection
 * Handles both popup and regular window flows
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  ErrorOutline as ErrorOutlineIcon,
} from '@mui/icons-material';
import MainLayout from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';

export default function OutlookConnectedPage() {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const { success, error } = router.query;
  const [isPopup, setIsPopup] = useState(false);

  // Determine connection state from query parameters
  const state = useMemo(() => {
    if (typeof success === 'string') return 'success';
    if (typeof error === 'string') return 'error';
    return 'unknown';
  }, [success, error]);

  const title = state === 'success'
    ? 'Microsoft Outlook Connected'
    : state === 'error'
      ? 'Microsoft Outlook Connection Failed'
      : 'Microsoft Outlook Status Unknown';

  const description = state === 'success'
    ? 'Your calendar is now connected. We will begin syncing meetings shortly.'
    : state === 'error'
      ? 'We were unable to complete the Microsoft Outlook authorization flow. Please try again or contact support.'
      : 'We could not determine the outcome of the Microsoft Outlook authorization flow.';

  const Icon = state === 'success' ? CheckCircleIcon : ErrorOutlineIcon;
  const iconColor = state === 'success' ? 'success.main' : 'error.main';

  // Handle popup window communication
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if this window was opened as a popup
    const popup = !!window.opener && !window.opener.closed;
    setIsPopup(popup);

    if (popup) {
      // Send result back to parent window via postMessage
      window.opener.postMessage(
        {
          type: 'outlook-connect-result',
          success: state === 'success',
          error: state === 'error' ? (typeof error === 'string' ? error : undefined) : undefined,
          forceRefresh: true,
        },
        window.location.origin
      );

      // Auto-close popup after 800ms
      const timer = window.setTimeout(() => {
        try {
          window.close();
        } catch (err) {
          // window.close may be blocked; ignore
        }
      }, 800);

      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [state, error]);

  // Refresh profile and redirect for non-popup flows
  useEffect(() => {
    if (isPopup) return; // Don't redirect if this is a popup

    if (state === 'success') {
      // Refresh user profile to update calendar connection status
      refreshProfile().catch(err => {
        console.error('Failed to refresh profile:', err);
      });

      // Redirect to settings/calendar tab after 2 seconds
      const timer = setTimeout(() => {
        router.push('/settings?tab=calendar');
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [state, isPopup, refreshProfile, router]);

  return (
    <>
      <Head>
        <title>{title} · Notely</title>
      </Head>

      <MainLayout>
        <Container maxWidth="sm">
          <Stack spacing={4} alignItems="center" mt={8}>
            <Card sx={{ width: '100%', borderRadius: 4 }}>
              <CardContent>
                <Stack spacing={2} alignItems="center" textAlign="center">
                  <Icon sx={{ fontSize: 64, color: iconColor }} />
                  <Typography variant="h5" fontWeight={700}>
                    {title}
                  </Typography>
                  <Typography variant="body1" color="text.secondary">
                    {description}
                  </Typography>
                  {!isPopup && state === 'success' && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                      Redirecting to settings...
                    </Typography>
                  )}
                  {!isPopup && state !== 'success' && (
                    <Box sx={{ mt: 2 }}>
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={() => router.push('/settings?tab=calendar')}
                      >
                        Go to Calendar Settings
                      </Button>
                    </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN]);
