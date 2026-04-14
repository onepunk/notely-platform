/**
 * Admin Support Tickets Page
 * View and manage all support tickets
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
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
  Alert,
  InputAdornment,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Clear as ClearIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  MoreVert as MoreVertIcon,
  Psychology as PsychologyIcon,
  Refresh as RefreshIcon,
  RemoveCircleOutline as DismissIcon,
  Search as SearchIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { supportClient, Ticket, TicketStats, DiagnosticsBundle } from '@/lib/supportClient';
import toast from 'react-hot-toast';
import clientLogger from '@/lib/clientLogger';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  open: 'info',
  in_progress: 'primary',
  waiting: 'warning',
  resolved: 'success',
  closed: 'default',
};

const PRIORITY_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  urgent: 'error',
};

export default function AdminSupportPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [createdLast24h, setCreatedLast24h] = useState<boolean>(false);

  // Diagnostics
  const [diagBundles, setDiagBundles] = useState<DiagnosticsBundle[]>([]);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagStatusFilter, setDiagStatusFilter] = useState<string>('');
  const [diagMenuAnchor, setDiagMenuAnchor] = useState<null | HTMLElement>(null);
  const [diagMenuBundleId, setDiagMenuBundleId] = useState<string | null>(null);

  // Analysis dialog
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [analysisDialogBundle, setAnalysisDialogBundle] = useState<DiagnosticsBundle | null>(null);

  const loadTickets = async () => {
    try {
      setLoading(true);
      setError(null);

      // Calculate 24h ago timestamp if filter is active
      let createdSince: string | undefined;
      if (createdLast24h) {
        const date = new Date();
        date.setHours(date.getHours() - 24);
        createdSince = date.toISOString();
      }

      const response = await supportClient.getAllTickets({
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        search: searchTerm || undefined,
        created_since: createdSince,
      });
      setTickets(response.tickets);
    } catch (err: any) {
      clientLogger.error('[Support Admin] Failed to load tickets', { error: err.message });
      setError('Failed to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await supportClient.getStats();
      setStats(data);
    } catch (err: any) {
      clientLogger.error('[Support Admin] Failed to load stats', { error: err.message });
    }
  };

  useEffect(() => {
    loadTickets();
    loadStats();
    loadDiagnostics();
  }, [statusFilter, priorityFilter, createdLast24h]);

  useEffect(() => {
    loadDiagnostics();
  }, [diagStatusFilter]);

  // Poll for analysis status when any bundle is in progress
  useEffect(() => {
    const hasInProgress = diagBundles.some((b) => b.analysis_status === 'in_progress');
    if (!hasInProgress) return;

    const interval = setInterval(() => {
      loadDiagnostics();
    }, 5000);

    return () => clearInterval(interval);
  }, [diagBundles]);

  const handleSearch = () => {
    loadTickets();
  };

  const clearFilters = () => {
    setStatusFilter('');
    setPriorityFilter('');
    setSearchTerm('');
    setCreatedLast24h(false);
  };

  const loadDiagnostics = async () => {
    try {
      setDiagLoading(true);
      const response = await supportClient.getAdminDiagnostics({
        status: diagStatusFilter || undefined,
      });
      setDiagBundles(response.bundles);
    } catch (err: any) {
      clientLogger.error('[Support Admin] Failed to load diagnostics', { error: err.message });
    } finally {
      setDiagLoading(false);
    }
  };

  const handleReviewBundle = async (id: string, status: 'reviewed' | 'dismissed') => {
    try {
      await supportClient.updateBundle(id, { status });
      toast.success(`Bundle marked as ${status}`);
      loadDiagnostics();
    } catch (err: any) {
      toast.error('Failed to update bundle');
    }
  };

  const handleDeleteBundle = async (id: string) => {
    try {
      await supportClient.deleteBundle(id);
      toast.success('Bundle deleted');
      loadDiagnostics();
    } catch (err: any) {
      toast.error('Failed to delete bundle');
    }
  };

  const handleAnalyzeBundle = async (id: string) => {
    try {
      await supportClient.analyzeBundle(id);
      toast.success('Analysis started');
      loadDiagnostics();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start analysis');
    }
  };

  const openAnalysisDialog = async (bundle: DiagnosticsBundle) => {
    setAnalysisDialogOpen(true);
    setAnalysisDialogBundle(bundle);
    try {
      // Fetch full detail (includes analysis_result / analysis_error)
      const detail = await supportClient.getDiagnosticsBundle(bundle.id);
      setAnalysisDialogBundle(detail);
    } catch {
      // Keep the partial data we already have
    }
  };

  const closeAnalysisDialog = () => {
    setAnalysisDialogOpen(false);
    setAnalysisDialogBundle(null);
  };

  const openDiagMenu = (event: React.MouseEvent<HTMLElement>, bundleId: string) => {
    setDiagMenuAnchor(event.currentTarget);
    setDiagMenuBundleId(bundleId);
  };

  const closeDiagMenu = () => {
    setDiagMenuAnchor(null);
    setDiagMenuBundleId(null);
  };

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <>
      <Head>
        <title>Support Admin · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Support Tickets"
          subtitle="Manage customer support requests"
          action={
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => { loadTickets(); loadStats(); }}
              disabled={loading}
            >
              Refresh
            </Button>
          }
        >
          <Stack spacing={3}>
            {/* Stats Cards */}
            {stats && (
              <Grid container spacing={2}>
                <Grid item xs={6} sm={4} md={2}>
                  <Card
                    sx={{
                      cursor: 'pointer',
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 },
                      border: statusFilter === 'open' ? 2 : 0,
                      borderColor: 'info.main',
                    }}
                    onClick={() => setStatusFilter(statusFilter === 'open' ? '' : 'open')}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h4" color="info.main">
                        {stats.byStatus.open}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Open
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={4} md={2}>
                  <Card
                    sx={{
                      cursor: 'pointer',
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 },
                      border: statusFilter === 'in_progress' ? 2 : 0,
                      borderColor: 'primary.main',
                    }}
                    onClick={() => setStatusFilter(statusFilter === 'in_progress' ? '' : 'in_progress')}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h4" color="primary.main">
                        {stats.byStatus.inProgress}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        In Progress
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={4} md={2}>
                  <Card
                    sx={{
                      cursor: 'pointer',
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 },
                      border: statusFilter === 'waiting' ? 2 : 0,
                      borderColor: 'warning.main',
                    }}
                    onClick={() => setStatusFilter(statusFilter === 'waiting' ? '' : 'waiting')}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h4" color="warning.main">
                        {stats.byStatus.waiting}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Waiting
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={4} md={2}>
                  <Card
                    sx={{
                      cursor: 'pointer',
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 },
                      border: priorityFilter === 'urgent' ? 2 : 0,
                      borderColor: 'error.main',
                    }}
                    onClick={() => setPriorityFilter(priorityFilter === 'urgent' ? '' : 'urgent')}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h4" color="error.main">
                        {stats.priority.urgent}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Urgent
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={4} md={2}>
                  <Card
                    sx={{
                      cursor: 'pointer',
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 },
                      border: createdLast24h ? 2 : 0,
                      borderColor: 'text.primary',
                    }}
                    onClick={() => setCreatedLast24h(!createdLast24h)}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h4" color="text.primary">
                        {stats.activity.createdLast24h}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        New (24h)
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={4} md={2}>
                  <Card
                    sx={{
                      cursor: 'pointer',
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 },
                      border: statusFilter === 'resolved' ? 2 : 0,
                      borderColor: 'success.main',
                    }}
                    onClick={() => setStatusFilter(statusFilter === 'resolved' ? '' : 'resolved')}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h4" color="success.main">
                        {stats.activity.resolvedLast24h}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Resolved (24h)
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            )}

            {/* Filters */}
            <Card>
              <CardContent sx={{ py: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                  <TextField
                    size="small"
                    placeholder="Search tickets..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    sx={{ minWidth: 250 }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={statusFilter}
                      label="Status"
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="open">Open</MenuItem>
                      <MenuItem value="in_progress">In Progress</MenuItem>
                      <MenuItem value="waiting">Waiting</MenuItem>
                      <MenuItem value="resolved">Resolved</MenuItem>
                      <MenuItem value="closed">Closed</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Priority</InputLabel>
                    <Select
                      value={priorityFilter}
                      label="Priority"
                      onChange={(e) => setPriorityFilter(e.target.value)}
                    >
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="urgent">Urgent</MenuItem>
                      <MenuItem value="high">High</MenuItem>
                      <MenuItem value="normal">Normal</MenuItem>
                      <MenuItem value="low">Low</MenuItem>
                    </Select>
                  </FormControl>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleSearch}
                  >
                    Search
                  </Button>
                  {(statusFilter || priorityFilter || searchTerm || createdLast24h) && (
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<ClearIcon />}
                      onClick={clearFilters}
                    >
                      Clear
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>

            {/* Tickets Table */}
            {error && (
              <Alert severity="error">{error}</Alert>
            )}

            {loading ? (
              <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress />
              </Box>
            ) : tickets.length === 0 ? (
              <Card>
                <CardContent>
                  <Box textAlign="center" py={4}>
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      No tickets found
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Try adjusting your filters or check back later.
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            ) : (
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Ticket #</TableCell>
                      <TableCell>User</TableCell>
                      <TableCell>Subject</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Priority</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell>Messages</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tickets.map((ticket) => (
                      <TableRow
                        key={ticket.id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => router.push(`/admin/support/${ticket.id}`)}
                      >
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace">
                            {ticket.ticketNumber}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 150 }}>
                            {ticket.userEmail}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                            {ticket.subject}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={formatStatus(ticket.status)}
                            color={STATUS_COLORS[ticket.status]}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                            color={PRIORITY_COLORS[ticket.priority]}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {ticket.category.charAt(0).toUpperCase() + ticket.category.slice(1)}
                          </Typography>
                        </TableCell>
                        <TableCell>{ticket.messageCount}</TableCell>
                        <TableCell>
                          {format(new Date(ticket.createdAt), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="View Ticket">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/admin/support/${ticket.id}`);
                              }}
                            >
                              <ViewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {/* Diagnostics Bundles */}
            <Typography variant="h6" sx={{ mt: 2 }}>
              Diagnostics Bundles
            </Typography>
            <Card>
              <CardContent sx={{ py: 2 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    Filter by:
                  </Typography>
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={diagStatusFilter}
                      label="Status"
                      onChange={(e) => setDiagStatusFilter(e.target.value)}
                    >
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="pending_review">Pending Review</MenuItem>
                      <MenuItem value="reviewed">Reviewed</MenuItem>
                      <MenuItem value="dismissed">Dismissed</MenuItem>
                    </Select>
                  </FormControl>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<RefreshIcon />}
                    onClick={loadDiagnostics}
                    disabled={diagLoading}
                  >
                    Refresh
                  </Button>
                </Stack>
              </CardContent>
            </Card>

            {diagLoading ? (
              <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress />
              </Box>
            ) : diagBundles.length === 0 ? (
              <Card>
                <CardContent>
                  <Box textAlign="center" py={3}>
                    <Typography variant="body2" color="text.secondary">
                      No diagnostics bundles found.
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            ) : (
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>User</TableCell>
                      <TableCell>Filename</TableCell>
                      <TableCell>App Version</TableCell>
                      <TableCell>Platform</TableCell>
                      <TableCell>System</TableCell>
                      <TableCell>AV Scan</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Analysis</TableCell>
                      <TableCell>Uploaded</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {diagBundles.map((bundle) => (
                      <TableRow key={bundle.id} hover>
                        <TableCell>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
                            {bundle.user_email}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                            {bundle.filename}
                          </Typography>
                        </TableCell>
                        <TableCell>{bundle.app_version || '-'}</TableCell>
                        <TableCell>{bundle.platform || '-'}</TableCell>
                        <TableCell>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 250 }}>
                            {bundle.cpu_cores
                              ? [
                                  bundle.arch,
                                  bundle.cpu_cores ? `${bundle.cpu_cores} cores` : null,
                                  bundle.total_memory_gb ? `${bundle.total_memory_gb}GB` : null,
                                  bundle.gpu_name || null,
                                ].filter(Boolean).join(' \u00b7 ')
                              : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={
                              bundle.scan_result === 'clean'
                                ? 'Passed'
                                : bundle.scan_result === 'infected'
                                  ? 'Failed'
                                  : 'Pending'
                            }
                            color={
                              bundle.scan_result === 'clean'
                                ? 'success'
                                : bundle.scan_result === 'infected'
                                  ? 'error'
                                  : 'warning'
                            }
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={formatStatus(bundle.status)}
                            color={
                              bundle.status === 'reviewed'
                                ? 'success'
                                : bundle.status === 'dismissed'
                                  ? 'default'
                                  : 'warning'
                            }
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {bundle.analysis_status === 'in_progress' ? (
                            <Chip
                              icon={<CircularProgress size={14} />}
                              label="Analyzing..."
                              color="warning"
                              size="small"
                              variant="outlined"
                            />
                          ) : bundle.analysis_status === 'completed' ? (
                            <Chip
                              label="Analyzed"
                              color="success"
                              size="small"
                              onClick={() => openAnalysisDialog(bundle)}
                              sx={{ cursor: 'pointer' }}
                            />
                          ) : bundle.analysis_status === 'failed' ? (
                            <Chip
                              label="Failed"
                              color="error"
                              size="small"
                              onClick={() => openAnalysisDialog(bundle)}
                              sx={{ cursor: 'pointer' }}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {format(new Date(bundle.created_at), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            onClick={(e) => openDiagMenu(e, bundle.id)}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {/* Diagnostics bundle actions menu */}
            <Menu
              anchorEl={diagMenuAnchor}
              open={Boolean(diagMenuAnchor)}
              onClose={closeDiagMenu}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem
                onClick={() => {
                  if (diagMenuBundleId) supportClient.downloadBundle(diagMenuBundleId);
                  closeDiagMenu();
                }}
              >
                <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Download</ListItemText>
              </MenuItem>
              {(() => {
                const bundle = diagBundles.find((b) => b.id === diagMenuBundleId);
                if (!bundle) return null;
                return (
                  <>
                    <MenuItem
                      disabled={bundle.analysis_status === 'in_progress' || bundle.scan_result !== 'clean'}
                      onClick={() => {
                        if (diagMenuBundleId) handleAnalyzeBundle(diagMenuBundleId);
                        closeDiagMenu();
                      }}
                    >
                      <ListItemIcon><PsychologyIcon fontSize="small" color="primary" /></ListItemIcon>
                      <ListItemText>
                        {bundle.analysis_status === 'completed' || bundle.analysis_status === 'failed'
                          ? 'Re-Analyze'
                          : 'Analyze'}
                      </ListItemText>
                    </MenuItem>
                    {(bundle.analysis_status === 'completed' || bundle.analysis_status === 'failed') && (
                      <MenuItem
                        onClick={() => {
                          openAnalysisDialog(bundle);
                          closeDiagMenu();
                        }}
                      >
                        <ListItemIcon><ViewIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>View Analysis</ListItemText>
                      </MenuItem>
                    )}
                  </>
                );
              })()}
              <MenuItem
                onClick={() => {
                  if (diagMenuBundleId) handleReviewBundle(diagMenuBundleId, 'reviewed');
                  closeDiagMenu();
                }}
              >
                <ListItemIcon><CheckCircleIcon fontSize="small" color="success" /></ListItemIcon>
                <ListItemText>Review</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  if (diagMenuBundleId) handleReviewBundle(diagMenuBundleId, 'dismissed');
                  closeDiagMenu();
                }}
              >
                <ListItemIcon><DismissIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Dismiss</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  if (diagMenuBundleId) handleDeleteBundle(diagMenuBundleId);
                  closeDiagMenu();
                }}
                sx={{ color: 'error.main' }}
              >
                <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
                <ListItemText>Delete</ListItemText>
              </MenuItem>
            </Menu>

            {/* Analysis Results Dialog */}
            <Dialog
              open={analysisDialogOpen}
              onClose={closeAnalysisDialog}
              maxWidth="md"
              fullWidth
            >
              <DialogTitle>
                {analysisDialogBundle?.analysis_status === 'failed'
                  ? 'Analysis Failed'
                  : 'Analysis Results'}
              </DialogTitle>
              <DialogContent dividers>
                {analysisDialogBundle?.analysis_status === 'failed' ? (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {analysisDialogBundle.analysis_error || 'Unknown error'}
                  </Alert>
                ) : (
                  <Box
                    component="pre"
                    sx={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      lineHeight: 1.6,
                      m: 0,
                      p: 1,
                    }}
                  >
                    {analysisDialogBundle?.analysis_result || 'No analysis result available.'}
                  </Box>
                )}
                {analysisDialogBundle?.analysis_completed_at && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                    Completed: {format(new Date(analysisDialogBundle.analysis_completed_at), 'MMM d, yyyy HH:mm:ss')}
                  </Typography>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={closeAnalysisDialog}>Close</Button>
              </DialogActions>
            </Dialog>
          </Stack>
        </PageContainer>
      </MainLayout>
    </>
  );
}

export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { redirectTo: '/login', requiredPermission: 'support:admin' });
