/**
 * Table displaying all licenses with actions
 */

import { useState } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Select,
  FormControl,
  InputLabel,
  Typography,
} from '@mui/material';
import { MoreVert as MoreIcon } from '@mui/icons-material';
import type { License, FeatureDefinition } from '@/types/license';
import { format } from 'date-fns';

interface UserSummary {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface LicenseListTableProps {
  licenses: License[];
  features: FeatureDefinition[];
  total: number;
  page: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  onViewDetails: (license: License) => void;
  onRevoke: (license: License) => void;
  filters: {
    license_type?: string;
    status?: string;
  };
  onFiltersChange: (filters: Record<string, string | undefined>) => void;
  userDirectory?: Record<string, UserSummary>;
}

/**
 * Get display name for license type
 */
function getLicenseTypeDisplay(licenseType: string): string {
  switch (licenseType) {
    case 'portal':
      return 'Enterprise';
    case 'desktop':
      return 'Desktop';
    case 'notely-ai':
      return 'Desktop AI';
    default:
      return licenseType;
  }
}

/**
 * Get tier display name from license
 * Prefers tier_name/tier_key if available, falls back to feature-based detection
 */
function getTierDisplay(license: License): string {
  // Notely AI licenses always show "Notely AI" tier (full access)
  if (license.license_type === 'notely-ai') {
    return 'Notely AI';
  }

  // Prefer tier_name if available (actual tier from database)
  if (license.tier_name) {
    return license.tier_name;
  }

  // Fall back to tier_key with proper casing
  if (license.tier_key) {
    return license.tier_key.charAt(0).toUpperCase() + license.tier_key.slice(1);
  }

  // Legacy: derive tier from features
  const features = license.features || [];

  // Check for enterprise-level features
  if (features.some(f => ['api-access', 'sso-integration', 'audit-logging'].includes(f))) {
    return 'Enterprise';
  }
  // Check for professional-level features
  if (features.some(f => ['ai-summarisation', 'ai-summary', 'online-transcripts', 'gain-insights', 'upload-recordings'].includes(f))) {
    return 'Professional';
  }
  // Check for starter-level features
  if (features.some(f => ['cross-device-sync', 'online-backup'].includes(f))) {
    return 'Starter';
  }
  // Default to free
  return 'Free';
}

/**
 * Get grant type suffix for display
 */
function getGrantTypeSuffix(grantType?: string): string {
  switch (grantType) {
    case 'beta':
      return ' (Beta)';
    case 'trial':
      return ' (Trial)';
    case 'promotional':
      return ' (Promo)';
    case 'admin_grant':
      return ' (Granted)';
    default:
      return '';
  }
}

/**
 * Get status text from license
 */
function getStatusText(license: License): string {
  if (license.revoked_at) {
    return 'Revoked';
  }
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return 'Expired';
  }
  return 'Active';
}

export function LicenseListTable({
  licenses,
  total,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  onViewDetails,
  onRevoke,
  filters,
  onFiltersChange,
  userDirectory = {},
}: LicenseListTableProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedLicense, setSelectedLicense] = useState<License | null>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, license: License) => {
    setAnchorEl(event.currentTarget);
    setSelectedLicense(license);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedLicense(null);
  };

  const handleAction = (action: 'view' | 'revoke') => {
    if (!selectedLicense) return;

    if (action === 'view') {
      onViewDetails(selectedLicense);
    } else if (action === 'revoke') {
      onRevoke(selectedLicense);
    }

    handleMenuClose();
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ pt: 2, pb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>License Type</InputLabel>
          <Select
            value={filters.license_type || ''}
            label="License Type"
            onChange={(e) => onFiltersChange({ ...filters, license_type: e.target.value || undefined })}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="portal">Enterprise</MenuItem>
            <MenuItem value="desktop">Desktop</MenuItem>
            <MenuItem value="notely-ai">Desktop AI</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={filters.status || 'active'}
            label="Status"
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value || undefined })}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="expired">Expired</MenuItem>
            <MenuItem value="revoked">Revoked</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Tier</TableCell>
              <TableCell>Issued Date</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {licenses.map((license) => {
              const user = license.user_id ? userDirectory[license.user_id] : null;
              const statusText = getStatusText(license);
              const tierDisplay = getTierDisplay(license) + getGrantTypeSuffix(license.grant_type);

              return (
                <TableRow key={license.id}>
                  <TableCell>
                    <Typography variant="body2">{statusText}</Typography>
                  </TableCell>
                  <TableCell>{getLicenseTypeDisplay(license.license_type)}</TableCell>
                  <TableCell>
                    {license.user_email || user?.email || '—'}
                  </TableCell>
                  <TableCell>{tierDisplay}</TableCell>
                  <TableCell>{format(new Date(license.issued_at), 'PP')}</TableCell>
                  <TableCell>
                    {license.expires_at ? format(new Date(license.expires_at), 'PP') : 'Never'}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(e, license)}
                    >
                      <MoreIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => onPageChange(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => onRowsPerPageChange(parseInt(e.target.value, 10))}
        />
      </TableContainer>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => handleAction('view')}>View Details</MenuItem>
        <MenuItem onClick={() => handleAction('revoke')} disabled={selectedLicense?.revoked_at !== null}>
          Revoke License
        </MenuItem>
      </Menu>
    </Box>
  );
}
