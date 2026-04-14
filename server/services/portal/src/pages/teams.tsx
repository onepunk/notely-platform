/**
 * Teams Page
 */

import Head from 'next/head';
import { PeopleAlt as PeopleAltIcon } from '@mui/icons-material';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import PlaceholderPage from '@/components/common/PlaceholderPage';

export default function TeamsPage() {
  return (
    <>
      <Head>
        <title>Teams · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer title="Teams" subtitle="Manage your teams and collaboration">
          <PlaceholderPage
            title="Teams"
            description="Team management features are coming soon."
            icon={<PeopleAltIcon sx={{ fontSize: 40 }} />}
          />
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'teams:read' });
