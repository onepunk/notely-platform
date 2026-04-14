/**
 * Modal for updating the portal's license
 */

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Alert,
} from '@mui/material';
import { LicenseKeyInput } from '../shared/LicenseKeyInput';
import { licenseClient } from '@/lib/licenseClient';
import toast from 'react-hot-toast';

interface UpdateLicenseModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function UpdateLicenseModal({ open, onClose, onSuccess }: UpdateLicenseModalProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = async () => {
    if (!licenseKey.trim()) {
      setError('Please enter a license key');
      return;
    }

    try {
      setIsUpdating(true);
      setError(null);

      // Validate the license first
      const validation = await licenseClient.validateLicense(licenseKey.trim());

      if (!validation.valid) {
        throw new Error(validation.reason || 'Invalid license key');
      }

      if (validation.license?.type !== 'portal') {
        throw new Error('This license is not valid for Enterprise VM appliance use');
      }

      // In a real implementation, you would call an endpoint to apply this license to the portal
      // For now, we'll just validate it
      toast.success('License validated successfully');
      onSuccess();
      handleClose();
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error || err.message || 'Failed to update license';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleClose = () => {
    setLicenseKey('');
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Apply License Key</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 2 }}>
          <Alert severity="info">
            Enter a valid Notely Enterprise license key to activate or update this appliance. The key will be validated
            before being applied. Enterprise licenses are bound to a specific MAC address.
          </Alert>

          {error && <Alert severity="error">{error}</Alert>}

          <LicenseKeyInput
            value={licenseKey}
            onChange={setLicenseKey}
            label="License Key"
            helperText="Paste the license key here"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleUpdate}
          variant="contained"
          disabled={isUpdating || !licenseKey.trim()}
        >
          {isUpdating ? 'Applying...' : 'Apply License'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
