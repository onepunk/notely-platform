/**
 * Main Layout wrapper with authentication check
 * Redirects to login if user is not authenticated
 */

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Box } from '@mui/material';
import TopBar from './TopBar';
import SideNav from './SideNav';
import { useAuth } from '@/contexts/AuthContext';
import { isAdmin as isAdminRole } from '@notely/shared/constants/roles';

type MainLayoutProps = {
  children: ReactNode;
};

const SIDEBAR_WIDTH = 72; // Icon-only width

const MainLayout = ({ children }: MainLayoutProps) => {
  const router = useRouter();
  const { isAuthenticated, isLoading, adminIpWhitelisted, user } = useAuth();

  // Redirect admin users to homepage if accessing admin pages from non-whitelisted IP
  useEffect(() => {
    if (!isLoading && isAuthenticated && router.pathname.startsWith('/admin')) {
      const isAdminUser = user?.role ? isAdminRole(user.role) : false;
      if (isAdminUser && adminIpWhitelisted === false) {
        router.push('/');
      }
    }
  }, [isLoading, isAuthenticated, adminIpWhitelisted, user, router]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          bgcolor: 'background.default',
        }}
      >
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </Box>
    );
  }

  // Don't render layout if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  // Don't render admin pages if IP is not whitelisted
  if (router.pathname.startsWith('/admin')) {
    const isAdminUser = user?.role ? isAdminRole(user.role) : false;
    if (isAdminUser && adminIpWhitelisted === false) {
      return null;
    }
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <SideNav />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          bgcolor: 'background.default',
        }}
      >
        <TopBar />
        <Box component="section" sx={{ p: { xs: 2, md: 3 } }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default MainLayout;
