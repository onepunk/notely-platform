/**
 * Admin Settings Page
 * System-wide administrative settings for the platform
 */

import { useState, SyntheticEvent } from 'react';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import { Box, Card, Tab, Tabs } from '@mui/material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import GeneralSettingsTab from '@/components/admin-settings/tabs/GeneralSettingsTab';
import AISettingsTab from '@/components/admin-settings/tabs/AISettingsTab';
import SecuritySettingsTab from '@/components/admin-settings/tabs/SecuritySettingsTab';
import TeamsSettingsTab from '@/components/admin-settings/tabs/TeamsSettingsTab';
import SyncSettingsTab from '@/components/admin-settings/tabs/SyncSettingsTab';
import LoggingSettingsTab from '@/components/admin-settings/tabs/LoggingSettingsTab';
import BackupSettingsTab from '@/components/admin-settings/tabs/BackupSettingsTab';
import NotificationSettingsTab from '@/components/admin-settings/tabs/NotificationSettingsTab';
import RecordingQuotasSettingsTab from '@/components/admin-settings/tabs/RecordingQuotasSettingsTab';
import BodySizeLimitSettingsTab from '@/components/admin-settings/tabs/BodySizeLimitSettingsTab';
import RateLimitSettingsTab from '@/components/admin-settings/tabs/RateLimitSettingsTab';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`admin-settings-tabpanel-${index}`}
      aria-labelledby={`admin-settings-tab-${index}`}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

const settingsTabs = [
  {
    label: 'General',
    component: GeneralSettingsTab,
    description: 'General system configuration including timeouts and session management',
  },
  {
    label: 'AI Services',
    component: AISettingsTab,
    description: 'Configure AI models, transcription, and summarization settings',
  },
  {
    label: 'Security',
    component: SecuritySettingsTab,
    description: 'Manage SSL certificates, authentication, and security policies',
  },
  {
    label: 'Notifications',
    component: NotificationSettingsTab,
    description: 'Configure email alerts for new user registrations',
  },
  {
    label: 'Teams',
    component: TeamsSettingsTab,
    description: 'Configure Microsoft Teams integration, bot settings, and auto-join',
  },
  {
    label: 'Sync',
    component: SyncSettingsTab,
    description: 'Configure sync system parameters, rate limits, and blob uploads',
  },
  {
    label: 'Logging',
    component: LoggingSettingsTab,
    description: 'Configure log collection, retention, and monitoring',
  },
  {
    label: 'Backup',
    component: BackupSettingsTab,
    description: 'Configure automated backups, retention, and recovery options',
  },
  {
    label: 'Recordings',
    component: RecordingQuotasSettingsTab,
    description: 'Configure tier-based upload quotas and retention policies for recordings',
  },
  {
    label: 'Body Size',
    component: BodySizeLimitSettingsTab,
    description: 'Configure request body size limits to prevent DoS attacks from oversized payloads',
  },
  {
    label: 'Rate Limit',
    component: RateLimitSettingsTab,
    description: 'Configure API rate limiting for gateway and authentication endpoints',
  },
];

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (event: SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const ActiveComponent = settingsTabs[activeTab].component;

  return (
    <>
      <Head>
        <title>Admin Settings · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Admin Settings"
          subtitle="System-wide configuration and preferences"
        >
          <Card sx={{ borderRadius: 1}}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={activeTab}
                onChange={handleTabChange}
                aria-label="admin settings tabs"
                variant="scrollable"
                scrollButtons="auto"
              >
                {settingsTabs.map((tab, index) => (
                  <Tab
                    key={index}
                    label={tab.label}
                    id={`admin-settings-tab-${index}`}
                    aria-controls={`admin-settings-tabpanel-${index}`}
                  />
                ))}
              </Tabs>
            </Box>

            {/* Tab Description */}
            <Box sx={{ p: 2, bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                {settingsTabs[activeTab].description}
              </Box>
            </Box>

            <Box sx={{ p: 3 }}>
              {settingsTabs.map((tab, index) => (
                <TabPanel key={index} value={activeTab} index={index}>
                  <ActiveComponent />
                </TabPanel>
              ))}
            </Box>
          </Card>
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'system:admin' });
