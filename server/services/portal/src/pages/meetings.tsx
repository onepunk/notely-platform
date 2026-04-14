/**
 * Meetings Page
 */

import Head from 'next/head';
import { EventNote as EventNoteIcon } from '@mui/icons-material';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import PlaceholderPage from '@/components/common/PlaceholderPage';

export default function MeetingsPage() {
  return (
    <>
      <Head>
        <title>Meetings · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer title="Meetings" subtitle="View and manage your meetings">
          <PlaceholderPage
            title="Meetings"
            description="Meeting management features are coming soon."
            icon={<EventNoteIcon sx={{ fontSize: 40 }} />}
          />
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'meetings:read' });
