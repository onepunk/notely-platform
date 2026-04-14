/**
 * Observatory Page
 * Central hub for Grafana monitoring dashboards
 */

import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import {
  Box,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  Typography,
  Stack,
} from '@mui/material';
import {
  Monitor as SystemIcon,
  ViewInAr as DockerIcon,
  Memory as GpuIcon,
  Api as ApiIcon,
  Security as AuthIcon,
  Shield as GatewayIcon,
  Storage as DatabaseIcon,
  Cached as RedisIcon,
  Language as NginxIcon,
  Article as LogsIcon,
  OpenInNew as ExternalIcon,
} from '@mui/icons-material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';

// Grafana base URL - uses environment variable or defaults to localhost
const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3130';

interface DashboardLink {
  id: string;
  title: string;
  description: string;
  uid: string;
  icon: React.ReactNode;
  category: 'infrastructure' | 'services' | 'data' | 'observability';
}

const dashboards: DashboardLink[] = [
  // Infrastructure
  {
    id: 'system-health',
    title: 'System Health',
    description: 'CPU, memory, disk usage and system metrics',
    uid: 'notely-system-health',
    icon: <SystemIcon sx={{ fontSize: 40 }} />,
    category: 'infrastructure',
  },
  {
    id: 'docker',
    title: 'Docker Containers',
    description: 'Container resource usage and performance',
    uid: 'notely-docker',
    icon: <DockerIcon sx={{ fontSize: 40 }} />,
    category: 'infrastructure',
  },
  {
    id: 'gpu',
    title: 'GPU',
    description: 'NVIDIA GPU utilization and memory',
    uid: 'notely-gpu',
    icon: <GpuIcon sx={{ fontSize: 40 }} />,
    category: 'infrastructure',
  },
  // Services
  {
    id: 'api-endpoints',
    title: 'API Endpoints',
    description: 'API request rates, latency and errors',
    uid: 'notely-api-endpoints',
    icon: <ApiIcon sx={{ fontSize: 40 }} />,
    category: 'services',
  },
  {
    id: 'auth',
    title: 'Authentication',
    description: 'Auth service metrics and verification rates',
    uid: 'auth-health',
    icon: <AuthIcon sx={{ fontSize: 40 }} />,
    category: 'services',
  },
  {
    id: 'gateway-auth',
    title: 'Gateway Security',
    description: 'Gateway and auth security metrics',
    uid: 'notely-auth-gateway',
    icon: <GatewayIcon sx={{ fontSize: 40 }} />,
    category: 'services',
  },
  // Data
  {
    id: 'postgresql',
    title: 'PostgreSQL',
    description: 'Database connections, queries and performance',
    uid: 'postgresql-health',
    icon: <DatabaseIcon sx={{ fontSize: 40 }} />,
    category: 'data',
  },
  {
    id: 'redis',
    title: 'Redis',
    description: 'Cache hit rates, memory and connections',
    uid: 'redis-health',
    icon: <RedisIcon sx={{ fontSize: 40 }} />,
    category: 'data',
  },
  // Observability
  {
    id: 'nginx',
    title: 'Nginx',
    description: 'Reverse proxy metrics and request handling',
    uid: 'nginx-health',
    icon: <NginxIcon sx={{ fontSize: 40 }} />,
    category: 'observability',
  },
  {
    id: 'logging',
    title: 'Logs Overview',
    description: 'Centralized logging and log aggregation',
    uid: 'notely-logging-overview',
    icon: <LogsIcon sx={{ fontSize: 40 }} />,
    category: 'observability',
  },
];

const categoryLabels: Record<string, string> = {
  infrastructure: 'Infrastructure',
  services: 'Services',
  data: 'Data',
  observability: 'Observability',
};

function DashboardCard({ dashboard }: { dashboard: DashboardLink }) {
  const grafanaUrl = `${GRAFANA_URL}/d/${dashboard.uid}`;

  return (
    <Card
      sx={{
        height: '100%',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 4,
        },
      }}
    >
      <CardActionArea
        href={grafanaUrl}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ height: '100%' }}
      >
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
            <Box
              sx={{
                color: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {dashboard.icon}
            </Box>
            <ExternalIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          </Stack>

          <Typography variant="h6" component="h3" gutterBottom>
            {dashboard.title}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {dashboard.description}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function ObservatoryPage() {
  const categories = ['infrastructure', 'services', 'data', 'observability'];

  return (
    <>
      <Head>
        <title>Observatory · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Observatory"
          subtitle="Monitoring dashboards powered by Grafana"
        >
          {categories.map((category) => {
            const categoryDashboards = dashboards.filter((d) => d.category === category);

            return (
              <Box key={category} sx={{ mb: 4 }}>
                <Typography
                  variant="body2"
                  sx={{
                    mb: 2,
                    pb: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'text.secondary',
                  }}
                >
                  {categoryLabels[category]}
                </Typography>

                <Grid container spacing={3}>
                  {categoryDashboards.map((dashboard) => (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={dashboard.id}>
                      <DashboardCard dashboard={dashboard} />
                    </Grid>
                  ))}
                </Grid>
              </Box>
            );
          })}
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'system:performance' });
