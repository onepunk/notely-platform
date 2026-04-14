/**
 * Action Items Page
 */

import Head from 'next/head';
import { TaskAlt as TaskAltIcon } from '@mui/icons-material';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import PlaceholderPage from '@/components/common/PlaceholderPage';

export default function ActionsPage() {
  return (
    <>
      <Head>
        <title>Action Items · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer title="Action Items" subtitle="Track and manage action items">
          <PlaceholderPage
            title="Action Items"
            description="Action item tracking features are coming soon."
            icon={<TaskAltIcon sx={{ fontSize: 40 }} />}
          />
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'actions:read' });
