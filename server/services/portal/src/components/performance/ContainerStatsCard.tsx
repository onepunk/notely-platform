/**
 * Container Stats Card Component
 * Displays Docker container performance metrics (Mantis theme style)
 */

import {
  Card,
  CardContent,
  Stack,
  Box,
  Typography,
  LinearProgress,
  Skeleton,
} from '@mui/material';
import {
  Api as ApiIcon,
  Storage as StorageIcon,
  CloudQueue as RedisIcon,
  Psychology as PsychologyIcon,
  CalendarMonth as CalendarIcon,
  Email as EmailIcon,
  Videocam as GpuIcon,
  Thermostat as TempIcon,
} from '@mui/icons-material';
import { DockerContainerStats } from '@/services/performanceService';

interface ContainerStatsCardProps {
  container?: DockerContainerStats;
  serviceName: string;
  displayName: string;
  icon?: string;
  loading?: boolean;
  error?: string;
}

/**
 * Get icon component based on icon name
 */
function getIconComponent(iconName?: string) {
  switch (iconName) {
    case 'api':
      return <ApiIcon />;
    case 'storage':
      return <StorageIcon />;
    case 'redis':
      return <RedisIcon />;
    case 'psychology':
      return <PsychologyIcon />;
    case 'calendar':
      return <CalendarIcon />;
    case 'email':
      return <EmailIcon />;
    default:
      return <ApiIcon />;
  }
}

