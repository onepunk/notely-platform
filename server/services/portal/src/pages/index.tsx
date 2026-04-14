import type { NextPage } from 'next';
import Head from 'next/head';
import { Grid } from '@mui/material';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import DownloadClientCard from '@/components/dashboard/DownloadClientCard';
import { ProductDashboardCard } from '@/components/dashboard/ProductDashboardCard';
import { useLicenseOverview } from '@/contexts/LicenseContext';

const DashboardPage: NextPage = () => {
  const {
    hasActiveCloudLicense,
    hasActiveAiLicense,
    betaStatus,
    refreshLicenses,
  } = useLicenseOverview();

  // A user has "access" if they have an active license OR a beta with invite_sent/converted status
  const cloudBeta = betaStatus.cloud;
  const aiBeta = betaStatus.ai;

  const hasCloudAccess = hasActiveCloudLicense ||
    cloudBeta?.status === 'invite_sent' ||
    cloudBeta?.status === 'converted';

  const hasAiAccess = hasActiveAiLicense ||
    aiBeta?.status === 'invite_sent' ||
    aiBeta?.status === 'converted';

  return (
    <>
      <Head>
        <title>Notely Portal · Unified Intelligence Dashboard</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Welcome back!"
          subtitle="A single hub for meetings, notes, and intelligence."
        >
          <Grid container spacing={3} alignItems="flex-start">
            {/* Notely Cloud */}
            <Grid item xs={12} md={6}>
              <ProductDashboardCard
                productName="Notely Cloud"
                product="cloud"
                description="Secure meeting capture, transcription, and note-taking for your desktop."
                hasAccess={hasCloudAccess}
                betaStatus={cloudBeta}
                onBetaRequested={refreshLicenses}
              >
                <DownloadClientCard />
              </ProductDashboardCard>
            </Grid>

            {/* Notely AI */}
            <Grid item xs={12} md={6}>
              <ProductDashboardCard
                productName="Notely AI"
                product="ai"
                description="AI-powered customer intelligence and meeting analytics."
                hasAccess={hasAiAccess}
                betaStatus={aiBeta}
                onBetaRequested={refreshLicenses}
              >
                <DownloadClientCard product="ai" />
              </ProductDashboardCard>
            </Grid>
          </Grid>
        </PageContainer>
      </MainLayout>
    </>
  );
};

export default DashboardPage;

// Server-side protection - redirect to login if not authenticated
// This is the landing page, so we redirect instead of returning 404
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { redirectTo: '/login', requiredPermission: 'dashboard:read' });
