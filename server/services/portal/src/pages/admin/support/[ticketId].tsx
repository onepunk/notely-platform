/**
 * Admin Support Ticket Detail Page
 * View and manage ticket details, update status, add internal notes
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  Alert,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Send as SendIcon,
  Person as PersonIcon,
  Support as SupportIcon,
  Lock as LockIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { supportClient, Ticket, Message, UpdateTicketData } from '@/lib/supportClient';
import { useAuth } from '@/contexts/AuthContext';
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

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

export default function AdminTicketDetailPage() {
  const router = useRouter();
  const { ticketId } = router.query;
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);

  // Reply/Note states
  const [replyMessage, setReplyMessage] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [sending, setSending] = useState(false);

  // Update states
  const [updatedStatus, setUpdatedStatus] = useState<string>('');
  const [updatedPriority, setUpdatedPriority] = useState<string>('');
  const [updating, setUpdating] = useState(false);

  const loadTicket = async () => {
    if (!ticketId || typeof ticketId !== 'string') return;

    try {
      setLoading(true);
      setError(null);
      const data = await supportClient.getAdminTicket(ticketId);
      setTicket(data);
      setUpdatedStatus(data.status);
      setUpdatedPriority(data.priority);
    } catch (err: any) {
      clientLogger.error('[Support Admin] Failed to load ticket', { error: err.message, ticketId });
      if (err.status === 404) {
        setError('Ticket not found');
      } else {
        setError('Failed to load ticket. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTicket();
  }, [ticketId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticket?.messages]);

  const handleSendReply = async () => {
    if (!replyMessage.trim() || !ticketId || typeof ticketId !== 'string') return;

    try {
      setSending(true);
      await supportClient.addReply(ticketId, replyMessage.trim());
      setReplyMessage('');
      toast.success('Reply sent');
      loadTicket();
    } catch (err: any) {
      clientLogger.error('[Support Admin] Failed to send reply', { error: err.message, ticketId });
      toast.error('Failed to send reply. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleAddInternalNote = async () => {
    if (!internalNote.trim() || !ticketId || typeof ticketId !== 'string') return;

    try {
      setSending(true);
      await supportClient.addInternalNote(ticketId, internalNote.trim());
      setInternalNote('');
      toast.success('Internal note added');
      loadTicket();
    } catch (err: any) {
      clientLogger.error('[Support Admin] Failed to add internal note', { error: err.message, ticketId });
      toast.error('Failed to add note. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleUpdateTicket = async () => {
    if (!ticketId || typeof ticketId !== 'string' || !ticket) return;

    const updates: UpdateTicketData = {};
    if (updatedStatus !== ticket.status) updates.status = updatedStatus as any;
    if (updatedPriority !== ticket.priority) updates.priority = updatedPriority as any;

    if (Object.keys(updates).length === 0) {
      toast('No changes to save');
      return;
    }

    try {
      setUpdating(true);
      await supportClient.updateTicket(ticketId, updates);
      toast.success('Ticket updated');
      loadTicket();
    } catch (err: any) {
      clientLogger.error('[Support Admin] Failed to update ticket', { error: err.message, ticketId });
      toast.error('Failed to update ticket. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const hasChanges = ticket && (updatedStatus !== ticket.status || updatedPriority !== ticket.priority);

  return (
    <>
      <Head>
        <title>{ticket ? `${ticket.ticketNumber} · Admin Support` : 'Admin Support'} · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer
          title={
            <Stack direction="row" alignItems="center" spacing={1}>
              <IconButton onClick={() => router.push('/admin/support')} size="small">
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="h5">
                {ticket ? ticket.ticketNumber : 'Loading...'}
              </Typography>
            </Stack>
          }
          subtitle={ticket?.subject || ''}
        >
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {loading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : ticket ? (
            <Grid container spacing={3}>
              {/* Main Content */}
              <Grid item xs={12} md={8}>
                <Card>
                  <CardContent>
                    <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
                      <Tab label="Conversation" />
                      <Tab label="Internal Notes" />
                    </Tabs>

                    <TabPanel value={tabValue} index={0}>
                      {/* Public Messages */}
                      <Stack
                        spacing={2}
                        sx={{
                          maxHeight: 400,
                          overflowY: 'auto',
                          pr: 1,
                          mb: 2,
                        }}
                      >
                        {ticket.messages && ticket.messages.filter(m => !m.isInternal).length > 0 ? (
                          ticket.messages
                            .filter(m => !m.isInternal)
                            .map((message) => {
                              const isSupport = message.senderEmail !== ticket.userEmail;
                              const displayName = isSupport
                                ? (message.senderEmail === user?.email ? (user?.firstName || 'You') : 'Support')
                                : (ticket.userFirstName || 'Customer');
                              return (
                                <Box
                                  key={message.id}
                                  sx={{
                                    display: 'flex',
                                    flexDirection: isSupport ? 'row-reverse' : 'row',
                                    gap: 1,
                                  }}
                                >
                                  <Avatar
                                    sx={{
                                      bgcolor: isSupport ? 'secondary.main' : 'grey.500',
                                      width: 32,
                                      height: 32,
                                    }}
                                  >
                                    {isSupport ? <SupportIcon fontSize="small" /> : <PersonIcon fontSize="small" />}
                                  </Avatar>
                                  <Box sx={{ maxWidth: '70%' }}>
                                    <Typography
                                      variant="caption"
                                      display="block"
                                      sx={{ color: 'text.secondary', textAlign: isSupport ? 'right' : 'left' }}
                                    >
                                      {displayName}
                                      {' · '}
                                      {format(new Date(message.createdAt), 'MMM d, h:mm a')}
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: isSupport ? 'right' : 'left' }}
                                    >
                                      {message.message}
                                    </Typography>
                                  </Box>
                                </Box>
                              );
                            })
                        ) : (
                          <Typography variant="body2" color="text.secondary" textAlign="center" py={2}>
                            No messages yet
                          </Typography>
                        )}
                        <div ref={messagesEndRef} />
                      </Stack>

                      {/* Reply Input */}
                      <Divider sx={{ my: 2 }} />
                      <Stack direction="row" spacing={1}>
                        <TextField
                          fullWidth
                          placeholder="Type your reply to the customer..."
                          multiline
                          maxRows={4}
                          value={replyMessage}
                          onChange={(e) => setReplyMessage(e.target.value)}
                          disabled={sending}
                        />
                        <IconButton
                          color="primary"
                          onClick={handleSendReply}
                          disabled={!replyMessage.trim() || sending}
                        >
                          {sending ? <CircularProgress size={24} /> : <SendIcon />}
                        </IconButton>
                      </Stack>
                    </TabPanel>

                    <TabPanel value={tabValue} index={1}>
                      {/* Internal Notes */}
                      <Stack
                        spacing={2}
                        sx={{
                          maxHeight: 400,
                          overflowY: 'auto',
                          pr: 1,
                          mb: 2,
                        }}
                      >
                        {ticket.messages && ticket.messages.filter(m => m.isInternal).length > 0 ? (
                          ticket.messages
                            .filter(m => m.isInternal)
                            .map((message) => {
                              const noteAuthor = message.senderEmail === user?.email
                                ? (user?.firstName || 'You')
                                : (message.senderName || 'Support');
                              return (
                                <Box key={message.id}>
                                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                                    <LockIcon fontSize="small" color="warning" />
                                    <Typography variant="caption" color="text.secondary">
                                      Internal Note · {noteAuthor}
                                      {' · '}
                                      {format(new Date(message.createdAt), 'MMM d, h:mm a')}
                                    </Typography>
                                  </Stack>
                                  <Typography
                                    variant="body2"
                                    sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                                  >
                                    {message.message}
                                  </Typography>
                                </Box>
                              );
                            })
                        ) : (
                          <Typography variant="body2" color="text.secondary" textAlign="center" py={2}>
                            No internal notes yet
                          </Typography>
                        )}
                      </Stack>

                      {/* Add Internal Note */}
                      <Divider sx={{ my: 2 }} />
                      <Stack direction="row" spacing={1}>
                        <TextField
                          fullWidth
                          placeholder="Add internal note (not visible to customer)..."
                          multiline
                          maxRows={4}
                          value={internalNote}
                          onChange={(e) => setInternalNote(e.target.value)}
                          disabled={sending}
                        />
                        <IconButton
                          color="warning"
                          onClick={handleAddInternalNote}
                          disabled={!internalNote.trim() || sending}
                        >
                          {sending ? <CircularProgress size={24} /> : <LockIcon />}
                        </IconButton>
                      </Stack>
                    </TabPanel>
                  </CardContent>
                </Card>
              </Grid>

              {/* Sidebar */}
              <Grid item xs={12} md={4}>
                <Stack spacing={2}>
                  {/* Ticket Info */}
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Ticket Details
                      </Typography>
                      <Stack spacing={2}>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Customer
                          </Typography>
                          <Typography variant="body2">
                            {ticket.userFirstName || ticket.userLastName
                              ? `${ticket.userFirstName || ''} ${ticket.userLastName || ''}`.trim()
                              : ticket.userEmail}
                          </Typography>
                          {(ticket.userFirstName || ticket.userLastName) && (
                            <Typography variant="caption" color="text.secondary">
                              {ticket.userEmail}
                            </Typography>
                          )}
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Category
                          </Typography>
                          <Typography variant="body2">
                            {ticket.category.charAt(0).toUpperCase() + ticket.category.slice(1)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Source
                          </Typography>
                          <Typography variant="body2">
                            {ticket.source.charAt(0).toUpperCase() + ticket.source.slice(1)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Created
                          </Typography>
                          <Typography variant="body2">
                            {format(new Date(ticket.createdAt), 'MMM d, yyyy h:mm a')}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Last Updated
                          </Typography>
                          <Typography variant="body2">
                            {format(new Date(ticket.updatedAt), 'MMM d, yyyy h:mm a')}
                          </Typography>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>

                  {/* Manage Ticket */}
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Manage Ticket
                      </Typography>
                      <Stack spacing={2}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Status</InputLabel>
                          <Select
                            value={updatedStatus}
                            label="Status"
                            onChange={(e) => setUpdatedStatus(e.target.value)}
                          >
                            <MenuItem value="open">Open</MenuItem>
                            <MenuItem value="in_progress">In Progress</MenuItem>
                            <MenuItem value="waiting">Waiting for Customer</MenuItem>
                            <MenuItem value="resolved">Resolved</MenuItem>
                            <MenuItem value="closed">Closed</MenuItem>
                          </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                          <InputLabel>Priority</InputLabel>
                          <Select
                            value={updatedPriority}
                            label="Priority"
                            onChange={(e) => setUpdatedPriority(e.target.value)}
                          >
                            <MenuItem value="low">Low</MenuItem>
                            <MenuItem value="normal">Normal</MenuItem>
                            <MenuItem value="high">High</MenuItem>
                            <MenuItem value="urgent">Urgent</MenuItem>
                          </Select>
                        </FormControl>
                        <Button
                          variant="contained"
                          startIcon={updating ? <CircularProgress size={16} /> : <SaveIcon />}
                          onClick={handleUpdateTicket}
                          disabled={!hasChanges || updating}
                          fullWidth
                        >
                          Save Changes
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                </Stack>
              </Grid>
            </Grid>
          ) : null}
        </PageContainer>
      </MainLayout>
    </>
  );
}

export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { redirectTo: '/login', requiredPermission: 'support:admin' });
