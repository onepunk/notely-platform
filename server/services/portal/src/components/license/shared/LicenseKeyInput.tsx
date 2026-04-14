/**
 * Formatted textarea for license key input
 */

import { TextField, IconButton, InputAdornment } from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import { useState } from 'react';
import toast from 'react-hot-toast';

interface LicenseKeyInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  readOnly?: boolean;
  error?: string;
  helperText?: string;
}

export function LicenseKeyInput({
  value,
  onChange,
  label = 'License Key',
  readOnly = false,
  error,
  helperText,
}: LicenseKeyInputProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('License key copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy license key');
    }
  };

  return (
    <TextField
      fullWidth
      multiline
      rows={6}
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      InputProps={{
        readOnly,
        sx: { fontFamily: 'monospace', fontSize: '0.875rem' },
        endAdornment: value && (
          <InputAdornment position="end">
            <IconButton
              onClick={handleCopy}
              edge="end"
              color={copied ? 'success' : 'default'}
            >
              <CopyIcon />
            </IconButton>
          </InputAdornment>
        ),
      }}
      error={!!error}
      helperText={error || helperText}
    />
  );
}
