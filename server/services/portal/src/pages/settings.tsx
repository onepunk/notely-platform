/**
 * Settings Page
 * Unified settings interface with tabbed navigation
 */

import { useState, SyntheticEvent } from 'react';
import Head from 'next/head';
import { Box, Card, Tab, Tabs } from '@mui/material';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import {
  Person as PersonIcon,
  CalendarMonth as CalendarIcon,
  Notifications as NotificationsIcon,
} from '@mui/icons-material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import ProfileTab from '@/components/settings/tabs/ProfileTab';
import CalendarTab from '@/components/settings/tabs/CalendarTab';
import NotificationsTab from '@/components/settings/tabs/NotificationsTab';

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
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (event: SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <>
      <Head>
        <title>Settings · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Settings"
          subtitle="Manage your account, integrations, and preferences"
        >
          <Card sx={{ borderRadius: 1 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={activeTab}
                onChange={handleTabChange}
                aria-label="settings tabs"
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  icon={<PersonIcon />}
                  iconPosition="start"
                  label="Profile"
                  id="settings-tab-0"
                  aria-controls="settings-tabpanel-0"
                />
                <Tab
                  icon={<CalendarIcon />}
                  iconPosition="start"
                  label="Calendar"
                  id="settings-tab-1"
                  aria-controls="settings-tabpanel-1"
                />
                <Tab
                  icon={<NotificationsIcon />}
                  iconPosition="start"
                  label="Notifications"
                  id="settings-tab-2"
                  aria-controls="settings-tabpanel-2"
                />
              </Tabs>
            </Box>

            <Box sx={{ p: 3 }}>
              <TabPanel value={activeTab} index={0}>
                <ProfileTab />
              </TabPanel>
              <TabPanel value={activeTab} index={1}>
                <CalendarTab />
              </TabPanel>
              <TabPanel value={activeTab} index={2}>
                <NotificationsTab />
              </TabPanel>
            </Box>
          </Card>
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admin roles can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'settings:read' });
