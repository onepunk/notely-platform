/**
 * Panel showing recent license validations
 */

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Stack,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Box,
} from '@mui/material';
import { CheckCircle as ValidIcon, Cancel as InvalidIcon } from '@mui/icons-material';
import type { LicenseValidation } from '@/types/license';
import { licenseClient } from '@/lib/licenseClient';
import { format } from 'date-fns';

export function ValidationHistoryPanel() {
  const [validations, setValidations] = useState<LicenseValidation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchValidations = async () => {
      try {
        const response = await licenseClient.getValidations({ limit: 10 });
        setValidations(response.validations);
      } catch (err) {
        console.error('Failed to fetch validations:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchValidations();
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Recent Validations
        </Typography>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Service</TableCell>
                <TableCell>IP Address</TableCell>
                <TableCell>Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {validations.map((validation) => (
                <TableRow key={validation.id}>
                  <TableCell>
                    <Chip
                      size="small"
                      icon={validation.is_valid ? <ValidIcon /> : <InvalidIcon />}
                      label={validation.is_valid ? 'Valid' : 'Invalid'}
                      color={validation.is_valid ? 'success' : 'error'}
                    />
                  </TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>
                    {validation.validation_type}
                  </TableCell>
                  <TableCell>{validation.validated_by_service}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {validation.ip_address || '-'}
                  </TableCell>
                  <TableCell>
                    {format(new Date(validation.validated_at), 'PPp')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
