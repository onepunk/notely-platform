/**
 * Log Explorer Component
 * Query and view logs from Loki with filtering and search
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

const TIME_RANGE_OPTIONS = [
  { label: 'Last 15 minutes', value: 15 * 60 },
  { label: 'Last 1 hour', value: 60 * 60 },
  { label: 'Last 6 hours', value: 6 * 60 * 60 },
  { label: 'Last 24 hours', value: 24 * 60 * 60 },
  { label: 'Last 7 days', value: 7 * 24 * 60 * 60 },
];

const LEVEL_CHIP_COLORS: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  TRACE: 'default',
  DEBUG: 'default',
  INFO: 'success',
  WARN: 'warning',
  ERROR: 'error',
  FATAL: 'error',
};

interface LogEntry {
  id: string;
  timestamp: string;
  service?: string | null;
  level?: string | null;
  message: string;
  container?: string | null;
}

interface LokiQueryResponse {
  entries: LogEntry[];
  meta: {
    count: number;
    limit: number;
    start: string;
    end: string;
    nextCursor: string | null;
  };
}


function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function levelChip(level?: string | null) {
  if (!level) return null;
  const upper = level.toUpperCase();
  const color = LEVEL_CHIP_COLORS[upper] || 'default';
  return <Chip size="small" label={upper} color={color} />;
}

export default function LogExplorer() {
  const router = useRouter();
  const [servicesLoading, setServicesLoading] = useState(true);
  const [services, setServices] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<number>(60 * 60);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const buildQueryParams = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();

      if (selectedService && selectedService !== 'all') {
        params.append('service', selectedService);
      }
      if (selectedLevel && selectedLevel !== 'all') {
        params.append('level', selectedLevel);
      }
      if (searchTerm) {
        params.append('search', searchTerm);
      }

      if (cursor) {
        params.append('end', cursor);
        params.append('start', '1970-01-01T00:00:00Z');
      } else {
        const end = new Date();
        const start = new Date(end.getTime() - timeRange * 1000);
        params.append('end', end.toISOString());
        params.append('start', start.toISOString());
      }

      params.append('limit', '200');
      params.append('direction', 'backward');
      return params.toString();
    },
    [searchTerm, selectedService, selectedLevel, timeRange]
  );

  const loadLogs = useCallback(
    async (append = false, cursor?: string) => {
      try {
        setLoadingLogs(true);
        setLogError(null);

        const query = buildQueryParams(cursor);
        const { data } = await apiRequest<{ success: boolean; data: LokiQueryResponse }>(
          `/api/admin/logs/query?${query}`
        );

        if (append) {
          setLogs((prev) => [...prev, ...data.entries]);
        } else {
          setLogs(data.entries);
        }

        setNextCursor(data.meta.nextCursor);
      } catch (error: any) {
        clientLogger.error('Failed to load logs:', { error: error instanceof Error ? error.message : String(error) });

        // Handle authentication errors by redirecting to login
        if (error instanceof AuthenticationError) {
          toast.error('Session expired. Please log in again.');
          router.push('/login');
          return;
        }

        // Handle authorization errors
        if (error instanceof AuthorizationError) {
          toast.error('You do not have permission to view logs.');
          setLogError('Insufficient permissions to view logs');
          return;
        }

        setLogError(error.message || 'Failed to load logs');
        toast.error(error.message || 'Failed to load logs');
      } finally {
        setLoadingLogs(false);
      }
    },
    [buildQueryParams, router]
  );

  const loadServices = useCallback(async () => {
    try {
      setServicesLoading(true);
      const { data } = await apiRequest<{ success: boolean; data: string[] }>('/api/admin/logs/services');
      setServices(data);
    } catch (error: any) {
      clientLogger.error('Failed to load services:', { error: error instanceof Error ? error.message : String(error) });

      // Handle authentication errors by redirecting to login
      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }

      // Handle authorization errors
      if (error instanceof AuthorizationError) {
        toast.error('You do not have permission to view logs.');
        return;
      }

      // Silently fail for other errors - filters will still work
    } finally {
      setServicesLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadServices();
    loadLogs();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [selectedService, selectedLevel, timeRange, loadLogs]);

  const levelFilterOptions = useMemo(() => LOG_LEVELS, []);

  return (
    <>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 40,
                    height: 40,
                    borderRadius: 2,
                    bgcolor: 'primary.50',
                    color: 'primary.main',
                  }}
                >
                  <TimelineIcon />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={600}>
                    Log Explorer
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Query and filter system logs from Loki
                  </Typography>
                </Box>
              </Box>

              <Divider sx={{ mb: 3 }} />

              <Stack spacing={3}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
                  <FormControl sx={{ minWidth: 160 }} size="small" disabled={servicesLoading}>
                    <InputLabel id="service-filter-label">Service</InputLabel>
                    <Select
                      labelId="service-filter-label"
                      label="Service"
                      value={selectedService}
                      onChange={(event) => setSelectedService(event.target.value)}
                    >
                      <MenuItem value="all">All services</MenuItem>
                      {services.map((service) => (
                        <MenuItem key={service} value={service}>
                          {service}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl sx={{ minWidth: 140 }} size="small">
                    <InputLabel id="level-filter-label">Level</InputLabel>
                    <Select
                      labelId="level-filter-label"
                      label="Level"
                      value={selectedLevel}
                      onChange={(event) => setSelectedLevel(event.target.value)}
                    >
                      <MenuItem value="all">All levels</MenuItem>
                      {levelFilterOptions.map((level) => (
                        <MenuItem key={level} value={level}>
                          {level}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl sx={{ minWidth: 160 }} size="small">
                    <InputLabel id="time-range-label">Time range</InputLabel>
                    <Select
                      labelId="time-range-label"
                      label="Time range"
                      value={timeRange}
                      onChange={(event) => setTimeRange(Number(event.target.value))}
                    >
                      {TIME_RANGE_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    fullWidth
                    label="Search"
                    size="small"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Keyword or phrase"
                  />

                  <Tooltip title="Run query with current filters">
                    <span>
                      <IconButton color="primary" onClick={() => loadLogs(false)} disabled={loadingLogs}>
                        <PlayArrowIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Reload logs">
                    <span>
                      <IconButton onClick={() => loadLogs(false)} disabled={loadingLogs}>
                        <RefreshIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                {logError && <Alert severity="error">{logError}</Alert>}

                <TableContainer
                  sx={{
                    maxHeight: 600,
                    borderRadius: 1,
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                  }}
                >
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell width="5%" sx={{ fontSize: '0.8rem' }}></TableCell>
                        <TableCell width="18%" sx={{ fontSize: '0.8rem' }}>
                          Timestamp
                        </TableCell>
                        <TableCell width="18%" sx={{ fontSize: '0.8rem' }}>
                          Container
                        </TableCell>
                        <TableCell width="15%" sx={{ fontSize: '0.8rem' }}>
                          Service
                        </TableCell>
                        <TableCell width="10%" sx={{ fontSize: '0.8rem' }}>
                          Level
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>Message</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {loadingLogs && logs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" py={4}>
                              <CircularProgress size={20} />
                              <Typography variant="body2">Loading logs…</Typography>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      )}

                      {logs.length === 0 && !loadingLogs && (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <Typography align="center" variant="body2" color="text.secondary" py={4}>
                              No logs match the selected filters.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}

                      {logs.map((entry) => {
                        const isExpanded = expandedLogId === entry.id;
                        return (
                          <>
                            <TableRow
                              key={entry.id}
                              hover
                              onClick={() => setExpandedLogId((prev) => (prev === entry.id ? null : entry.id))}
                              sx={{ cursor: 'pointer' }}
                            >
                              <TableCell sx={{ fontSize: '0.8rem', borderBottom: isExpanded ? 'none' : undefined }}>
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedLogId((prev) => (prev === entry.id ? null : entry.id));
                                  }}
                                >
                                  {isExpanded ? (
                                    <ExpandLessIcon fontSize="inherit" />
                                  ) : (
                                    <ExpandMoreIcon fontSize="inherit" />
                                  )}
                                </IconButton>
                              </TableCell>
                              <TableCell sx={{ fontSize: '0.8rem', borderBottom: isExpanded ? 'none' : undefined }}>
                                <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                  {formatTimestamp(entry.timestamp)}
                                </Typography>
                              </TableCell>
                              <TableCell sx={{ fontSize: '0.8rem', borderBottom: isExpanded ? 'none' : undefined }}>
                                <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                  {entry.container || '—'}
                                </Typography>
                              </TableCell>
                              <TableCell sx={{ fontSize: '0.8rem', borderBottom: isExpanded ? 'none' : undefined }}>
                                <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                  {entry.service || '—'}
                                </Typography>
                              </TableCell>
                              <TableCell sx={{ fontSize: '0.8rem', borderBottom: isExpanded ? 'none' : undefined }}>
                                {levelChip(entry.level) || (
                                  <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                    —
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', pr: 0, borderBottom: isExpanded ? 'none' : undefined }}>
                                <Typography
                                  component="span"
                                  sx={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    fontSize: '0.8rem',
                                  }}
                                >
                                  {entry.message}
                                </Typography>
                              </TableCell>
                            </TableRow>
                            <TableRow key={`${entry.id}-expanded`}>
                              <TableCell sx={{ py: 0, px: 0, border: 0 }} colSpan={6}>
                                <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                  <Box
                                    sx={{
                                      px: 2,
                                      py: 1.5,
                                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
                                      borderTop: 1,
                                      borderColor: 'divider',
                                    }}
                                  >
                                    <Grid container spacing={2}>
                                      <Grid item xs={12} md={3}>
                                        <Stack spacing={1.5}>
                                          <Box>
                                            <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                              Time
                                            </Typography>
                                            <Typography variant="body2" fontFamily="monospace" fontSize="0.8rem">
                                              {formatTimestamp(entry.timestamp)}
                                            </Typography>
                                          </Box>
                                          <Box>
                                            <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                              Container
                                            </Typography>
                                            <Typography variant="body2" fontFamily="monospace" fontSize="0.8rem">
                                              {entry.container || '—'}
                                            </Typography>
                                          </Box>
                                          <Box>
                                            <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                              Service
                                            </Typography>
                                            <Typography variant="body2" fontFamily="monospace" fontSize="0.8rem">
                                              {entry.service || '—'}
                                            </Typography>
                                          </Box>
                                          <Box>
                                            <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                              Level
                                            </Typography>
                                            <Box sx={{ mt: 0.5 }}>
                                              {levelChip(entry.level) || <Typography variant="body2" fontSize="0.8rem">—</Typography>}
                                            </Box>
                                          </Box>
                                        </Stack>
                                      </Grid>
                                      <Grid item xs={12} md={9}>
                                        <Box>
                                          <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                            Full Message
                                          </Typography>
                                          <Typography
                                            variant="body2"
                                            sx={{
                                              whiteSpace: 'pre-wrap',
                                              fontFamily: 'monospace',
                                              fontSize: '0.8rem',
                                              mt: 0.5,
                                              p: 1,
                                              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.03)',
                                              borderRadius: 1,
                                            }}
                                          >
                                            {entry.message}
                                          </Typography>
                                        </Box>
                                      </Grid>
                                    </Grid>
                                  </Box>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          </>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption">
                    Showing {logs.length} entries{nextCursor ? ' (more available)' : ''}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button variant="outlined" onClick={() => loadLogs(false)} disabled={loadingLogs} size="small">
                      Refresh
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => loadLogs(true, nextCursor || undefined)}
                      disabled={loadingLogs || !nextCursor}
                      size="small"
                    >
                      Load older
                    </Button>
                  </Stack>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