const ContainerStatsCard = ({
  container,
  serviceName,
  displayName,
  icon,
  loading = false,
  error,
}: ContainerStatsCardProps) => {
  // Check if container is not running
  const isRunning = container?.isRunning !== false;

  return (
    <Card sx={{ opacity: isRunning ? 1 : 0.6 }}>
      <CardContent>
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
          <Box sx={{ color: isRunning ? 'primary.main' : 'text.disabled' }}>{getIconComponent(icon)}</Box>
          <Box flex={1}>
            <Typography variant="subtitle1" fontWeight={600} color={isRunning ? 'text.primary' : 'text.disabled'}>
              {displayName}
              {!isRunning && (
                <Typography component="span" variant="subtitle2" color="text.disabled" sx={{ ml: 1 }}>
                  (not running)
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {serviceName}
            </Typography>
          </Box>
        </Stack>

        {/* Content */}
        {loading ? (
          <Stack spacing={2}>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                CPU Usage
              </Typography>
              <Skeleton variant="rectangular" height={8} sx={{ borderRadius: 1, mb: 1 }} />
              <Skeleton variant="text" width="30%" />
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Memory Usage
              </Typography>
              <Skeleton variant="rectangular" height={8} sx={{ borderRadius: 1, mb: 1 }} />
              <Skeleton variant="text" width="40%" />
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Network I/O
              </Typography>
              <Skeleton variant="text" width="50%" />
            </Box>
          </Stack>
        ) : error || !container ? (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <Typography color="text.secondary" variant="body2">
              {error || 'No stats available'}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2.5}>
            {/* CPU Usage */}
            <Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="body2" color={isRunning ? 'text.secondary' : 'text.disabled'}>
                  CPU Usage
                </Typography>
                <Typography variant="body2" fontWeight={600} color={isRunning ? 'text.primary' : 'text.disabled'}>
                  {container.cpu.usageText}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.min(container.cpu.usage, 100)}
                color={
                  !isRunning
                    ? 'inherit'
                    : container.cpu.usage > 80
                    ? 'error'
                    : container.cpu.usage > 60
                    ? 'warning'
                    : 'primary'
                }
                sx={{
                  height: 8,
                  borderRadius: 4,
                  opacity: isRunning ? 1 : 0.5,
                  bgcolor: !isRunning ? 'action.disabledBackground' : undefined
                }}
              />
            </Box>

            {/* Memory Usage */}
            <Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="body2" color={isRunning ? 'text.secondary' : 'text.disabled'}>
                  Memory Usage
                </Typography>
                <Typography variant="body2" fontWeight={600} color={isRunning ? 'text.primary' : 'text.disabled'}>
                  {container.memory.usageText}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.min(container.memory.usage, 100)}
                color={
                  !isRunning
                    ? 'inherit'
                    : container.memory.usage > 80
                    ? 'error'
                    : container.memory.usage > 60
                    ? 'warning'
                    : 'success'
                }
                sx={{
                  height: 8,
                  borderRadius: 4,
                  opacity: isRunning ? 1 : 0.5,
                  bgcolor: !isRunning ? 'action.disabledBackground' : undefined
                }}
              />
              <Typography variant="caption" color={isRunning ? 'text.secondary' : 'text.disabled'} sx={{ mt: 0.5 }}>
                {container.memory.usagePercent}
              </Typography>
            </Box>

            {/* Network I/O */}
            <Box>
              <Typography variant="body2" color={isRunning ? 'text.secondary' : 'text.disabled'} sx={{ mb: 1 }}>
                Network I/O
              </Typography>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption" color={isRunning ? 'text.primary' : 'text.disabled'}>↓ {container.network.input}</Typography>
                <Typography variant="caption" color={isRunning ? 'text.primary' : 'text.disabled'}>↑ {container.network.output}</Typography>
              </Stack>
            </Box>

            {/* Disk I/O */}
            <Box>
              <Typography variant="body2" color={isRunning ? 'text.secondary' : 'text.disabled'} sx={{ mb: 1 }}>
                Disk I/O
              </Typography>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption" color={isRunning ? 'text.primary' : 'text.disabled'}>Read: {container.blockIO.input}</Typography>
                <Typography variant="caption" color={isRunning ? 'text.primary' : 'text.disabled'}>Write: {container.blockIO.output}</Typography>
              </Stack>
            </Box>

            {/* GPU Usage (if available) */}
            {container.gpu && (
              <>
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <GpuIcon sx={{ fontSize: '1rem', color: isRunning ? 'primary.main' : 'text.disabled' }} />
                    <Typography variant="body2" color={isRunning ? 'text.secondary' : 'text.disabled'}>
                      GPU Utilization
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Typography variant="body2" fontWeight={600} color={isRunning ? 'text.primary' : 'text.disabled'}>
                      {container.gpu.utilization}%
                    </Typography>
                    <Typography variant="caption" color={isRunning ? 'text.secondary' : 'text.disabled'}>
                      {container.gpu.name}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(container.gpu.utilization, 100)}
                    color={
                      !isRunning
                        ? 'inherit'
                        : container.gpu.utilization > 80
                        ? 'error'
                        : container.gpu.utilization > 60
                        ? 'warning'
                        : 'success'
                    }
                    sx={{
                      height: 8,
                      borderRadius: 4,
                      opacity: isRunning ? 1 : 0.5,
                      bgcolor: !isRunning ? 'action.disabledBackground' : undefined
                    }}
                  />
                </Box>

                <Box>
                  <Typography variant="body2" color={isRunning ? 'text.secondary' : 'text.disabled'} sx={{ mb: 1 }}>
                    GPU Memory
                  </Typography>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Typography variant="body2" fontWeight={600} color={isRunning ? 'text.primary' : 'text.disabled'}>
                      {container.gpu.memoryUsed} MB / {container.gpu.memoryTotal} MB
                    </Typography>
                    <Typography variant="caption" color={isRunning ? 'text.secondary' : 'text.disabled'}>
                      {((container.gpu.memoryUsed / container.gpu.memoryTotal) * 100).toFixed(1)}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(
                      (container.gpu.memoryUsed / container.gpu.memoryTotal) * 100,
                      100
                    )}
                    color={
                      !isRunning
                        ? 'inherit'
                        : container.gpu.memoryUsed / container.gpu.memoryTotal > 0.8
                        ? 'error'
                        : container.gpu.memoryUsed / container.gpu.memoryTotal > 0.6
                        ? 'warning'
                        : 'primary'
                    }
                    sx={{
                      height: 8,
                      borderRadius: 4,
                      opacity: isRunning ? 1 : 0.5,
                      bgcolor: !isRunning ? 'action.disabledBackground' : undefined
                    }}
                  />
                </Box>

                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <TempIcon
                        sx={{
                          fontSize: '1rem',
                          color: !isRunning
                            ? 'text.disabled'
                            : container.gpu.temperature > 80
                            ? 'error.main'
                            : container.gpu.temperature > 70
                            ? 'warning.main'
                            : 'success.main',
                        }}
                      />
                      <Typography variant="body2" color={isRunning ? 'text.secondary' : 'text.disabled'}>
                        Temperature
                      </Typography>
                    </Stack>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color={
                        !isRunning
                          ? 'text.disabled'
                          : container.gpu.temperature > 80
                          ? 'error.main'
                          : container.gpu.temperature > 70
                          ? 'warning.main'
                          : 'success.main'
                      }
                    >
                      {container.gpu.temperature}°C
                    </Typography>
                  </Stack>
                </Box>
              </>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default ContainerStatsCard;
