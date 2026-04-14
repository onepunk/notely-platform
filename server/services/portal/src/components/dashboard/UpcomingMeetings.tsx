import { Avatar, Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, List, ListItem, ListItemAvatar, ListItemText, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
import { resolveApiUrl } from '@/utils/api';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import { useRouter } from 'next/router';

interface Meeting {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  attendees_count: number;
  meeting_url?: string;
  calendar_provider?: string;
}

const formatMeetingTime = (startTime: string): string => {
  const date = parseISO(startTime);

  if (isToday(date)) {
    return `Today · ${format(date, 'h:mm a')}`;
  } else if (isTomorrow(date)) {
    return `Tomorrow · ${format(date, 'h:mm a')}`;
  } else {
    return format(date, 'EEE · h:mm a');
  }
};

const UpcomingMeetings = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchMeetings = async () => {
      try {
        // Get token from storage (same as authService)
        const token = sessionStorage.getItem('notely_token') || localStorage.getItem('notely_token');

        if (!token) {
          throw new Error('Not authenticated');
        }

        const response = await fetch(resolveApiUrl('/api/meetings/upcoming?limit=5'), {
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch meetings');
        }

        const result = await response.json();
        if (result.success) {
          setMeetings(result.data.meetings);
        } else {
          throw new Error(result.error || 'Failed to fetch meetings');
        }
      } catch (err) {
        console.error('Error fetching meetings:', err);
        setError(err instanceof Error ? err.message : 'Failed to load meetings');
      } finally {
        setLoading(false);
      }
    };

    fetchMeetings();
  }, []);

  const handleConnectCalendar = () => {
    router.push('/settings?tab=calendar');
  };

  if (loading) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardHeader
          title="Upcoming Meetings"
          subheader="Your scheduled meetings"
        />
        <Divider />
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardHeader
          title="Upcoming Meetings"
          subheader="Your scheduled meetings"
        />
        <Divider />
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 3,
            }}
          >
            <CalendarMonthIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography color="text.secondary" align="center" sx={{ mb: 2 }}>
              Connect your calendar to see upcoming meetings
            </Typography>
            <Button
              variant="contained"
              startIcon={<CalendarMonthIcon />}
              onClick={handleConnectCalendar}
            >
              Connect Calendar
            </Button>
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (meetings.length === 0) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardHeader
          title="Upcoming Meetings"
          subheader="Your scheduled meetings"
        />
        <Divider />
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 3,
            }}
          >
            <CalendarMonthIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography color="text.secondary" align="center">
              No upcoming meetings scheduled
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ height: '100%' }}>
      <CardHeader
        title="Upcoming Meetings"
        subheader="Your scheduled meetings"
      />
      <Divider />
      <CardContent sx={{ p: 0 }}>
        <List disablePadding>
          {meetings.map((meeting) => (
            <ListItem
              key={meeting.id}
              sx={{
                px: 3,
                py: 2,
                '&:not(:last-of-type)': {
                  borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                },
              }}
            >
              <ListItemAvatar>
                <Avatar sx={{ bgcolor: 'primary.main', color: '#fff' }}>
                  {meeting.title.slice(0, 2).toUpperCase()}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                disableTypography
                primary={
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {meeting.title}
                    </Typography>
                    {meeting.status === 'in_progress' && (
                      <Chip
                        size="small"
                        label="In Progress"
                        color="warning"
                      />
                    )}
                  </Stack>
                }
                secondary={
                  <Typography variant="body2" color="text.secondary">
                    {formatMeetingTime(meeting.start_time)} · {meeting.attendees_count} {meeting.attendees_count === 1 ? 'attendee' : 'attendees'}
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
};

export default UpcomingMeetings;
