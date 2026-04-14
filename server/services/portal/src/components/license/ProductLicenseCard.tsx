/**
 * Product License Card Component
 * Reusable card for displaying license status for a single product (Cloud or AI)
 */

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Stack,
  Typography,
  Button,
  Chip,
  TextField,
  IconButton,
  InputAdornment,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  ContentCopy as ContentCopyIcon,
  Science as ScienceIcon,
} from '@mui/icons-material';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import type { License } from '@/types/license';
import type { BetaSignupStatus } from '@/contexts/LicenseContext';

interface ProductLicenseCardProps {
  productName: string;
  product: 'cloud' | 'ai';
  license: (License & { status: string }) | null;
  betaStatus: BetaSignupStatus | null;
  onManageSubscription?: () => void;
  onBetaRequested?: () => void;
}

function getStatusChip(license: (License & { status: string }) | null): {
  label: string;
  color: 'success' | 'error' | 'default' | 'warning';
  icon: React.ReactNode;
} {
  if (!license) {
    return {
      label: 'Unlicensed',
      color: 'default',
      icon: null,
    };
  }

  if (license.status === 'active') {
    if (license.grant_type === 'beta') {
      return {
        label: 'Beta Active',
        color: 'success',
        icon: <CheckCircleIcon sx={{ fontSize: 16 }} />,
      };
    }
    return {
      label: 'Active',
      color: 'success',
      icon: <CheckCircleIcon sx={{ fontSize: 16 }} />,
    };
  }

  if (license.status === 'expired') {
    return {
      label: 'Expired',
      color: 'error',
      icon: <ErrorIcon sx={{ fontSize: 16 }} />,
    };
  }

  if (license.status === 'revoked') {
    return {
      label: 'Revoked',
      color: 'error',
      icon: <ErrorIcon sx={{ fontSize: 16 }} />,
    };
  }

  return {
    label: 'Unknown',
    color: 'default',
    icon: null,
  };
}

function getBetaStatusText(betaStatus: BetaSignupStatus): string {
  switch (betaStatus.status) {
    case 'pending':
    case 'confirmed':
      return 'Signed Up';
    case 'invite_sent':
      return 'Invited';
    case 'converted':
      return 'Activated';
    case 'unsubscribed':
      return 'Unsubscribed';
    default:
      return betaStatus.status;
  }
}

export function ProductLicenseCard({
  productName,
  product,
  license,
  betaStatus,
  onManageSubscription,
  onBetaRequested,
}: ProductLicenseCardProps) {
  const { user } = useAuth();
  const [betaLoading, setBetaLoading] = useState(false);
  const statusChip = getStatusChip(license);
  const isBeta = license?.grant_type === 'beta';

  const handleRequestBeta = async () => {
    if (!user) {
      toast.error('User information not available. Please try logging in again.');
      return;
    }

    try {
      setBetaLoading(true);
      const response = await fetch('/api/support/beta/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          termsAccepted: true,
          product,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast.success("Beta access requested! You'll receive a confirmation email shortly.");
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

  const renderActionButton = () => {
    if (!license) {
      return (
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
      );
    }

    const isActive = license.status === 'active';

    // Expired or revoked — show request beta access
    if (!isActive) {
      return (
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
      );
    }

    return null;
  };

  return (
    <Card sx={{ borderRadius: 1 }}>
      <CardContent sx={{ p: 3 }}>
        <Stack spacing={2.5}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6" fontWeight={600}>
              {productName}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {statusChip.icon}
              <Chip
                label={statusChip.label}
                color={statusChip.color}
                size="small"
                sx={{ fontWeight: 500 }}
              />
              {isBeta && license?.status === 'active' && (
                <Chip
                  label="Beta"
                  size="small"
                  color="info"
                  sx={{ height: 20, fontSize: '0.7rem' }}
                />
              )}
            </Box>
          </Box>

          {/* Beta Access Line */}
          {betaStatus && (
            <Box>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ letterSpacing: 1, fontSize: '0.7rem' }}
              >
                Beta Access
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                <ScheduleIcon sx={{ fontSize: 16, color: 'info.main' }} />
                <Typography variant="body2">
                  {getBetaStatusText(betaStatus)}
                </Typography>
              </Box>
              {betaStatus.status === 'invite_sent' && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Check your email for your beta access key. Be sure to check your spam folder.
                </Typography>
              )}
            </Box>
          )}

          {/* License Details (only if license exists) */}
          {license && (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 2,
                }}
              >
                {/* Plan */}
                <Box>
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ letterSpacing: 1, fontSize: '0.7rem' }}
                  >
                    Plan
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    {license.tier_name || 'Professional'}
                  </Typography>
                </Box>

                {/* Valid Period */}
                <Box>
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ letterSpacing: 1, fontSize: '0.7rem' }}
                  >
                    {isBeta ? 'Beta Expires' : 'Valid Until'}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 0.25,
                      color: isBeta ? 'warning.main' : 'text.primary',
                    }}
                  >
                    {license.expires_at
                      ? format(new Date(license.expires_at), 'MMM d, yyyy')
                      : 'N/A'}
                  </Typography>
                </Box>
              </Box>

              {/* License Key */}
              {license.license_key && (
                <Box>
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ letterSpacing: 1, fontSize: '0.7rem' }}
                  >
                    License Key
                  </Typography>
                  <TextField
                    value={license.license_key}
                    size="small"
                    fullWidth
                    slotProps={{
                      input: {
                        readOnly: true,
                        sx: { fontFamily: 'monospace', fontSize: '0.8rem' },
                        endAdornment: (
                          <InputAdornment position="end">
                            <Tooltip title="Copy to clipboard">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  navigator.clipboard.writeText(license.license_key);
                                  toast.success('License key copied to clipboard');
                                }}
                              >
                                <ContentCopyIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </InputAdornment>
                        ),
                      },
                    }}
                    sx={{ mt: 0.5 }}
                  />
                </Box>
              )}
            </>
          )}

          {/* Action Button */}
          <Box>
            {renderActionButton()}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default ProductLicenseCard;
