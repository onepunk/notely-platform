/**
 * Services Management Page
 * Provides status and control for all system services
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import clientLogger from '@/lib/clientLogger';
import {
  Box,
  Grid,
  Button,
  Stack,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  PlayCircleFilled as StartAllIcon,
  StopCircle as StopAllIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Memory as MemoryIcon,
} from '@mui/icons-material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import ServiceStatusCard from '@/components/services/ServiceStatusCard';
import ServicesTable from '@/components/services/ServicesTable';
import { DockerServiceInfo, dockerService } from '@/services/dockerService';
import toast from 'react-hot-toast';

export default function ServicesPage() {
  const [services, setServices] = useState<DockerServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkActionLoading, setBulkActionLoading] = useState<'start-all' | 'stop-all' | null>(
    null
  );
  const fetchServiceStatus = async () => {
    setLoading(true);
    try {
      const dockerServices = await dockerService.getServiceStatus();

      // Sort services alphabetically by display name
      const sortedServices = [...dockerServices].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
      );

      setServices(sortedServices);
    } catch (error: any) {
      clientLogger.error('Failed to fetch service status:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to fetch service status');
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkAction = async (action: 'start-all' | 'stop-all') => {
    setBulkActionLoading(action);
    try {
      const actionType = action === 'start-all' ? 'start' : 'stop';
      const loadingToast = toast.loading(
        `${actionType === 'start' ? 'Starting' : 'Stopping'} all services...`
      );

      let result;
      if (action === 'start-all') {
        result = await dockerService.startAllServices();
      } else {
        result = await dockerService.stopAllServices();
      }

      toast.dismiss(loadingToast);

      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message || `Failed to ${actionType} all services`);
      }

      // Always refresh service status after bulk action
      await fetchServiceStatus();
    } catch (error: any) {
      clientLogger.error(`Failed to ${action} services:`, { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || `Failed to ${action.replace('-', ' ')} services`);
    } finally {
      setBulkActionLoading(null);
    }
  };

  useEffect(() => {
    fetchServiceStatus();
    const interval = setInterval(fetchServiceStatus, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Calculate service statistics
  const runningServices = services.filter((s) => s.status === 'running').length;
  const healthyServices = services.filter((s) => s.health === 'healthy').length;
  const errorServices = services.filter(
    (s) =>
      s.status === 'error' ||
      s.status === 'stopped' ||
      s.status === 'restarting' ||
      s.health === 'unhealthy'
  ).length;

  return (
    <>
      <Head>
        <title>Services · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Services"
          subtitle="Manage and monitor all system services"
          action={
            <Tooltip title="Refresh">
              <IconButton onClick={fetchServiceStatus} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          }
        >
          {/* Bulk Actions */}
          <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                variant="contained"
                color="success"
                startIcon={<StartAllIcon />}
                onClick={() => handleBulkAction('start-all')}
                disabled={loading || bulkActionLoading !== null}
                sx={{ minWidth: 120 }}
              >
                {bulkActionLoading === 'start-all' ? 'Starting...' : 'Start All'}
              </Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<StopAllIcon />}
                onClick={() => handleBulkAction('stop-all')}
                disabled={loading || bulkActionLoading !== null}
                sx={{ minWidth: 120 }}
              >
                {bulkActionLoading === 'stop-all' ? 'Stopping...' : 'Stop All'}
              </Button>
            </Stack>
          </Box>

          {/* Service Overview Cards */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid item xs={12} sm={6} md={3}>
              <ServiceStatusCard
                icon={<CheckCircleIcon />}
                value={runningServices}
                label="Running Services"
                color="success"
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <ServiceStatusCard
                icon={<CheckCircleIcon />}
                value={healthyServices}
                label="Healthy Services"
                color="info"
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <ServiceStatusCard
                icon={<ErrorIcon />}
                value={errorServices}
                label="Issues Detected"
                color="error"
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <ServiceStatusCard
                icon={<MemoryIcon />}
                value={services.length}
                label="Total Services"
                color="warning"
              />
            </Grid>
          </Grid>

          {/* Services Table */}
          <ServicesTable
            services={services}
            loading={loading}
            onRefresh={fetchServiceStatus}
          />
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'services:read' });
