/**
 * Modal for generating new licenses
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  FormHelperText,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { licenseClient } from '@/lib/licenseClient';
import { LicenseKeyInput } from '../shared/LicenseKeyInput';
import type { FeatureDefinition, TierType, LicenseTerm, LicenseType } from '@/types/license';
import toast from 'react-hot-toast';
import { apiRequest } from '@/utils/api';
import clientLogger from '@/lib/clientLogger';

interface GenerateLicenseModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  features: FeatureDefinition[];
}

const TIER_FEATURES: Record<TierType, string[]> = {
  free: ['basic_meetings', 'basic_transcription'],
  starter: ['basic_meetings', 'basic_transcription', 'calendar_sync', 'basic_ai'],
  professional: ['basic_meetings', 'basic_transcription', 'calendar_sync', 'basic_ai', 'advanced_ai', 'teams_integration'],
  enterprise: ['basic_meetings', 'basic_transcription', 'calendar_sync', 'basic_ai', 'advanced_ai', 'teams_integration', 'sso', 'audit_logs'],
};

/**
 * Product type display labels - maps internal types to user-friendly names
 * 'portal' is displayed as 'Enterprise' because portal licenses are used for
 * enterprise VM appliance deployments with MAC address binding
 */
const PRODUCT_TYPE_LABELS: Record<LicenseType, { label: string; description: string }> = {
  portal: {
    label: 'Enterprise (VM Appliance)',
    description: 'For enterprise VM appliance deployments. Requires MAC address binding.',
  },
  desktop: {
    label: 'Desktop',
    description: 'For individual desktop client installations.',
  },
  'notely-ai': {
    label: 'Notely AI (Standalone)',
    description: 'Perpetual license for Notely AI standalone desktop client. Full feature access with email-bound activation.',
  },
};

/**
 * Validates MAC address format (XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX)
 */
function isValidMacAddress(mac: string): boolean {
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  return macRegex.test(mac.trim());
}

interface UserSummary {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export function GenerateLicenseModal({ open, onClose, onSuccess, features: _features }: GenerateLicenseModalProps) {
  const [productType, setProductType] = useState<LicenseType>('portal');
  const [licenseTerm, setLicenseTerm] = useState<LicenseTerm>('perpetual');
  const [tier, setTier] = useState<TierType>('professional');
  const [organizationId, setOrganizationId] = useState('');
  const [userId, setUserId] = useState('');
  const [hardwareId, setHardwareId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  // Notely AI activation fields
  const [activationLimit, setActivationLimit] = useState<number>(1);
  const [noExpiration, setNoExpiration] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    const fetchUsers = async () => {
      if (!open || users.length > 0) return;

      setIsLoadingUsers(true);
      try {
        const data = await apiRequest<UserSummary[] | { data: UserSummary[] }>(
          '/api/users?limit=500'
        );
        const normalizedUsers = Array.isArray(data)
          ? data
          : Array.isArray((data as any)?.data)
          ? (data as any).data
          : [];

        if (isMounted) {
          setUsers(normalizedUsers);
        }
      } catch (fetchError: any) {
        if (isMounted) {
          clientLogger.error('Failed to load users for license generation', {
            error: fetchError?.message,
          });
          toast.error(fetchError?.message || 'Failed to load users');
        }
      } finally {
        if (isMounted) {
          setIsLoadingUsers(false);
        }
      }
    };

    fetchUsers();

    return () => {
      isMounted = false;
    };
  }, [open, users.length]);

