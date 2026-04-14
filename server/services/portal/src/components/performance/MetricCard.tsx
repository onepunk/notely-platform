/**
 * Metric Card Component
 * Displays a system metric with a progress bar (Mantis theme style)
 */

import { ReactNode } from 'react';
import {
  Card,
  CardContent,
  Stack,
  Box,
  Typography,
  LinearProgress,
  Chip,
} from '@mui/material';

interface MetricCardProps {
  title: string;
  icon: ReactNode;
  value: number;
  max?: number;
  unit?: string;
  subtitle?: string;
  color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
}

const MetricCard = ({
  title,
  icon,
  value,
  max = 100,
  unit = '%',
  subtitle,
  color,
}: MetricCardProps) => {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  // Auto-determine color based on percentage if not provided
  const getColor = (): 'primary' | 'success' | 'warning' | 'error' | 'info' => {
    if (color) return color;
    if (percentage >= 90) return 'error';
    if (percentage >= 75) return 'warning';
    if (percentage >= 50) return 'info';
    return 'success';
  };

  const barColor = getColor();

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box sx={{ color: `${barColor}.main` }}>{icon}</Box>
            <Box flex={1}>
              <Typography variant="subtitle2" color="text.secondary">
                {title}
              </Typography>
              <Stack direction="row" alignItems="baseline" spacing={0.5}>
                <Typography variant="h4">{value.toFixed(1)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {unit}
                </Typography>
                {max !== 100 && (
                  <Typography variant="caption" color="text.secondary">
                    / {max}
                    {unit}
                  </Typography>
                )}
              </Stack>
            </Box>
            <Chip
              label={`${percentage.toFixed(0)}%`}
              size="small"
              color={barColor}
            />
          </Stack>

          <Box>
            <LinearProgress
              variant="determinate"
              value={percentage}
              color={barColor}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>

          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default MetricCard;
