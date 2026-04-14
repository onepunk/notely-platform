/**
 * Insights Page
 */

import Head from 'next/head';
import { Lightbulb as LightbulbIcon } from '@mui/icons-material';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import FeatureGate from '@/components/feature-gate/FeatureGate';

export default function InsightsPage() {
  return (
    <>
      <Head>
        <title>Insights · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer title="Insights" subtitle="AI-powered meeting insights and analytics">
          <FeatureGate
            featureKey="gain-insights"
            isImplemented={false}
            placeholderTitle="Insights"
            placeholderDescription="AI insights and analytics are coming soon."
            placeholderIcon={<LightbulbIcon sx={{ fontSize: 40 }} />}
            featureName="AI Insights"
            upgradeDescription="Unlock powerful AI-driven insights from your meetings to improve productivity and decision-making."
            upgradeBenefits={[
              'Automatic action item extraction',
              'Meeting sentiment analysis',
              'Key topic identification',
              'Participation metrics',
              'Trend analysis across meetings'
            ]}
          >
            {/* InsightsContent component will go here when implemented */}
            <div>Insights content</div>
          </FeatureGate>
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'insights:read' });