  const handleGenerate = async () => {
    const trimmedOrgId = organizationId.trim();
    const trimmedHardwareId = hardwareId.trim();

    if (!userId.trim()) {
      const message = 'Please select a user to assign the license to';
      setError(message);
      toast.error(message);
      return;
    }

    if (productType === 'portal' && !trimmedOrgId) {
      const message = 'Organization ID is required for Enterprise licenses';
      setError(message);
      toast.error(message);
      return;
    }

    // Enterprise (portal) licenses REQUIRE MAC address binding
    if (productType === 'portal' && !trimmedHardwareId) {
      const message = 'MAC address is required for Enterprise licenses';
      setError(message);
      toast.error(message);
      return;
    }

    // Validate MAC address format if provided (not applicable for notely-ai)
    if (productType !== 'notely-ai' && trimmedHardwareId && !isValidMacAddress(trimmedHardwareId)) {
      const message = 'Invalid MAC address format. Use XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX';
      setError(message);
      toast.error(message);
      return;
    }

    // Validate notely-ai activation fields
    if (productType === 'notely-ai') {
      if (activationLimit < 1 || activationLimit > 100) {
        const message = 'Activation limit must be between 1 and 100';
        setError(message);
        toast.error(message);
        return;
      }
    }

    if (licenseTerm !== 'perpetual' && !expiresAt) {
      const message = 'Subscription and trial licenses require an expiration date';
      setError(message);
      toast.error(message);
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);

      // For notely-ai, always use enterprise tier (unlocks all features)
      const effectiveTier = productType === 'notely-ai' ? 'enterprise' : tier;

      const featureFlags = TIER_FEATURES[effectiveTier].reduce<Record<string, boolean>>((acc, feature) => {
        acc[feature] = true;
        return acc;
      }, {});

      // For notely-ai with noExpiration, don't set an expiration date
      const shouldHaveNoExpiration = productType === 'notely-ai' && noExpiration;
      const expiresAtIso = shouldHaveNoExpiration ? undefined : (expiresAt ? new Date(expiresAt).toISOString() : undefined);

      const generateRequest: Parameters<typeof licenseClient.generateLicense>[0] = {
        productType,
        type: licenseTerm,
        tier: effectiveTier,
        organizationId:
          productType === 'portal'
            ? trimmedOrgId
            : productType === 'notely-ai'
            ? undefined  // Never send org ID for notely-ai
            : trimmedOrgId || undefined,
        userId: userId.trim(),
        expiresAt: expiresAtIso,
        hardwareId: productType !== 'notely-ai' ? (hardwareId.trim() || undefined) : undefined,
        features: featureFlags,
        limits: {},
        notes: notes || undefined,
      };

      // Add notely-ai activation fields (only activation limit needed for perpetual)
      if (productType === 'notely-ai') {
        generateRequest.activationLimit = activationLimit;
      }

      const response = await licenseClient.generateLicense(generateRequest);

      setGeneratedKey(response.licenseKey);
      toast.success('License generated successfully');
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error || err.message || 'Failed to generate license';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    if (generatedKey) {
      onSuccess();
    }
    setProductType('portal');
    setLicenseTerm('perpetual');
    setTier('professional');
    setOrganizationId('');
    setUserId('');
    setHardwareId('');
    setExpiresAt('');
    setNotes('');
    setGeneratedKey(null);
    setError(null);
    // Reset notely-ai activation fields
    setActivationLimit(1);
    setNoExpiration(true);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Generate New License</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {generatedKey ? (
            <>
              <Alert severity="success">
                License generated successfully! Copy the license key below and provide it to the customer.
              </Alert>
              <LicenseKeyInput
                value={generatedKey}
                onChange={() => {}}
                label="Generated License Key"
                readOnly
              />
            </>
          ) : (
            <>
              <FormControl fullWidth>
                <InputLabel>Product Type</InputLabel>
                <Select
                  value={productType}
                  label="Product Type"
                  onChange={(e) => setProductType(e.target.value as LicenseType)}
                >
                  <MenuItem value="portal">{PRODUCT_TYPE_LABELS.portal.label}</MenuItem>
                  <MenuItem value="desktop">{PRODUCT_TYPE_LABELS.desktop.label}</MenuItem>
                  <MenuItem value="notely-ai">{PRODUCT_TYPE_LABELS['notely-ai'].label}</MenuItem>
                </Select>
                <FormHelperText>
                  {PRODUCT_TYPE_LABELS[productType].description}
                </FormHelperText>
              </FormControl>

              {/* License Term - hidden for notely-ai (always perpetual) */}
              {productType !== 'notely-ai' && (
                <FormControl fullWidth>
                  <InputLabel>License Term</InputLabel>
                  <Select
                    value={licenseTerm}
                    label="License Term"
                    onChange={(e) => setLicenseTerm(e.target.value as LicenseTerm)}
                  >
                    <MenuItem value="perpetual">Perpetual</MenuItem>
                    <MenuItem value="subscription">Subscription</MenuItem>
                    <MenuItem value="trial">Trial</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Tier selection - hidden for notely-ai (always uses full access) */}
              {productType !== 'notely-ai' && (
                <FormControl fullWidth>
                  <InputLabel>Tier</InputLabel>
                  <Select
                    value={tier}
                    label="Tier"
                    onChange={(e) => setTier(e.target.value as TierType)}
                  >
                    <MenuItem value="free">Free</MenuItem>
                    <MenuItem value="starter">Starter</MenuItem>
                    <MenuItem value="professional">Professional</MenuItem>
                    <MenuItem value="enterprise">Enterprise</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Organization ID - hidden for notely-ai (not applicable) */}
              {productType !== 'notely-ai' && (
                <TextField
                  label="Organization ID"
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  helperText={productType === 'portal'
                    ? 'Enter a unique identifier for the organization (e.g., company name or customer ID)'
                    : 'Optional for desktop licenses'}
                  required={productType === 'portal'}
                />
              )}

              <FormControl fullWidth required>
                <InputLabel>User</InputLabel>
                <Select
                  value={userId}
                  label="User"
                  onChange={(e) => setUserId(e.target.value)}
                  disabled={isLoadingUsers || users.length === 0}
                >
                  {users.map((user) => {
                    const fullName = [user.firstName, user.lastName]
                      .filter(Boolean)
                      .join(' ')
                      .trim();
                    const label = fullName ? `${fullName} (${user.email})` : user.email;
                    return (
                      <MenuItem key={user.id} value={user.id}>
                        {label}
                      </MenuItem>
                    );
                  })}
                </Select>
                <FormHelperText>
                  {isLoadingUsers
                    ? 'Loading users...'
                    : users.length > 0
                    ? 'Select the user the license should belong to'
                    : 'No users available. Create a user first.'}
                </FormHelperText>
              </FormControl>

              {/* Hardware ID not applicable for notely-ai (uses email-bound activation) */}
              {productType !== 'notely-ai' && (
                <TextField
                  label={productType === 'portal' ? 'MAC Address' : 'Hardware ID (Optional)'}
                  value={hardwareId}
                  onChange={(e) => setHardwareId(e.target.value.toUpperCase())}
                  helperText={productType === 'portal'
                    ? 'Required. Enter the appliance MAC address (e.g., 00:1A:2B:3C:4D:5E). The license will only work on this device.'
                    : 'Optional. Bind the license to a specific device.'}
                  required={productType === 'portal'}
                  placeholder={productType === 'portal' ? '00:1A:2B:3C:4D:5E' : ''}
                  error={productType === 'portal' && hardwareId.trim() !== '' && !isValidMacAddress(hardwareId)}
                />
              )}

              {/* Notely AI activation settings */}
              {productType === 'notely-ai' && (
                <>
                  <TextField
                    label="Activation Limit"
                    type="number"
                    value={activationLimit}
                    onChange={(e) => setActivationLimit(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                    helperText="Maximum number of devices this license can be activated on (1-100)"
                    inputProps={{ min: 1, max: 100 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={noExpiration}
                        onChange={(e) => setNoExpiration(e.target.checked)}
                      />
                    }
                    label="No expiration (perpetual license)"
                  />
                </>
              )}

              {/* Expiration date - hidden for notely-ai perpetual licenses */}
              {!(productType === 'notely-ai' && noExpiration) && (
                <TextField
                  label="Expiration Date (Optional)"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  helperText={licenseTerm === 'perpetual'
                    ? 'Leave empty for perpetual license'
                    : 'Required for subscription and trial licenses'}
                  required={licenseTerm !== 'perpetual'}
                />
              )}

              <TextField
                label="Notes (Optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                multiline
                rows={2}
                helperText="Internal notes about this license"
              />

              <Alert severity="info">
                {productType === 'portal' ? (
                  <>
                    This will generate an <strong>Enterprise</strong> license ({tier} tier) bound to MAC address{' '}
                    {hardwareId.trim() || '(not specified)'}. The license will only work on the device with this MAC address.
                    <br /><br />
                    Features: {TIER_FEATURES[tier].join(', ')}
                  </>
                ) : productType === 'notely-ai' ? (
                  <>
                    This will generate a <strong>Notely AI</strong> perpetual license with full access to all features.
                    <br /><br />
                    <strong>Activation:</strong> {activationLimit} device(s) max, email-bound activation.
                    {noExpiration ? (
                      <><br /><strong>Expiration:</strong> Never (perpetual)</>
                    ) : expiresAt ? (
                      <><br /><strong>Expiration:</strong> {new Date(expiresAt).toLocaleDateString()}</>
                    ) : null}
                  </>
                ) : (
                  <>
                    This will generate a {tier} tier desktop license with the following features:{' '}
                    {TIER_FEATURES[tier].join(', ')}
                  </>
                )}
              </Alert>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          {generatedKey ? 'Close' : 'Cancel'}
        </Button>
        {!generatedKey && (
          <Button
            onClick={handleGenerate}
            variant="contained"
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Generate License'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
