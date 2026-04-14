/**
 * User Support Page
 * View and create support tickets
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
  Typography,
  Alert,
  Paper,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  CloudUpload as CloudUploadIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { supportClient, Ticket, CreateTicketData, DiagnosticsBundle } from '@/lib/supportClient';
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

export default function SupportPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTicket, setNewTicket] = useState<CreateTicketData>({
    subject: '',
    description: '',
    category: 'general',
    priority: 'normal',
  });
  const [diagBundles, setDiagBundles] = useState<DiagnosticsBundle[]>([]);
  const [diagUploading, setDiagUploading] = useState(false);
  const [diagFile, setDiagFile] = useState<File | null>(null);

  const loadTickets = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await supportClient.getMyTickets({
        status: statusFilter || undefined,
      });
      setTickets(response.tickets);
    } catch (err: any) {
      clientLogger.error('[Support] Failed to load tickets', { error: err.message });
      setError('Failed to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
    loadDiagnostics();
  }, [statusFilter]);

  const handleCreateTicket = async () => {
    if (!newTicket.subject.trim() || !newTicket.description.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      setCreating(true);
      const ticket = await supportClient.createTicket(newTicket);
      toast.success(`Ticket ${ticket.ticketNumber} created successfully`);
      setCreateDialogOpen(false);
      setNewTicket({ subject: '', description: '', category: 'general', priority: 'normal' });
      loadTickets();
    } catch (err: any) {
      clientLogger.error('[Support] Failed to create ticket', { error: err.message });
      toast.error('Failed to create ticket. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const loadDiagnostics = async () => {
    try {
      const response = await supportClient.getMyDiagnostics();
      setDiagBundles(response.bundles);
    } catch (err: any) {
      clientLogger.error('[Support] Failed to load diagnostics', { error: err.message });
    }
  };

  const handleUploadDiagnostics = async () => {
    if (!diagFile) return;

    try {
      setDiagUploading(true);
      await supportClient.uploadDiagnostics(diagFile);
      toast.success('Diagnostics uploaded successfully');
      setDiagFile(null);
      loadDiagnostics();
    } catch (err: any) {
      clientLogger.error('[Support] Failed to upload diagnostics', { error: err.message });
      toast.error(err.message || 'Failed to upload diagnostics');
    } finally {
      setDiagUploading(false);
    }
  };

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <>
      <Head>
        <title>Support · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Support"
          subtitle="Get help with Notely"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={loadTickets}
                disabled={loading}
              >
                Refresh
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
              >
                New Ticket
              </Button>
            </Stack>
          }
        >
          <Stack spacing={3}>
            {/* Diagnostics Upload */}
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Diagnostics
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Upload a diagnostics bundle exported from Notely Desktop for troubleshooting.
                </Typography>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<CloudUploadIcon />}
                    disabled={diagUploading}
                  >
                    {diagFile ? diagFile.name : 'Choose File'}
                    <input
                      type="file"
                      hidden
                      accept=".zip"
                      onChange={(e) => setDiagFile(e.target.files?.[0] || null)}
                    />
                  </Button>
                  <Button
                    variant="contained"
                    onClick={handleUploadDiagnostics}
                    disabled={!diagFile || diagUploading}
                  >
                    {diagUploading ? 'Uploading...' : 'Upload'}
                  </Button>
                </Stack>
                {diagBundles.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Your Uploads
                    </Typography>
                    <Stack spacing={1}>
                      {diagBundles.map((bundle) => (
                        <Stack
                          key={bundle.id}
                          direction="row"
                          spacing={2}
                          alignItems="center"
                          sx={{
                            p: 1,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                          }}
                        >
                          <Typography variant="body2" sx={{ flex: 1 }}>
                            {bundle.filename}
                          </Typography>
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
                          <Typography variant="caption" color="text.secondary">
                            {format(new Date(bundle.created_at), 'MMM d, yyyy')}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Filters */}
            <Card>
              <CardContent sx={{ py: 2 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    Filter by:
                  </Typography>
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
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {statusFilter
                        ? 'Try adjusting your filter or create a new ticket.'
                        : 'Create a ticket to get help from our support team.'}
                    </Typography>
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      Create Ticket
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            ) : (
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Ticket #</TableCell>
                      <TableCell>Subject</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Priority</TableCell>
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
                        onClick={() => router.push(`/support/${ticket.id}`)}
                      >
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace">
                            {ticket.ticketNumber}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
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
                                router.push(`/support/${ticket.id}`);
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
          </Stack>
        </PageContainer>
      </MainLayout>

      {/* Create Ticket Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Support Ticket</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              label="Subject"
              fullWidth
              required
              value={newTicket.subject}
              onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
              placeholder="Brief description of your issue"
            />
            <TextField
              label="Description"
              fullWidth
              required
              multiline
              rows={4}
              value={newTicket.description}
              onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
              placeholder="Please provide as much detail as possible..."
            />
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={newTicket.category}
                  label="Category"
                  onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}
                >
                  <MenuItem value="general">General</MenuItem>
                  <MenuItem value="technical">Technical Issue</MenuItem>
                  <MenuItem value="billing">Billing</MenuItem>
                  <MenuItem value="feature">Feature Request</MenuItem>
                  <MenuItem value="account">Account</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select
                  value={newTicket.priority}
                  label="Priority"
                  onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value as any })}
                >
                  <MenuItem value="low">Low</MenuItem>
                  <MenuItem value="normal">Normal</MenuItem>
                  <MenuItem value="high">High</MenuItem>
                  <MenuItem value="urgent">Urgent</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateTicket}
            disabled={creating || !newTicket.subject.trim() || !newTicket.description.trim()}
          >
            {creating ? 'Creating...' : 'Create Ticket'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { redirectTo: '/login', requiredPermission: 'support:user' });
