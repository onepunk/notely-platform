/**
 * Admin Releases Page
 * Desktop client release management - upload, publish, and manage releases
 */

import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import ReleasesSettingsTab from '@/components/admin-settings/tabs/ReleasesSettingsTab';

export default function ReleasesPage() {
  return (
    <>
      <Head>
        <title>Releases · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Releases"
          subtitle="Desktop client release management - upload, publish, and version control"
        >
          <ReleasesSettingsTab />
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'releases:admin' });
