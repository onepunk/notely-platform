/**
 * User Support Ticket Detail Page
 * View ticket details and conversation, add replies
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
  IconButton,
  Stack,
  TextField,
  Typography,
  Alert,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Send as SendIcon,
  Person as PersonIcon,
  Support as SupportIcon,
} from '@mui/icons-material';
import { supportClient, Ticket, Message } from '@/lib/supportClient';
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

export default function TicketDetailPage() {
  const router = useRouter();
  const { ticketId } = router.query;
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [sending, setSending] = useState(false);

  const loadTicket = async () => {
    if (!ticketId || typeof ticketId !== 'string') return;

    try {
      setLoading(true);
      setError(null);
      const data = await supportClient.getTicket(ticketId);
      setTicket(data);
    } catch (err: any) {
      clientLogger.error('[Support] Failed to load ticket', { error: err.message, ticketId });
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
    // Scroll to bottom when messages update
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
      clientLogger.error('[Support] Failed to send reply', { error: err.message, ticketId });
      toast.error('Failed to send reply. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const isTicketClosed = ticket?.status === 'closed' || ticket?.status === 'resolved';

  return (
    <>
      <Head>
        <title>{ticket ? `${ticket.ticketNumber} · Support` : 'Support'} · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer
          title={
            <Stack direction="row" alignItems="center" spacing={1}>
              <IconButton onClick={() => router.push('/support')} size="small">
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
            <Stack spacing={3}>
              {/* Ticket Info Card */}
              <Card>
                <CardContent>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
                      gap: 2,
                    }}
                  >
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Status
                      </Typography>
                      <Box sx={{ mt: 0.5 }}>
                        <Chip
                          label={formatStatus(ticket.status)}
                          color={STATUS_COLORS[ticket.status]}
                          size="small"
                        />
                      </Box>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Priority
                      </Typography>
                      <Box sx={{ mt: 0.5 }}>
                        <Chip
                          label={ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                          color={PRIORITY_COLORS[ticket.priority]}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Category
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {ticket.category.charAt(0).toUpperCase() + ticket.category.slice(1)}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Created
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {format(new Date(ticket.createdAt), 'MMM d, yyyy h:mm a')}
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>

              {/* Messages */}
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Conversation
                  </Typography>
                  <Divider sx={{ mb: 2 }} />

                  <Stack
                    spacing={2}
                    sx={{
                      maxHeight: 500,
                      overflowY: 'auto',
                      pr: 1,
                    }}
                  >
                    {ticket.messages && ticket.messages.length > 0 ? (
                      ticket.messages.map((message) => {
                        const isOwnMessage = message.senderEmail === user?.email;
                        const displayName = isOwnMessage
                          ? (user?.firstName || 'You')
                          : 'Support';
                        return (
                          <Box
                            key={message.id}
                            sx={{
                              display: 'flex',
                              flexDirection: isOwnMessage ? 'row-reverse' : 'row',
                              gap: 1,
                            }}
                          >
                            <Avatar
                              sx={{
                                bgcolor: isOwnMessage ? 'primary.main' : 'grey.500',
                                width: 32,
                                height: 32,
                              }}
                            >
                              {isOwnMessage ? <PersonIcon fontSize="small" /> : <SupportIcon fontSize="small" />}
                            </Avatar>
                            <Box sx={{ maxWidth: '70%' }}>
                              <Typography
                                variant="caption"
                                display="block"
                                sx={{ color: 'text.secondary', textAlign: isOwnMessage ? 'right' : 'left' }}
                              >
                                {displayName}
                                {' · '}
                                {format(new Date(message.createdAt), 'MMM d, h:mm a')}
                              </Typography>
                              <Typography
                                variant="body2"
                                sx={{
                                  mt: 0.5,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  textAlign: isOwnMessage ? 'right' : 'left',
                                }}
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
                  {isTicketClosed ? (
                    <Alert severity="info">
                      This ticket has been {ticket.status}. You cannot add more replies.
                    </Alert>
                  ) : (
                    <Stack direction="row" spacing={1}>
                      <TextField
                        fullWidth
                        placeholder="Type your reply..."
                        multiline
                        maxRows={4}
                        value={replyMessage}
                        onChange={(e) => setReplyMessage(e.target.value)}
                        onKeyPress={handleKeyPress}
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
                  )}
                </CardContent>
              </Card>
            </Stack>
          ) : null}
        </PageContainer>
      </MainLayout>
    </>
  );
}

export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { redirectTo: '/login', requiredPermission: 'support:user' });
