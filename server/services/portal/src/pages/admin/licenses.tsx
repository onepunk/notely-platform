/**
 * Admin Licenses Page - Enterprise VM Appliance license management
 */

import { useState } from 'react';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import {
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  VpnKey as VpnKeyIcon,
  CloudDownload as CloudDownloadIcon,
} from '@mui/icons-material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import {
  Stack,
  CircularProgress,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Divider,
} from '@mui/material';
import { useLicense } from '@/hooks/useLicense';
import { useLicenseList } from '@/hooks/useLicenseList';
import { PortalLicenseCard } from '@/components/license/admin/PortalLicenseCard';
import { UpdateLicenseModal } from '@/components/license/admin/UpdateLicenseModal';
import { ValidationHistoryPanel } from '@/components/license/admin/ValidationHistoryPanel';
import { ExpiryWarning } from '@/components/license/shared/ExpiryWarning';
import { licenseClient } from '@/lib/licenseClient';
import toast from 'react-hot-toast';

export default function LicensesPage() {
  const { license, isLoading, error, refreshLicense } = useLicense();
  const { features } = useLicenseList();
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

  const handleDownloadCertificate = async () => {
    try {
      const response = await licenseClient.getPublicKey();
      const blob = new Blob([response.public_key], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'notely-license-certificate.pem';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Certificate downloaded');
    } catch (err) {
      toast.error('Failed to download certificate');
    }
  };

  return (
    <>
      <Head>
        <title>Enterprise License · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer title="Enterprise License" subtitle="Manage your Enterprise VM Appliance license">
          <Stack spacing={3}>
            {isLoading && (
              <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress />
              </Box>
            )}

            {error && !isLoading && (
              <Alert severity="error">{error}</Alert>
            )}

            {!isLoading && !error && license && (
              <>
                <ExpiryWarning license={license} />

                <PortalLicenseCard
                  license={license}
                  features={features}
                  onUpdate={() => setUpdateModalOpen(true)}
                  actions={(
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        startIcon={<DownloadIcon />}
                        onClick={handleDownloadCertificate}
                      >
                        Download Certificate
                      </Button>
                      <Button
                        size="small"
                        startIcon={<RefreshIcon />}
                        onClick={() => setUpdateModalOpen(true)}
                      >
                        Update License
                      </Button>
                    </Stack>
                  )}
                />

                <ValidationHistoryPanel />
              </>
            )}

            {!isLoading && !error && !license && (
              <Stack spacing={2}>
                <Alert severity="warning">
                  No Enterprise license found. Enter a valid Enterprise license key to enable the VM appliance.
                </Alert>
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<VpnKeyIcon />}
                    onClick={() => setUpdateModalOpen(true)}
                  >
                    Apply License Key
                  </Button>
                </Box>
              </Stack>
            )}

            {/* Enterprise VM Appliance Download Section */}
            {!isLoading && !error && license && license.license_type === 'portal' && (
              <Card sx={{ mt: 3 }}>
                <CardContent>
                  <Stack spacing={2}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CloudDownloadIcon color="primary" />
                      <Typography variant="h6">VM Appliance Downloads</Typography>
                    </Box>

                    <Divider />

                    <Typography variant="body2" color="text.secondary">
                      Download the Notely Enterprise VM Appliance image for deployment to your virtualization platform.
                      Your license is bound to MAC address: <strong>{license.hardware_id || 'Not specified'}</strong>
                    </Typography>

                    <Alert severity="info" sx={{ mt: 1 }}>
                      The VM appliance is pre-configured with all Notely services. Deploy it to VMware, Hyper-V, or
                      KVM/QEMU environments. The appliance will only activate with your license-bound MAC address.
                    </Alert>

                    <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                      <Button
                        variant="contained"
                        startIcon={<DownloadIcon />}
                        disabled
                        title="Coming soon - Download QCOW2 for KVM/Proxmox"
                      >
                        Download QCOW2
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={<DownloadIcon />}
                        disabled
                        title="Coming soon - Download OVA for VMware"
                      >
                        Download OVA
                      </Button>
                    </Stack>

                    <Typography variant="caption" color="text.secondary">
                      Downloads will be available once the appliance build system is configured.
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Stack>
        </PageContainer>
      </MainLayout>

      <UpdateLicenseModal
        open={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        onSuccess={refreshLicense}
      />
    </>
  );
}

// Server-side protection - only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'licenses:read' });
