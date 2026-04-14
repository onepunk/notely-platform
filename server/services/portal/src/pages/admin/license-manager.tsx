/**
 * Admin License Manager Page - Full license CRUD
 */

import { useEffect, useState, SyntheticEvent } from 'react';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import {
  Button,
  Stack,
  CircularProgress,
  Alert,
  Box,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  Tabs,
  Tab,
  Grid,
} from '@mui/material';
import {
  Add as AddIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { useLicenseList } from '@/hooks/useLicenseList';
import { LicenseListTable } from '@/components/license/admin/LicenseListTable';
import { GenerateLicenseModal } from '@/components/license/admin/GenerateLicenseModal';
import FeatureTiersGrid from '@/components/license/admin/FeatureTiersGrid';
import type { License } from '@/types/license';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { LicenseStatusBadge } from '@/components/license/shared/LicenseStatusBadge';
import { apiRequest } from '@/utils/api';
import clientLogger from '@/lib/clientLogger';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`license-manager-tabpanel-${index}`}
      aria-labelledby={`license-manager-tab-${index}`}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

interface UserSummary {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export default function LicenseManagerPage() {
  const {
    licenses,
    features,
    total,
    isLoading,
    error,
    filters,
    pagination,
    setFilters,
    setPagination,
    refreshLicenses,
    revokeLicense,
  } = useLicenseList();

  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [selectedLicense, setSelectedLicense] = useState<License | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [detailLicense, setDetailLicense] = useState<License | null>(null);
  const [userDirectory, setUserDirectory] = useState<Record<string, UserSummary>>({});
  const [isUserDirectoryLoading, setIsUserDirectoryLoading] = useState(false);
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  useEffect(() => {
    let isMounted = true;

    const fetchUsers = async () => {
      setIsUserDirectoryLoading(true);
      try {
        const data = await apiRequest<UserSummary[] | { data: UserSummary[] }>(
          '/api/users?limit=1000'
        );
        const list = Array.isArray(data)
          ? data
          : Array.isArray((data as any)?.data)
          ? (data as any).data
          : [];

        if (!isMounted) {
          return;
        }

        const map: Record<string, UserSummary> = {};
        list.forEach((user) => {
          if (user?.id) {
            map[user.id] = user;
          }
        });
        setUserDirectory(map);
      } catch (error: any) {
        if (isMounted) {
          clientLogger.error('Failed to load user directory for license manager', {
            error: error?.message,
          });
        }
      } finally {
        if (isMounted) {
          setIsUserDirectoryLoading(false);
        }
      }
    };

    void fetchUsers();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleViewDetails = (license: License) => {
    setDetailLicense(license);
    setDetailsDialogOpen(true);
  };

  const handleCloseDetails = () => {
    setDetailsDialogOpen(false);
    setDetailLicense(null);
  };

  const handleRevokeClick = (license: License) => {
    setSelectedLicense(license);
    setRevokeDialogOpen(true);
  };

  const handleRevokeConfirm = async () => {
    if (!selectedLicense) return;

    try {
      setIsRevoking(true);
      await revokeLicense(selectedLicense.id, revokeReason);
      toast.success('License revoked successfully');
      setRevokeDialogOpen(false);
      setSelectedLicense(null);
      setRevokeReason('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to revoke license');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleCopyLicenseKey = async () => {
    if (!detailLicense) return;

    try {
      const key = detailLicense.license_key;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(key);
      } else if (typeof document !== 'undefined') {
        const tempInput = document.createElement('textarea');
        tempInput.value = key;
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.focus();
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }
      toast.success('License key copied to clipboard');
    } catch (copyError) {
      toast.error('Failed to copy license key');
    }
  };

  const formatDateTime = (value: string | null) => {
    if (!value) {
      return '—';
    }

    try {
      return format(new Date(value), 'PPpp');
    } catch (err) {
      return value;
    }
  };

  const formatListValue = (value?: string | null) => (value && value.trim().length > 0 ? value : '—');

  const tabDescriptions = [
    'View, generate, and revoke platform licenses',
    'Configure feature tiers and their associated capabilities',
  ];

  return (
    <>
      <Head>
        <title>License Manager · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="License Manager"
          subtitle="Generate and manage platform licenses and feature tiers"
          action={
            tabValue === 0 ? (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setGenerateModalOpen(true)}
              >
                Generate License
              </Button>
            ) : undefined
          }
        >
          <Card sx={{ borderRadius: 1 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs value={tabValue} onChange={handleTabChange} aria-label="license manager tabs">
                <Tab label="Licenses" />
                <Tab label="Feature Tiers" />
              </Tabs>
            </Box>

            {/* Tab Description */}
            <Box sx={{ p: 2, bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="body2" color="text.secondary">
                {tabDescriptions[tabValue]}
              </Typography>
            </Box>

            <Box sx={{ p: 3 }}>
              <TabPanel value={tabValue} index={0}>
                {isLoading && (
                  <Box display="flex" justifyContent="center" py={4}>
                    <CircularProgress size={24} />
                  </Box>
                )}

                {error && !isLoading && (
                  <Alert severity="error">{error}</Alert>
                )}

                {!isLoading && !error && (
                  <Card variant="outlined" sx={{ borderRadius: '6px' }}>
                    <LicenseListTable
                      licenses={licenses}
                      features={features}
                      total={total}
                      page={Math.floor(pagination.offset / pagination.limit)}
                      rowsPerPage={pagination.limit}
                      onPageChange={(page) => setPagination({ ...pagination, offset: page * pagination.limit })}
                      onRowsPerPageChange={(rowsPerPage) => setPagination({ limit: rowsPerPage, offset: 0 })}
                      onViewDetails={handleViewDetails}
                      onRevoke={handleRevokeClick}
                      filters={filters}
                      onFiltersChange={setFilters}
                      userDirectory={userDirectory}
                    />
                  </Card>
                )}
              </TabPanel>

              <TabPanel value={tabValue} index={1}>
                <FeatureTiersGrid />
              </TabPanel>
            </Box>
          </Card>
        </PageContainer>
      </MainLayout>

      <GenerateLicenseModal
        open={generateModalOpen}
        onClose={() => setGenerateModalOpen(false)}
        onSuccess={refreshLicenses}
        features={features}
      />

      <Dialog
        open={detailsDialogOpen}
        onClose={handleCloseDetails}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>License Details</DialogTitle>
        <DialogContent>
          {detailLicense && (
            <Box sx={{ pt: 1 }}>
              {/* License Key */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">License Key</Typography>
                <Box display="flex" gap={1} alignItems="center">
                  <TextField
                    fullWidth
                    size="small"
                    value={detailLicense.license_key}
                    InputProps={{ readOnly: true }}
                  />
                  <Tooltip title="Copy">
                    <IconButton size="small" onClick={handleCopyLicenseKey}>
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* Status Card */}
              <Card variant="outlined" sx={{ borderRadius: '6px', mb: 2 }}>
                <CardContent>
                  <Grid container spacing={1}>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Status</Typography>
                      <Box><LicenseStatusBadge license={detailLicense} size="small" /></Box>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Type</Typography>
                      <Typography variant="body2">
                        {detailLicense.license_type === 'portal' ? 'Enterprise (VM Appliance)' : detailLicense.license_type}
                      </Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Issued By</Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {detailLicense.issued_by?.slice(0, 8)}...
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

              {/* User & Org Card */}
              <Card variant="outlined" sx={{ borderRadius: '6px', mb: 2 }}>
                <CardContent>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">User</Typography>
                      {detailLicense.user_id ? (
                        <Typography variant="body2">
                          {userDirectory[detailLicense.user_id]?.email || (isUserDirectoryLoading ? 'Loading…' : '—')}
                        </Typography>
                      ) : (
                        <Typography variant="body2">—</Typography>
                      )}
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Organization</Typography>
                      <Typography variant="body2">{formatListValue(detailLicense.organization_id)}</Typography>
                    </Grid>
                    {detailLicense.hardware_id && (
                      <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary">Bound MAC Address</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {detailLicense.hardware_id}
                        </Typography>
                      </Grid>
                    )}
                  </Grid>
                </CardContent>
              </Card>

              {/* Dates Card */}
              <Card variant="outlined" sx={{ borderRadius: '6px', mb: 2 }}>
                <CardContent>
                  <Grid container spacing={1}>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Issued</Typography>
                      <Typography variant="body2">{formatDateTime(detailLicense.issued_at)}</Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Expires</Typography>
                      <Typography variant="body2">{formatDateTime(detailLicense.expires_at)}</Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Revoked</Typography>
                      <Typography variant="body2">{formatDateTime(detailLicense.revoked_at)}</Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

              {/* Features */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">Features</Typography>
                {detailLicense.features.length ? (
                  <Box display="flex" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                    {detailLicense.features.map((feature) => (
                      <Chip key={feature} label={feature} size="small" variant="outlined" />
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">None</Typography>
                )}
              </Box>

              {/* Notes */}
              {detailLicense.notes && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Notes</Typography>
                  <Typography variant="body2">{detailLicense.notes}</Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDetails} size="small">Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={revokeDialogOpen} onClose={() => setRevokeDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Revoke License</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning" sx={{ fontSize: '0.875rem' }}>
              This action cannot be undone.
            </Alert>
            <TextField
              label="Reason (Optional)"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              multiline
              rows={2}
              size="small"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeDialogOpen(false)} size="small">Cancel</Button>
          <Button
            onClick={handleRevokeConfirm}
            color="error"
            variant="contained"
            size="small"
            disabled={isRevoking}
          >
            {isRevoking ? 'Revoking...' : 'Revoke'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// Server-side protection - only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'licenses:admin' });
