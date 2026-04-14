import { Card, CardContent, Stack, Typography } from '@mui/material';
import { ReactNode } from 'react';

type StatCardProps = {
  label: string;
  value: string;
  trend?: string;
  icon?: ReactNode;
};

const StatCard = ({ label, value, trend, icon }: StatCardProps) => (
  <Card>
    <CardContent>
      <Stack direction="row" spacing={2} alignItems="center">
        {icon ? <Stack sx={{ color: 'primary.main' }}>{icon}</Stack> : null}
        <Stack spacing={0.5}>
          <Typography variant="subtitle2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h4">{value}</Typography>
          {trend ? (
            <Typography variant="caption" color="success.main">
              {trend}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </CardContent>
  </Card>
);

export default StatCard;
