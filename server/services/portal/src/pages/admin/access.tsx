/**
 * Access Control Admin Page
 * Configure route-to-role permissions dynamically
 * Features: category filter, compact rows, no Permission column
 */

import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import clientLogger from '@/lib/clientLogger';
import {
  Box,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  Tooltip,
  IconButton,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import toast from 'react-hot-toast';
import {
  apiRequest,
  AuthenticationError,
  AuthorizationError,
} from '@/utils/api';

interface RoutePermission {
  id: number;
  route_path: string;
  description: string;
  permission_resource: string | null;
  permission_action: string | null;
  permission_code: string | null;
  allowed_roles: string[];
  is_active: boolean;
  route_category: string;
}

interface UserRole {
  value: string;
  label: string;
  description: string;
}

type CategoryFilter = 'all' | 'user' | 'admin';

export default function AccessControlPage() {
  const router = useRouter();
  const [routes, setRoutes] = useState<RoutePermission[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<{ [key: string]: boolean }>({});
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [routesData, rolesData] = await Promise.all([
        apiRequest<{ success: boolean; data: RoutePermission[] }>(
          '/api/admin/access-control/routes'
        ),
        apiRequest<{ success: boolean; data: UserRole[] }>(
          '/api/admin/access-control/roles'
        ),
      ]);

      setRoutes(routesData.data);
      setRoles(rolesData.data);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (error instanceof AuthorizationError) {
        toast.error('You do not have permission to access this page.');
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load access control data';
        toast.error(errorMessage);
        clientLogger.error('Failed to fetch access control data', { error });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredRoutes = useMemo(() => {
    if (categoryFilter === 'all') return routes;
    return routes.filter(r => r.route_category === categoryFilter);
  }, [routes, categoryFilter]);

  const handleToggleRole = async (routeId: number, role: string, currentlyAllowed: boolean) => {
    const route = routes.find(r => r.id === routeId);
    if (!route) return;

    setSaving({ ...saving, [`${routeId}-${role}`]: true });

    try {
      let newAllowedRoles: string[];
      if (currentlyAllowed) {
        newAllowedRoles = route.allowed_roles.filter(r => r !== role);
      } else {
        newAllowedRoles = [...route.allowed_roles, role];
      }

      await apiRequest<{ success: boolean }>(
        `/api/admin/access-control/routes/${routeId}/roles`,
        {
          method: 'PATCH',
          body: { allowedRoles: newAllowedRoles },
        }
      );

      setRoutes(routes.map(r =>
        r.id === routeId
          ? { ...r, allowed_roles: newAllowedRoles }
          : r
      ));

      toast.success(`Permissions updated for ${route.route_path}`);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (error instanceof AuthorizationError) {
        toast.error('You do not have permission to modify permissions.');
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update permissions';
        toast.error(errorMessage);
        clientLogger.error('Failed to update permissions', { error, routeId, role });
      }
    } finally {
      setSaving({ ...saving, [`${routeId}-${role}`]: false });
    }
  };

  return (
    <>
      <Head>
        <title>Access Control · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Access Control"
          subtitle="Configure route permissions and role-based access"
          action={
            <Tooltip title="Refresh">
              <IconButton onClick={fetchData} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          }
        >
          {/* Category filter */}
          <Box sx={{ mb: 2 }}>
            <ToggleButtonGroup
              value={categoryFilter}
              exclusive
              onChange={(_, value) => { if (value) setCategoryFilter(value); }}
              size="small"
            >
              <ToggleButton value="all">All</ToggleButton>
              <ToggleButton value="user">User Pages</ToggleButton>
              <ToggleButton value="admin">Admin Pages</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Card sx={{ borderRadius: 1 }}>
            <TableContainer>
              <Table sx={{ minWidth: 600 }} size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', py: 1 }}>
                      Route
                    </TableCell>
                    <TableCell sx={{ fontWeight: 'bold', py: 1 }}>
                      Description
                    </TableCell>
                    {roles.map(role => (
                      <TableCell
                        key={role.value}
                        align="center"
                        sx={{ fontWeight: 'bold', py: 1, minWidth: 80 }}
                      >
                        <Tooltip title={role.description}>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 600, cursor: 'help' }}
                          >
                            {role.label}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={2 + roles.length} align="center">
                        <Typography color="text.secondary">Loading...</Typography>
                      </TableCell>
                    </TableRow>
                  ) : filteredRoutes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2 + roles.length} align="center">
                        <Typography color="text.secondary">
                          No routes configured
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRoutes.map(route => (
                      <TableRow key={route.id} hover>
                        <TableCell sx={{ py: 0.5 }}>
                          <Typography
                            variant="body2"
                            sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                          >
                            {route.route_path}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 0.5 }}>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {route.description}
                          </Typography>
                        </TableCell>
                        {roles.map(role => {
                          const isAllowed = route.allowed_roles.includes(role.value);
                          const savingKey = `${route.id}-${role.value}`;
                          return (
                            <TableCell key={role.value} align="center" sx={{ py: 0.5 }}>
                              <Checkbox
                                checked={isAllowed}
                                disabled={saving[savingKey]}
                                onChange={() =>
                                  handleToggleRole(route.id, role.value, isAllowed)
                                }
                                color="primary"
                                size="small"
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            {filteredRoutes.length > 0 && (
              <Box sx={{ px: 2, py: 1, bgcolor: 'background.default', borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">
                  {filteredRoutes.length} route{filteredRoutes.length !== 1 ? 's' : ''}
                  {categoryFilter !== 'all' ? ` (${categoryFilter})` : ''}
                </Typography>
              </Box>
            )}
          </Card>
        </PageContainer>
      </MainLayout>
    </>
  );
}

export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'system:admin' });
