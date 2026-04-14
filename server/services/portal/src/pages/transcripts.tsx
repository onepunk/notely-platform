/**
 * Transcripts Page
 */

import Head from 'next/head';
import { Description as DescriptionIcon } from '@mui/icons-material';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import FeatureGate from '@/components/feature-gate/FeatureGate';

export default function TranscriptsPage() {
  return (
    <>
      <Head>
        <title>Transcripts · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer title="Transcripts" subtitle="Browse and search meeting transcripts">
          <FeatureGate
            featureKey="online-transcripts"
            isImplemented={false}
            placeholderTitle="Transcripts"
            placeholderDescription="Transcript management features are coming soon."
            placeholderIcon={<DescriptionIcon sx={{ fontSize: 40 }} />}
            featureName="Online Transcripts"
            upgradeDescription="Access and search your meeting transcripts from anywhere with our cloud-based transcript viewer."
            upgradeBenefits={[
              'View transcripts from all your meetings',
              'Full-text search across all transcripts',
              'AI-powered summaries and key points',
              'Export to multiple formats (PDF, DOCX, TXT)',
              'Speaker-labeled conversations'
            ]}
          >
            {/* TranscriptsList component will go here when implemented */}
            <div>Transcripts content</div>
          </FeatureGate>
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'transcripts:read' });
