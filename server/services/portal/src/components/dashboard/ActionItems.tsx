import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded';
import { Avatar, Card, CardContent, CardHeader, Chip, List, ListItem, ListItemAvatar, ListItemText, Stack, Typography } from '@mui/material';

const actions = [
  {
    id: 'action-1',
    title: 'Send follow-up summary to ACME',
    due: 'Due today',
    owner: 'Samantha',
    status: 'Pending',
  },
  {
    id: 'action-2',
    title: 'Upload meeting recording',
    due: 'Due tomorrow',
    owner: 'Jordan',
    status: 'Blocked',
  },
  {
    id: 'action-3',
    title: 'Confirm next steps with RevOps',
    due: 'Completed',
    owner: 'Kevin',
    status: 'Done',
  },
];

const statusChipMap: Record<string, { label: string; color: 'default' | 'primary' | 'secondary' | 'error' | 'success'; icon?: React.ReactNode }> = {
  Pending: {
    label: 'Pending',
    color: 'secondary',
    icon: <PendingActionsRoundedIcon fontSize="small" />,
  },
  Blocked: {
    label: 'Blocked',
    color: 'error',
  },
  Done: {
    label: 'Done',
    color: 'success',
    icon: <CheckCircleRoundedIcon fontSize="small" />,
  },
};

const ActionItems = () => (
  <Card>
    <CardHeader title="Action Items" subheader="Smart follow-ups from your latest meetings" />
    <CardContent sx={{ pt: 0 }}>
      <List disablePadding>
        {actions.map((action) => (
          <ListItem
            key={action.id}
            disableGutters
            sx={{
              py: 2,
              borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
              '&:last-of-type': {
                borderBottom: 'none',
              },
            }}
          >
            <ListItemAvatar>
              <Avatar sx={{ bgcolor: 'secondary.light', color: 'secondary.dark' }}>
                {action.owner.slice(0, 1)}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              disableTypography
              primary={
                <Typography variant="subtitle1" fontWeight={600}>
                  {action.title}
                </Typography>
              }
              secondary={
                <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
                  <Typography variant="body2" color="text.secondary">
                    {action.due}
                  </Typography>
                  <Chip
                    size="small"
                    color={statusChipMap[action.status]?.color ?? 'default'}
                    {...(statusChipMap[action.status]?.icon && {
                      icon: statusChipMap[action.status].icon as React.ReactElement,
                    })}
                    label={statusChipMap[action.status]?.label ?? action.status}
                  />
                </Stack>
              }
            />
          </ListItem>
        ))}
      </List>
    </CardContent>
  </Card>
);

export default ActionItems;
