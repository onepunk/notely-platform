/**
 * Password Requirements Component
 * Visual indicator showing password complexity requirements
 * Updates in real-time as user types
 */

import { Box, Typography, List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import { Check as CheckIcon, Close as CloseIcon } from '@mui/icons-material';

export interface PasswordComplexity {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

interface PasswordCheck {
  label: string;
  met: boolean;
  required: boolean;
}

interface PasswordRequirementsProps {
  password: string;
  requirements: PasswordComplexity;
  showTitle?: boolean;
}

export function validatePasswordChecks(
  password: string,
  requirements: PasswordComplexity
): PasswordCheck[] {
  const checks: PasswordCheck[] = [
    {
      label: `At least ${requirements.minLength} characters`,
      met: password.length >= requirements.minLength,
      required: true,
    },
    {
      label: 'One uppercase letter (A-Z)',
      met: /[A-Z]/.test(password),
      required: requirements.requireUppercase,
    },
    {
      label: 'One lowercase letter (a-z)',
      met: /[a-z]/.test(password),
      required: requirements.requireLowercase,
    },
    {
      label: 'One number (0-9)',
      met: /[0-9]/.test(password),
      required: requirements.requireNumbers,
    },
    {
      label: 'One special character (!@#$%^&*...)',
      met: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password),
      required: requirements.requireSpecialChars,
    },
  ];

  // Only return checks that are required
  return checks.filter((check) => check.required);
}

export function isPasswordValid(password: string, requirements: PasswordComplexity): boolean {
  const checks = validatePasswordChecks(password, requirements);
  return checks.every((check) => check.met);
}

export default function PasswordRequirements({
  password,
  requirements,
  showTitle = true,
}: PasswordRequirementsProps) {
  const checks = validatePasswordChecks(password, requirements);

  return (
    <Box sx={{ mt: 1 }}>
      {showTitle && (
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Password requirements:
        </Typography>
      )}
      <List dense disablePadding>
        {checks.map((check, index) => (
          <ListItem key={index} disableGutters sx={{ py: 0.25 }}>
            <ListItemIcon sx={{ minWidth: 28 }}>
              {check.met ? (
                <CheckIcon
                  fontSize="small"
                  sx={{ color: 'success.main' }}
                />
              ) : (
                <CloseIcon
                  fontSize="small"
                  sx={{ color: password.length > 0 ? 'error.main' : 'text.disabled' }}
                />
              )}
            </ListItemIcon>
            <ListItemText
              primary={check.label}
              primaryTypographyProps={{
                variant: 'body2',
                sx: {
                  textDecoration: check.met ? 'line-through' : 'none',
                  color: check.met ? 'text.secondary' : 'text.primary',
                },
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
