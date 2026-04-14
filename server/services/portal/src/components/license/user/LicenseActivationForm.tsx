/**
 * Form for activating a new license key
 */

import { useState } from 'react';
import { Card, CardContent, Stack, Typography, Button, Alert } from '@mui/material';
import { LicenseKeyInput } from '../shared/LicenseKeyInput';

interface LicenseActivationFormProps {
  onActivate: (licenseKey: string) => Promise<void>;
}

export function LicenseActivationForm({ onActivate }: LicenseActivationFormProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!licenseKey.trim()) {
      setError('Please enter a license key');
      return;
    }

    try {
      setIsActivating(true);
      setError(null);
      await onActivate(licenseKey.trim());
      setLicenseKey('');
    } catch (err: any) {
      setError(err.message || 'Failed to activate license');
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            <Typography variant="h5">Activate License</Typography>

            <Alert severity="info">
              Enter your license key below to activate your Notely license. The key will be validated
              and your account will be updated with the new license features.
            </Alert>

            <LicenseKeyInput
              value={licenseKey}
              onChange={setLicenseKey}
              label="License Key"
              helperText="Paste your license key here"
              error={error || undefined}
            />

            <Button
              type="submit"
              variant="contained"
              disabled={isActivating || !licenseKey.trim()}
              fullWidth
            >
              {isActivating ? 'Activating...' : 'Activate License'}
            </Button>
          </Stack>
        </form>
      </CardContent>
    </Card>
  );
}
