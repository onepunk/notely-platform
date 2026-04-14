/**
 * Calendar Page
 * Displays user's calendar events with mini calendar and week view
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { PickersDay, type PickersDayProps } from '@mui/x-date-pickers/PickersDay';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import { useAuth } from '@/contexts/AuthContext';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

interface CalendarStatus {
  connected: boolean;
  syncStatus?: string | null;
  lastSyncTime?: string | null;
  errorMessage?: string | null;
}

interface CalendarEvent {
  id: string;
  subject: string;
  startDate: Date;
  endDate: Date;
  meetingUrl?: string | null;
  location?: string | null;
}

function normalizeDate(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type CalendarDayProps = PickersDayProps<Date> & {
  eventsByDate?: Map<string, CalendarEvent[]>;
};

function CalendarDay(props: CalendarDayProps) {
  const { day, eventsByDate, outsideCurrentMonth, ...rest } = props;
  const eventsMap = eventsByDate ?? new Map<string, CalendarEvent[]>();
  const key = normalizeDate(day).toDateString();
  const hasEvents = eventsMap.has(key);
  const today = normalizeDate(new Date());

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <PickersDay
        {...rest}
        day={day}
        outsideCurrentMonth={outsideCurrentMonth}
        disableMargin
        sx={{
          ...(isSameDay(day, today) && {
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': {
              backgroundColor: 'primary.dark',
            },
          }),
          ...(hasEvents && {
            fontWeight: 600,
          }),
        }}
      />
      {hasEvents && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 4,
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: isSameDay(day, today) ? 'primary.contrastText' : 'primary.main',
          }}
        />
      )}
    </Box>
  );
}

export default function CalendarPage() {
  const router = useRouter();
  const { user } = useAuth();
  const calendarRef = useRef<any>(null);
  const consentPopupRef = useRef<Window | null>(null);

  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [visibleMonth, setVisibleMonth] = useState<Date>(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  // Group events by date for mini calendar indicators
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((event) => {
      const startDate = normalizeDate(event.startDate);
      const endDate = normalizeDate(event.endDate);
      const cursor = new Date(startDate);

      while (cursor <= endDate) {
        const key = cursor.toDateString();
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.get(key)!.push(event);
        cursor.setDate(cursor.getDate() + 1);
      }
    });

    map.forEach((value) => {
      value.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    });

    return map;
  }, [events]);

  // Transform events for FullCalendar
  const fullCalendarEvents = useMemo(() => {
    return events.map((event) => ({
      id: event.id,
      title: event.subject,
      start: event.startDate,
      end: event.endDate,
      url: event.meetingUrl || undefined,
      extendedProps: {
        location: event.location,
        meetingUrl: event.meetingUrl,
      },
    }));
  }, [events]);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiRequest<{ data: CalendarStatus }>('/api/outlook/status');

      setStatus({
        connected: !!data.data?.connected,
        syncStatus: data.data?.syncStatus || null,
        lastSyncTime: data.data?.lastSyncTime || null,
        errorMessage: data.data?.errorMessage || null,
      });
    } catch (error: any) {
      // Only redirect to login for true authentication failures (401 with valid reason)
      // Do NOT redirect for service unavailable errors (502, 503)
      if (error instanceof AuthenticationError) {
        // Check if this is a real auth failure or just a missing service
        const statusCode = error.status;
        if (statusCode === 401 && error.message?.includes('token')) {
          clientLogger.warn('Authentication token invalid, redirecting to login');
          toast.error('Session expired. Please log in again.');
          router.push('/login');
          return;
        }
        // For other 401s (like missing endpoint), treat as service unavailable
        clientLogger.info('Calendar service auth check failed, treating as unavailable', { error: error.message });
      }

      if (error instanceof AuthorizationError) {
        clientLogger.warn('Access denied to calendar status');
        toast.error('You do not have permission to access calendar');
        return;
      }

      // For all other errors (including 502/503), just show calendar as disconnected
      clientLogger.info('Calendar status unavailable:', { error: error instanceof Error ? error.message : String(error) });
      setStatus({
        connected: false,
        errorMessage: 'Calendar service is currently unavailable'
      });
    }
  }, [router]);

  const loadEvents = useCallback(
    async (monthDate: Date, options: { bypassCache?: boolean } = {}) => {
      if (!user?.id) return;

      try {
        setLoading(true);
        setError(null);

        const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const monthEnd = new Date(
          monthDate.getFullYear(),
          monthDate.getMonth() + 1,
          0,
          23,
          59,
          59,
          999
        );

        const params = new URLSearchParams({
          startTime: monthStart.toISOString(),
          endTime: monthEnd.toISOString(),
          maxResults: '200',
        });

        if (user?.timezone) {
          params.set('timezone', user.timezone);
        }

        if (options.bypassCache) {
          params.set('useCache', 'false');
          params.set('forceRefresh', 'true');
        }

        const data = await apiRequest<{ data: any[] }>(
          `/api/calendar/users/${user.id}/events?${params.toString()}`
        );

        const eventList: any[] = Array.isArray(data.data) ? data.data : [];
        const mapped: CalendarEvent[] = eventList
          .map((event) => {
            const startTime =
              event?.start?.dateTime || event?.startTime || event?.start;
            const endTime = event?.end?.dateTime || event?.endTime || event?.end;

            let normalizedStart = startTime;
            let normalizedEnd = endTime;

            if (typeof normalizedStart === 'string' && !/[Z+-]/.test(normalizedStart)) {
              normalizedStart = `${normalizedStart}Z`;
            }

            if (typeof normalizedEnd === 'string' && !/[Z+-]/.test(normalizedEnd)) {
              normalizedEnd = `${normalizedEnd}Z`;
            }

            const startDate = normalizedStart ? new Date(normalizedStart) : new Date();
            const endDate = normalizedEnd
              ? new Date(normalizedEnd)
              : new Date(startDate.getTime() + 30 * 60 * 1000);

            return {
              id:
                event?.id ||
                `${event?.subject || 'event'}-${startDate.toISOString()}`,
              subject: event?.subject || event?.title || 'Untitled meeting',
              startDate,
              endDate,
              meetingUrl:
                event?.onlineMeetingUrl ||
                event?.meetingUrl ||
                event?.joinUrl ||
                event?.joinWebUrl ||
                null,
              location: event?.location?.displayName || event?.location || null,
            };
          })
          .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

        setEvents(mapped);
      } catch (error: any) {
        if (error instanceof AuthenticationError) {
          clientLogger.warn('Authentication required, redirecting to login');
          toast.error('Session expired. Please log in again.');
          router.push('/login');
          return;
        }

        if (error instanceof AuthorizationError) {
          clientLogger.warn('Access denied to calendar events');
          toast.error('You do not have permission to access calendar events');
          return;
        }

        clientLogger.error('Failed to load events:', { error: error instanceof Error ? error.message : String(error) });
        setError(error.message || 'Failed to load calendar events');
        setEvents([]);
      } finally {
        setLoading(false);
      }
    },
    [user?.id, user?.timezone, router]
  );

  const handleSync = useCallback(async () => {
    try {
      setSyncing(true);
      setError(null);

      // Immediately reload events from database with cache bypass
      await loadEvents(visibleMonth, { bypassCache: true });
      await loadStatus();

      // Trigger background sync to fetch from Microsoft and save to database
      // Fire and forget - we don't wait for the response
      apiRequest('/api/outlook/sync', {
        method: 'POST',
        body: {},
      }).catch((error) => {
        // Log errors silently without showing to user
        clientLogger.error('Background calendar sync failed:', { error: error instanceof Error ? error.message : String(error) });
      });

    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        clientLogger.warn('Authentication required, redirecting to login');
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }

      if (error instanceof AuthorizationError) {
        clientLogger.warn('Access denied to calendar sync');
        toast.error('You do not have permission to sync calendar');
        return;
      }

      clientLogger.error('Calendar refresh failed:', { error: error instanceof Error ? error.message : String(error) });
      setError(error.message || 'Failed to refresh calendar');
      toast.error(error.message || 'Failed to refresh calendar');
    } finally {
      setSyncing(false);
    }
  }, [loadStatus, loadEvents, visibleMonth, router]);

  const handleConnect = useCallback(async () => {
    try {
      const data = await apiRequest<{ data: { authUrl: string } }>('/api/outlook/auth');

      if (!data.data?.authUrl) {
        throw new Error('Failed to get calendar connection URL');
      }

      const popupWidth = 640;
      const popupHeight = 720;
      const left = Math.round((window.screen.width - popupWidth) / 2);
      const top = Math.round((window.screen.height - popupHeight) / 2);

      const popup = window.open(
        data.data.authUrl,
        'notely-calendar-consent',
        `width=${popupWidth},height=${popupHeight},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );

      if (popup) {
        consentPopupRef.current = popup;
      } else {
        setError('Pop-up blocked. Please allow pop-ups and try again.');
      }
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        clientLogger.warn('Authentication required, redirecting to login');
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }

      if (error instanceof AuthorizationError) {
        clientLogger.warn('Access denied to calendar connection');
        toast.error('You do not have permission to connect calendar');
        return;
      }

      clientLogger.error('Failed to connect calendar:', { error: error instanceof Error ? error.message : String(error) });
      setError(error.message || 'Failed to connect calendar');
    }
  }, [router]);

  const handleCalendarMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof window === 'undefined') return;
      if (event.origin !== window.location.origin) return;

      const data = event.data as {
        type?: string;
        success?: boolean;
        error?: string;
      } | null;

      if (!data || data.type !== 'outlook-connect-result') return;

      if (consentPopupRef.current && !consentPopupRef.current.closed) {
        consentPopupRef.current.close();
      }
      consentPopupRef.current = null;

      if (data.success) {
        toast.success('Calendar connected successfully');
        // Load status first, then events will be loaded automatically
        loadStatus();
        loadEvents(visibleMonth, { bypassCache: true });
      } else {
        setError(data.error || 'Calendar connection was not completed');
      }
    },
    [loadStatus, loadEvents, visibleMonth]
  );

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    // Load events from database when status changes or month changes
    if (status?.connected) {
      loadEvents(visibleMonth);
    }
  }, [status?.connected, loadEvents, visibleMonth]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    window.addEventListener('message', handleCalendarMessage);
    return () => {
      window.removeEventListener('message', handleCalendarMessage);
      if (consentPopupRef.current && !consentPopupRef.current.closed) {
        consentPopupRef.current.close();
      }
    };
  }, [handleCalendarMessage]);

  const handleDateSelect = (date: Date | null) => {
    if (!date) return;
    const normalized = normalizeDate(date);
    setSelectedDate(normalized);

    // Navigate FullCalendar to the selected date
    if (calendarRef.current) {
      const calendarApi = calendarRef.current.getApi();
      calendarApi.gotoDate(normalized);
    }
  };

  const handleMonthChange = (date: Date) => {
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    setVisibleMonth(firstOfMonth);
  };

  return (
    <>
      <Head>
        <title>Calendar · Notely</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Calendar"
          subtitle={
            status?.connected
              ? 'View and manage your upcoming meetings'
              : 'Connect your calendar to get started'
          }
          action={
            status?.connected ? (
              <Tooltip title="Sync Calendar">
                <IconButton
                  onClick={handleSync}
                  disabled={loading || syncing}
                  color={syncing ? "default" : "primary"}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            ) : (
              <Button variant="contained" onClick={handleConnect}>
                Connect Calendar
              </Button>
            )
          }
        >
          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', lg: 'row' } }}>
            {/* Mini Calendar */}
            <Card sx={{ flex: '0 0 auto', width: { xs: '100%', lg: 350 } }}>
              <CardContent>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DateCalendar
                    value={selectedDate}
                    onChange={handleDateSelect}
                    onMonthChange={handleMonthChange}
                    slots={{ day: CalendarDay }}
                    slotProps={{ day: { eventsByDate } as any }}
                    sx={{
                      width: '100%',
                      '& .MuiPickersCalendarHeader-root': {
                        paddingLeft: 1,
                        paddingRight: 1,
                      },
                    }}
                  />
                </LocalizationProvider>

                {status?.lastSyncTime && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                    Last synced:{' '}
                    {new Date(status.lastSyncTime).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Typography>
                )}
              </CardContent>
            </Card>

            {/* Week View */}
            <Card sx={{ flex: 1, minWidth: 0 }}>
              <CardContent>
                {!status?.connected ? (
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      py: 8,
                      px: 2,
                    }}
                  >
                    <Typography variant="h6" gutterBottom>
                      No calendar connected
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                      Connect your calendar to view and manage your meetings
                    </Typography>
                    <Button variant="contained" onClick={handleConnect}>
                      Connect Calendar
                    </Button>
                  </Box>
                ) : loading ? (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      py: 8,
                    }}
                  >
                    <CircularProgress />
                  </Box>
                ) : (
                  <FullCalendar
                    ref={calendarRef}
                    plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
                    initialView="timeGridWeek"
                    initialDate={selectedDate}
                    headerToolbar={{
                      left: 'prev,next today',
                      center: 'title',
                      right: 'timeGridWeek,timeGridDay',
                    }}
                    slotMinTime="06:00:00"
                    slotMaxTime="22:00:00"
                    height="auto"
                    events={fullCalendarEvents}
                    eventClick={(info) => {
                      if (info.event.url) {
                        window.open(info.event.url, '_blank', 'noopener,noreferrer');
                        info.jsEvent.preventDefault();
                      }
                    }}
                    eventContent={(arg) => {
                      // Display meeting title instead of time
                      // (time is already indicated by position in calendar)
                      return (
                        <Box
                          sx={{
                            padding: '2px 4px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: '0.85em',
                            cursor: arg.event.url ? 'pointer' : 'default',
                          }}
                        >
                          {arg.event.title}
                        </Box>
                      );
                    }}
                    allDaySlot={false}
                    slotDuration="00:30:00"
                    slotLabelInterval="01:00:00"
                    nowIndicator={true}
                    scrollTime="08:00:00"
                    expandRows={true}
                    stickyHeaderDates={true}
                  />
                )}
              </CardContent>
            </Card>
          </Box>
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'calendar:read' });
