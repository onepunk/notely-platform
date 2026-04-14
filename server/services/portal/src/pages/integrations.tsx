/**
 * Integrations Page
 */

import Head from 'next/head';
import { Extension as ExtensionIcon } from '@mui/icons-material';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import PlaceholderPage from '@/components/common/PlaceholderPage';

export default function IntegrationsPage() {
  return (
    <>
      <Head>
        <title>Integrations · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer title="Integrations" subtitle="Connect with your favorite tools">
          <PlaceholderPage
            title="Integrations"
            description="Integration management features are coming soon."
            icon={<ExtensionIcon sx={{ fontSize: 40 }} />}
          />
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'integrations:read' });
