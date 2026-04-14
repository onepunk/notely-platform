/**
 * Warning banner for expiring licenses
 */

import { Alert, AlertTitle } from '@mui/material';
import type { License } from '@/types/license';

interface ExpiryWarningProps {
  license: License;
  warningThresholdDays?: number;
}

export function ExpiryWarning({ license, warningThresholdDays = 30 }: ExpiryWarningProps) {
  if (!license.expires_at || license.revoked_at) {
    return null;
  }

  const expiresAt = new Date(license.expires_at);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    return (
      <Alert severity="error">
        <AlertTitle>License Expired</AlertTitle>
        Your license expired on {expiresAt.toLocaleDateString()}. Please contact support to renew.
      </Alert>
    );
  }

  if (daysUntilExpiry <= warningThresholdDays) {
    const severity = daysUntilExpiry <= 7 ? 'error' : 'warning';

    return (
      <Alert severity={severity}>
        <AlertTitle>License Expiring Soon</AlertTitle>
        Your license will expire in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''} on{' '}
        {expiresAt.toLocaleDateString()}. Please renew to avoid service interruption.
      </Alert>
    );
  }

  return null;
}
