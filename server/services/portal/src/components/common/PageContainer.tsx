import { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

type PageContainerProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
};

const PageContainer = ({ title, subtitle, action, children }: PageContainerProps) => (
  <Stack spacing={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2} justifyContent="space-between">
      <Box>
        <Typography variant="h3" color="text.secondary">{title}</Typography>
        {subtitle ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box>{action}</Box> : null}
    </Stack>
    <Box>{children}</Box>
  </Stack>
);

export default PageContainer;
