/**
 * Color-coded badge showing license status
 */

import { Chip } from '@mui/material';
import {
  CheckCircle as ActiveIcon,
  Cancel as RevokedIcon,
  Schedule as ExpiredIcon,
  HourglassEmpty as PendingIcon,
} from '@mui/icons-material';
import type { License } from '@/types/license';

interface LicenseStatusBadgeProps {
  license: License;
  size?: 'small' | 'medium';
}

export function LicenseStatusBadge({ license, size = 'medium' }: LicenseStatusBadgeProps) {
  const getStatus = (): 'active' | 'expired' | 'revoked' | 'pending' => {
    if (license.revoked_at) return 'revoked';

    const now = new Date();
    const expiresAt = license.expires_at ? new Date(license.expires_at) : null;

    if (expiresAt && expiresAt < now) return 'expired';

    return 'active';
  };

  const status = getStatus();

  const statusConfig = {
    active: {
      label: 'Active',
      color: 'success' as const,
      icon: <ActiveIcon />,
    },
    expired: {
      label: 'Expired',
      color: 'error' as const,
      icon: <ExpiredIcon />,
    },
    revoked: {
      label: 'Revoked',
      color: 'error' as const,
      icon: <RevokedIcon />,
    },
    pending: {
      label: 'Pending',
      color: 'warning' as const,
      icon: <PendingIcon />,
    },
  };

  const config = statusConfig[status];

  return (
    <Chip
      label={config.label}
      color={config.color}
      icon={config.icon}
      size={size}
    />
  );
}
