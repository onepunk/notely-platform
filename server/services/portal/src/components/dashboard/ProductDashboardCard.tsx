/**
 * Product Dashboard Card Component
 * Shows product info with access gating — downloads when user has access,
 * beta signup or status when they don't.
 */

import { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Box,
  Button,
  CircularProgress,
  Chip,
} from '@mui/material';
import {
  Science as ScienceIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { BetaSignupStatus } from '@/contexts/LicenseContext';

interface ProductDashboardCardProps {
  productName: string;
  product: 'cloud' | 'ai';
  description: string;
  hasAccess: boolean;
  comingSoon?: boolean;
  betaStatus: BetaSignupStatus | null;
  onBetaRequested?: () => void;
  children?: React.ReactNode;
}

export function ProductDashboardCard({
  productName,
  product,
  description,
  hasAccess,
  comingSoon,
  betaStatus,
  onBetaRequested,
  children,
}: ProductDashboardCardProps) {
  const { user } = useAuth();
  const [betaLoading, setBetaLoading] = useState(false);

  const handleRequestBeta = async () => {
    try {
      setBetaLoading(true);
      const response = await fetch('/api/support/beta/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          product,
          firstName: user?.firstName,
          lastName: user?.lastName,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast.success(data.message || 'Beta access granted! Check your email for details.');
        onBetaRequested?.();
      } else {
        toast.error(data.message || 'Failed to request beta access. Please try again.');
      }
    } catch {
      toast.error('Failed to request beta access. Please try again.');
    } finally {
      setBetaLoading(false);
    }
  };

  const hasPendingBeta = betaStatus &&
    (betaStatus.status === 'pending' || betaStatus.status === 'confirmed');

  return (
    <Card>
      <CardContent sx={{ py: 2.5 }}>
        <Stack spacing={2}>
          {/* Header */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {productName}
              </Typography>
              {comingSoon && (
                <Chip
                  label="Coming Soon"
                  size="small"
                  color="default"
                  sx={{ height: 20, fontSize: '0.7rem' }}
                />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          </Box>

          {/* Content area */}
          {hasAccess && !comingSoon && children}

          {/* Coming Soon state */}
          {comingSoon && (
            <Box
              sx={{
                py: 3,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
              }}
            >
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Downloads will be available here when this product launches.
              </Typography>
              {!betaStatus && (
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={handleRequestBeta}
                  disabled={betaLoading}
                  startIcon={betaLoading ? <CircularProgress size={16} /> : <ScienceIcon />}
                  size="small"
                >
                  Request Beta Access
                </Button>
              )}
              {hasPendingBeta && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ScheduleIcon sx={{ fontSize: 16, color: 'info.main' }} />
                  <Typography variant="body2" color="text.secondary">
                    Beta access requested — we&apos;ll notify you when you&apos;re invited.
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* No access, not coming soon — show beta signup or status */}
          {!hasAccess && !comingSoon && (
            <Box
              sx={{
                py: 2,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
              }}
            >
              {!betaStatus && (
                <>
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    Sign up for beta access to download.
                  </Typography>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={handleRequestBeta}
                    disabled={betaLoading}
                    startIcon={betaLoading ? <CircularProgress size={16} /> : <ScienceIcon />}
                    size="small"
                  >
                    Request Beta Access
                  </Button>
                </>
              )}
              {hasPendingBeta && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ScheduleIcon sx={{ fontSize: 16, color: 'info.main' }} />
                  <Typography variant="body2" color="text.secondary">
                    Beta access requested — we&apos;ll notify you when you&apos;re invited.
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default ProductDashboardCard;
