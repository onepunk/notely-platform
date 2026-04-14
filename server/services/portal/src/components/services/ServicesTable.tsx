/**
 * Services Table Component
 * Displays detailed information about Docker services with control actions
 * Clean, minimal design matching Releases page styling
 */

import { useState } from 'react';
import clientLogger from '@/lib/clientLogger';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Box,
  IconButton,
  Tooltip,
  Stack,
  CircularProgress,
} from '@mui/material';
import {
  PlayArrow as StartIcon,
  Stop as StopIcon,
  Refresh as RestartIcon,
} from '@mui/icons-material';
import toast from 'react-hot-toast';
import { DockerServiceInfo, dockerService } from '@/services/dockerService';

interface ServicesTableProps {
  services: DockerServiceInfo[];
  loading: boolean;
  onRefresh: () => void;
}

/**
 * Helper function to extract port number from Docker port string
 */
function extractPortNumber(portString: string): string {
  if (!portString) return '';
  if (/^\d+$/.test(portString)) return portString;
  const match = portString.match(/:?(\d+)/);
  return match ? match[1] : portString;
}

/**
 * Get status color based on service status and health
 */
function getStatusColor(status: DockerServiceInfo['status'], health: DockerServiceInfo['health']): string {
  if (status === 'running') {
    if (health === 'healthy' || health === 'unknown') return 'success.main';
    if (health === 'degraded') return 'warning.main';
    return 'error.main';
  }
  if (status === 'stopped') return 'error.main';
  if (status === 'restarting') return 'warning.main';
  if (status === 'error') return 'error.main';
  return 'text.secondary';
}

/**
 * Get status label based on service status and health
 */
function getStatusLabel(status: DockerServiceInfo['status'], health: DockerServiceInfo['health']): string {
  if (status === 'running') {
    if (health === 'healthy' || health === 'unknown') return 'Running';
    if (health === 'degraded') return 'Degraded';
    return 'Unhealthy';
  }
  if (status === 'stopped') return 'Stopped';
  if (status === 'restarting') return 'Restarting';
  if (status === 'error') return 'Error';
  return 'Unknown';
}

const ServicesTable = ({ services, loading, onRefresh }: ServicesTableProps) => {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleServiceAction = async (
    serviceName: string,
    action: 'start' | 'stop' | 'restart'
  ) => {
    setActionLoading(serviceName);
    try {
      let result;
      switch (action) {
        case 'start':
          result = await dockerService.startService(serviceName);
          break;
        case 'stop':
          result = await dockerService.stopService(serviceName);
          break;
        case 'restart':
          result = await dockerService.restartService(serviceName);
          break;
      }

      if (result.success) {
        toast.success(result.message);
        onRefresh();
      } else {
        toast.error(result.message || `Failed to ${action} service`);
      }
    } catch (error: any) {
      clientLogger.error(`Failed to ${action} service:`, { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || `Failed to ${action} service`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            fontWeight: 600,
            mb: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Service Details
        </Typography>
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
          fontWeight: 600,
          mb: 2,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Service Details
      </Typography>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', py: 1 }}>Service</TableCell>
              <TableCell sx={{ fontWeight: 'bold', py: 1 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 'bold', py: 1 }}>Uptime</TableCell>
              <TableCell sx={{ fontWeight: 'bold', py: 1 }}>Ports</TableCell>
              <TableCell sx={{ fontWeight: 'bold', py: 1 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {services.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography color="text.secondary">No services found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              services.map((service) => (
                <TableRow key={service.name}>
                  <TableCell sx={{ py: 0.5 }}>
                    <Typography variant="subtitle2">{service.displayName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {service.description}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: getStatusColor(service.status, service.health),
                        }}
                      />
                      <Typography variant="body2">
                        {getStatusLabel(service.status, service.health)}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      {service.uptime || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      {service.ports && service.ports.length > 0
                        ? service.ports.map(extractPortNumber).join(', ')
                        : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    {service.canControl && (
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Start service">
                          <IconButton
                            size="small"
                            onClick={() => handleServiceAction(service.name, 'start')}
                            disabled={
                              service.status === 'running' || actionLoading === service.name
                            }
                            sx={{
                              color:
                                service.status === 'running'
                                  ? 'action.disabled'
                                  : 'success.main',
                              '&.Mui-disabled': {
                                color: 'action.disabled',
                              },
                              padding: '6px',
                            }}
                          >
                            {actionLoading === service.name ? (
                              <CircularProgress size={14} />
                            ) : (
                              <StartIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>

                        <Tooltip title="Stop service">
                          <IconButton
                            size="small"
                            onClick={() => handleServiceAction(service.name, 'stop')}
                            disabled={
                              service.status === 'stopped' || actionLoading === service.name
                            }
                            sx={{
                              color:
                                service.status === 'stopped'
                                  ? 'action.disabled'
                                  : 'error.main',
                              '&.Mui-disabled': {
                                color: 'action.disabled',
                              },
                              padding: '6px',
                            }}
                          >
                            {actionLoading === service.name ? (
                              <CircularProgress size={14} />
                            ) : (
                              <StopIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>

                        <Tooltip title="Restart service">
                          <IconButton
                            size="small"
                            onClick={() => handleServiceAction(service.name, 'restart')}
                            disabled={actionLoading === service.name}
                            sx={{
                              color: 'warning.main',
                              '&.Mui-disabled': {
                                color: 'action.disabled',
                              },
                              padding: '6px',
                            }}
                          >
                            {actionLoading === service.name ? (
                              <CircularProgress size={14} />
                            ) : (
                              <RestartIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default ServicesTable;
