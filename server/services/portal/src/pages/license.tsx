/**
 * User License Page — Dual-product license status view
 */

import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import {
  Grid,
  CircularProgress,
  Box,
} from '@mui/material';
import { useLicenseOverview } from '@/contexts/LicenseContext';
import { ProductLicenseCard } from '@/components/license/ProductLicenseCard';

export default function LicensePage() {
  const {
    cloudLicense,
    aiLicense,
    betaStatus,
    isLoading,
    refreshLicenses,
  } = useLicenseOverview();

  return (
    <>
      <Head>
        <title>License &middot; Notely</title>
      </Head>
      <MainLayout>
        <PageContainer title="License" subtitle="Your license status">
          {isLoading && (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          )}

          {!isLoading && (
            <Grid container spacing={3} alignItems="flex-start">
              {/* Cloud Card */}
              <Grid item xs={12} md={6}>
                <ProductLicenseCard
                  productName="Notely Cloud"
                  product="cloud"
                  license={cloudLicense}
                  betaStatus={betaStatus.cloud}
                  onBetaRequested={refreshLicenses}
                />
              </Grid>

              {/* AI Card */}
              <Grid item xs={12} md={6}>
                <ProductLicenseCard
                  productName="Notely AI"
                  product="ai"
                  license={aiLicense}
                  betaStatus={betaStatus.ai}
                  onBetaRequested={refreshLicenses}
                />
              </Grid>
            </Grid>
          )}
        </PageContainer>
      </MainLayout>
    </>
  );
}

export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { redirectTo: '/login', requiredPermission: 'license:read' });
