/**
 * Admin Users Management Page
 * Unified view of registered users and beta signups, one row per email.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES, isAdmin } from '@notely/shared/constants/roles';
import clientLogger from '@/lib/clientLogger';
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  FormControlLabel,
  RadioGroup,
  Radio,
  Checkbox,
  Grid,
  Divider,
  InputAdornment,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  MoreVert as MoreVertIcon,
} from '@mui/icons-material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

interface BetaDetail {
  signupId: string;
  status: string;
  displayStatus: string;
  signedUpAt: string | null;
  invitationSentAt: string | null;
  hasActiveToken: boolean;
  tokenExpired: boolean;
}

interface UnifiedUser {
  id: string;
  rowType: 'registered' | 'beta_only';
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  isActive: boolean | null;
  emailVerified: boolean | null;
  isProtected: boolean | null;
  createdAt: string | null;
  lastLogin: string | null;
  licenseType: string | null;
  licenseExpiresAt: string | null;
  grantType: string | null;
  isBeta: boolean;
  cloudBeta: BetaDetail | null;
  aiBeta: BetaDetail | null;
  status: 'registered' | 'suspended' | 'invited' | 'pending';
}

interface UserLicense {
  id: string;
  licenseType: string;
  tierKey: string;
  tierName: string;
  grantType: string;
  status: 'active' | 'revoked' | 'expired';
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  features: string[];
  notes: string | null;
  daysRemaining: number | null;
}

interface EditUserFormData {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  password?: string;
}

export default function AdminUsersPage() {
  const router = useRouter();

  // Unified data
  const [users, setUsers] = useState<UnifiedUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [betaFilter, setBetaFilter] = useState<string>('all');

  // Sorting
  type SortKey = 'name' | 'email' | 'role' | 'status' | 'license' | 'verified' | 'created' | 'lastLogin';
  const [sortBy, setSortBy] = useState<SortKey>('created');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Action menu
  const [selectedUser, setSelectedUser] = useState<UnifiedUser | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<null | HTMLElement>(null);

  // Per-user license data (fetched when action menu opens)
  const [menuLicenses, setMenuLicenses] = useState<UserLicense[]>([]);
  const [menuLicensesLoading, setMenuLicensesLoading] = useState(false);

  // Multi-select
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<{
    type: 'bulkRevoke' | 'bulkDelete' | 'bulkSuspend' | 'bulkGrantBeta' | 'bulkResetActivations';
  } | null>(null);
  const [bulkActionInProgress, setBulkActionInProgress] = useState(false);

  // Per-user license action confirmation
  const [confirmAction, setConfirmAction] = useState<{
    type: 'revoke' | 'resetActivation' | 'revokeAll' | 'reissueDesktop' | 'reissueAi' | 'grantBeta';
    licenseId?: string;
    productLabel?: string;
  } | null>(null);
  const [confirmActionLoading, setConfirmActionLoading] = useState(false);

  // User action dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editFormData, setEditFormData] = useState<EditUserFormData>({
    firstName: '',
    lastName: '',
    email: '',
    role: 'user',
    password: ''
  });
  const [passwordMode, setPasswordMode] = useState<'none' | 'auto' | 'manual'>('none');

  // Beta action dialogs
  const [sendInvitationDialogOpen, setSendInvitationDialogOpen] = useState(false);
  const [invitationSending, setInvitationSending] = useState(false);
  const [sendAiInvitationDialogOpen, setSendAiInvitationDialogOpen] = useState(false);
  const [aiInvitationSending, setAiInvitationSending] = useState(false);
  const [bccAdminOnInvitation, setBccAdminOnInvitation] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertProduct, setConvertProduct] = useState<'cloud' | 'ai'>('cloud');
  const [convertInProgress, setConvertInProgress] = useState(false);
  const [deleteSignupDialogOpen, setDeleteSignupDialogOpen] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [addSignupDialogOpen, setAddSignupDialogOpen] = useState(false);
  const [addSignupFormData, setAddSignupFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    product: 'cloud' as 'cloud' | 'ai'
  });
  const [addSignupInProgress, setAddSignupInProgress] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────

  const fetchUsers = async () => {
    setLoading(true);
    setSelectedUserIds(new Set());
    try {
      const data = await apiRequest<UnifiedUser[]>('/api/portal/admin/users/unified');
      setUsers(Array.isArray(data) ? data : []);
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        clientLogger.warn('Authentication required, redirecting to login');
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (error instanceof AuthorizationError) {
        clientLogger.warn('Access denied to users list');
        toast.error('You do not have permission to view users');
        return;
      }
      clientLogger.error('Failed to fetch users:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // ── Action menu ────────────────────────────────────────────────────

  const handleActionMenuOpen = async (event: React.MouseEvent<HTMLElement>, user: UnifiedUser) => {
    setSelectedUser(user);
    setActionMenuAnchor(event.currentTarget);
    setMenuLicenses([]);
    setMenuLicensesLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; licenses: UserLicense[] }>(
        `/api/license/admin/user/${user.id}/licenses`
      );
      setMenuLicenses(res.licenses || []);
    } catch { /* silent — license menu items stay disabled */ }
    finally { setMenuLicensesLoading(false); }
  };

  const handleActionMenuClose = () => {
    setActionMenuAnchor(null);
  };

  // ── User actions ───────────────────────────────────────────────────

  const handleSuspendUser = async () => {
    if (!selectedUser || selectedUser.rowType !== 'registered') return;
    try {
      await apiRequest<{ success: boolean }>(
        `/api/users/${selectedUser.id}/toggle-active`,
        { method: 'PATCH' }
      );
      toast.success(`User ${selectedUser.isActive ? 'suspended' : 'activated'}`);
      fetchUsers();
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (error instanceof AuthorizationError) {
        toast.error('You do not have permission to suspend users');
        return;
      }
      clientLogger.error('Failed to suspend user:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to suspend user');
    } finally {
      setSuspendDialogOpen(false);
      handleActionMenuClose();
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser || selectedUser.rowType !== 'registered') return;
    try {
      await apiRequest<{ success: boolean }>(
        `/api/users/${selectedUser.id}`,
        { method: 'DELETE' }
      );
      toast.success('User deleted successfully');
      fetchUsers();
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (error instanceof AuthorizationError) {
        toast.error('You do not have permission to delete users');
        return;
      }
      clientLogger.error('Failed to delete user:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to delete user');
    } finally {
      setDeleteDialogOpen(false);
      handleActionMenuClose();
    }
  };

  const handleOpenEditDialog = () => {
    if (!selectedUser || selectedUser.rowType !== 'registered') return;
    setEditFormData({
      firstName: selectedUser.firstName || '',
      lastName: selectedUser.lastName || '',
      email: selectedUser.email,
      role: selectedUser.role || 'user',
      password: ''
    });
    setPasswordMode('none');
    setEditDialogOpen(true);
    handleActionMenuClose();
  };

  const handleSaveUser = async () => {
    if (!selectedUser || selectedUser.rowType !== 'registered') return;
    try {
      const payload: any = {
        firstName: editFormData.firstName,
        lastName: editFormData.lastName,
        email: editFormData.email,
        role: editFormData.role
      };

      if (passwordMode === 'auto') {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';
        for (let i = 0; i < 12; i++) {
          password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        payload.password = password;
      } else if (passwordMode === 'manual' && editFormData.password) {
        payload.password = editFormData.password;
      }

      await apiRequest<{ success: boolean }>(
        `/api/users/${selectedUser.id}`,
        { method: 'PUT', body: payload }
      );

      toast.success('User updated successfully');
      if (passwordMode === 'auto') {
        toast.success(`New password: ${payload.password}`, { duration: 10000 });
      }
      fetchUsers();
      setEditDialogOpen(false);
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (error instanceof AuthorizationError) {
        toast.error('You do not have permission to update users');
        return;
      }
      clientLogger.error('Failed to update user:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to update user');
    }
  };

  // ── License action confirmation handler ─────────────────────────────

  const handleConfirmAction = async () => {
    if (!confirmAction || !selectedUser) return;
    setConfirmActionLoading(true);
    try {
      switch (confirmAction.type) {
        case 'revoke': {
          if (confirmAction.licenseId) {
            await apiRequest<{ success: boolean }>(
              `/api/license/admin/revoke/${confirmAction.licenseId}`,
              { method: 'POST', body: { reason: 'Revoked by admin' } }
            );
            toast.success('License revoked');
          }
          break;
        }
        case 'resetActivation': {
          if (confirmAction.licenseId) {
            const result = await apiRequest<{ success: boolean; deactivatedCount: number }>(
              `/api/license/admin/licenses/${confirmAction.licenseId}/reset-activations`,
              { method: 'POST' }
            );
            toast.success(`Reset ${result.deactivatedCount} activation(s)`);
          }
          break;
        }
        case 'revokeAll': {
          const result = await apiRequest<{ success: boolean; revokedCount: number }>(
            `/api/license/admin/user/${selectedUser.id}/revoke-all`,
            { method: 'POST', body: { reason: 'All licenses revoked by admin' } }
          );
          toast.success(`Revoked ${result.revokedCount} license(s) for ${selectedUser.email}`);
          break;
        }
        case 'reissueDesktop':
        case 'reissueAi': {
          const product = confirmAction.type === 'reissueDesktop' ? 'desktop' : 'notely-ai';
          const body: Record<string, string> = { product };
          if (selectedUser.rowType === 'beta_only') {
            body.email = selectedUser.email;
          }
          await apiRequest<{ success: boolean }>(
            `/api/license/admin/user/${selectedUser.id}/reissue-beta`,
            { method: 'POST', body }
          );
          const label = product === 'desktop' ? 'Cloud' : 'AI';
          toast.success(`Beta ${label} license reissued for ${selectedUser.email}`);
          break;
        }
        case 'grantBeta': {
          await apiRequest<{ success: boolean }>(
            '/api/license/admin/beta/enable',
            {
              method: 'POST',
              body: { userId: selectedUser.id, durationDays: 90 }
            }
          );
          toast.success(`Beta access enabled for ${selectedUser.email} (90 days)`);
          break;
        }
      }
      fetchUsers();
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (error instanceof AuthorizationError) {
        toast.error('You do not have permission to perform this action');
        return;
      }
      clientLogger.error('License action failed:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Action failed');
    } finally {
      setConfirmActionLoading(false);
      setConfirmAction(null);
    }
  };

  // ── Beta actions ───────────────────────────────────────────────────

  const handleSendInvitation = async () => {
    const signupId = selectedUser?.cloudBeta?.signupId;
    if (!signupId) return;
    setInvitationSending(true);
    try {
      await apiRequest<{ success: boolean }>(
        `/api/support/admin/beta-signups/${signupId}/send-invitation`,
        { method: 'POST', body: { adminBcc: bccAdminOnInvitation } }
      );
      toast.success(`Invitation sent to ${selectedUser?.email}`);
      setSendInvitationDialogOpen(false);
      setBccAdminOnInvitation(false);
      handleActionMenuClose();
      fetchUsers();
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        router.push('/login');
        return;
      }
      clientLogger.error('Failed to send invitation:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to send invitation');
    } finally {
      setInvitationSending(false);
    }
  };

  const handleSendAiInvitation = async () => {
    const signupId = selectedUser?.aiBeta?.signupId;
    if (!signupId) return;
    setAiInvitationSending(true);
    try {
      await apiRequest<{ success: boolean }>(
        `/api/support/admin/beta-signups/${signupId}/send-ai-invitation`,
        { method: 'POST', body: { adminBcc: bccAdminOnInvitation } }
      );
      toast.success(`AI license sent to ${selectedUser?.email}`);
      setSendAiInvitationDialogOpen(false);
      setBccAdminOnInvitation(false);
      handleActionMenuClose();
      fetchUsers();
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        router.push('/login');
        return;
      }
      clientLogger.error('Failed to send AI invitation:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to send AI invitation');
    } finally {
      setAiInvitationSending(false);
    }
  };

  const handleConvert = async () => {
    const signupId = convertProduct === 'ai'
      ? selectedUser?.aiBeta?.signupId
      : selectedUser?.cloudBeta?.signupId;
    if (!signupId) return;
    setConvertInProgress(true);
    try {
      await apiRequest<{ success: boolean }>(
        `/api/support/admin/beta-signups/${signupId}/convert`,
        { method: 'POST', body: { product: convertProduct } }
      );
      toast.success(`Account created and license assigned for ${selectedUser?.email}`);
      setConvertDialogOpen(false);
      fetchUsers();
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        router.push('/login');
        return;
      }
      clientLogger.error('Failed to convert signup:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to convert signup');
    } finally {
      setConvertInProgress(false);
    }
  };

  const handleDeleteSignup = async () => {
    const signupIds = [
      selectedUser?.cloudBeta?.signupId,
      selectedUser?.aiBeta?.signupId,
    ].filter(Boolean) as string[];

    if (signupIds.length === 0) return;
    setDeleteInProgress(true);
    try {
      for (const signupId of signupIds) {
        await apiRequest<{ success: boolean }>(
          `/api/support/admin/beta-signups/${signupId}`,
          { method: 'DELETE' }
        );
      }
      toast.success(`Deleted signup for ${selectedUser?.email}`);
      setDeleteSignupDialogOpen(false);
      handleActionMenuClose();
      fetchUsers();
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        router.push('/login');
        return;
      }
      clientLogger.error('Failed to delete signup:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to delete signup');
    } finally {
      setDeleteInProgress(false);
    }
  };

  const handleAddSignup = async () => {
    const { firstName, lastName, email } = addSignupFormData;
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast.error('All fields are required');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }
    setAddSignupInProgress(true);
    try {
      await apiRequest<{ success: boolean }>(
        '/api/support/admin/beta-signups',
        {
          method: 'POST',
          body: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            product: addSignupFormData.product
          }
        }
      );
      toast.success(`Beta signup created for ${email.trim()}`);
      setAddSignupDialogOpen(false);
      setAddSignupFormData({ firstName: '', lastName: '', email: '', product: 'cloud' });
      fetchUsers();
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        router.push('/login');
        return;
      }
      clientLogger.error('Failed to create beta signup:', { error: error instanceof Error ? error.message : String(error) });
      toast.error(error.message || 'Failed to create beta signup');
    } finally {
      setAddSignupInProgress(false);
    }
  };

  // ── Selection helpers ───────────────────────────────────────────────

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedUserIds.size === filteredUsers.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(filteredUsers.map(u => u.id)));
    }
  };

  // ── Bulk action handler ─────────────────────────────────────────────

  const executeBulkAction = async () => {
    if (!bulkAction) return;
    setBulkActionInProgress(true);
    let successes = 0;
    let failures = 0;
    const ids = Array.from(selectedUserIds);

    try {
      for (const userId of ids) {
        try {
          switch (bulkAction.type) {
            case 'bulkRevoke':
              await apiRequest(
                `/api/license/admin/user/${userId}/revoke-all`,
                { method: 'POST', body: { reason: 'Bulk revocation by admin' } }
              );
              break;
            case 'bulkDelete': {
              const user = users.find(u => u.id === userId);
              if (isAdmin(user?.role) || user?.rowType === 'beta_only') continue;
              await apiRequest(`/api/users/${userId}`, { method: 'DELETE' });
              break;
            }
            case 'bulkSuspend': {
              const user = users.find(u => u.id === userId);
              if (user?.rowType === 'beta_only' || !user?.isActive) continue;
              await apiRequest(`/api/users/${userId}/toggle-active`, { method: 'PATCH' });
              break;
            }
            case 'bulkGrantBeta':
              await apiRequest(
                '/api/license/admin/beta/enable',
                { method: 'POST', body: { userId, durationDays: 90 } }
              );
              break;
            case 'bulkResetActivations': {
              const licRes = await apiRequest<{ success: boolean; licenses: UserLicense[] }>(
                `/api/license/admin/user/${userId}/licenses`
              );
              const activeLicenses = (licRes.licenses || []).filter(l => l.status === 'active');
              for (const lic of activeLicenses) {
                await apiRequest(
                  `/api/license/admin/licenses/${lic.id}/reset-activations`,
                  { method: 'POST' }
                );
              }
              break;
            }
          }
          successes++;
        } catch {
          failures++;
        }
      }

      const parts: string[] = [];
      if (successes > 0) parts.push(`${successes} succeeded`);
      if (failures > 0) parts.push(`${failures} failed`);
      if (parts.length > 0) {
        toast.success(`Bulk action complete: ${parts.join(', ')}`);
      }
      fetchUsers();
    } catch (error: any) {
      toast.error('Bulk action failed');
    } finally {
      setBulkActionInProgress(false);
      setBulkAction(null);
      setSelectedUserIds(new Set());
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────

  const getBetaStatusChip = (detail: BetaDetail | null) => {
    if (!detail) return <Typography variant="body2" color="text.disabled">—</Typography>;
    switch (detail.displayStatus) {
      case 'Converted':
        return <Chip label="Converted" size="small" color="success" />;
      case 'Invitation Sent':
        return <Chip label="Invitation Sent" size="small" color="info" />;
      case 'Expired':
        return <Chip label="Expired" size="small" color="warning" />;
      case 'Unsubscribed':
        return <Chip label="Unsubscribed" size="small" color="default" />;
      default:
        return <Chip label="Pending" size="small" color="default" variant="outlined" />;
    }
  };

  const getRowStatusChip = (user: UnifiedUser) => {
    switch (user.status) {
      case 'registered':
        return <Chip label="Registered" size="small" color="success" />;
      case 'suspended':
        return <Chip label="Suspended" size="small" color="error" />;
      case 'invited':
        return <Chip label="Invited" size="small" color="info" />;
      case 'pending':
        return <Chip label="Pending" size="small" color="default" variant="outlined" />;
      default:
        return null;
    }
  };

  const getLicenseLabel = (user: UnifiedUser) => {
    if (user.rowType === 'beta_only') return '—';
    const licenseType = user.licenseType || 'free';
    const labels: Record<string, string> = {
      free: 'Free',
      starter: 'Starter',
      professional: 'Professional',
      enterprise: 'Enterprise',
    };
    const baseLabel = labels[licenseType] || 'Free';
    if (user.isBeta) return `${baseLabel} (Beta)`;
    if (user.grantType === 'trial') return `${baseLabel} (Trial)`;
    if (user.grantType === 'promotional') return `${baseLabel} (Promo)`;
    if (user.grantType === 'admin_grant') return `${baseLabel} (Granted)`;
    return baseLabel;
  };

  // ── Filtering ──────────────────────────────────────────────────────

  const filteredUsers = users.filter(row => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;

    if (betaFilter === 'cloud' && !row.cloudBeta) return false;
    if (betaFilter === 'ai' && !row.aiBeta) return false;
    if (betaFilter === 'none' && (row.cloudBeta || row.aiBeta)) return false;

    if (search) {
      const s = search.toLowerCase();
      return (
        row.email.toLowerCase().includes(s) ||
        row.firstName?.toLowerCase().includes(s) ||
        row.lastName?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  // ── Sorting ───────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDirection('desc');
    }
  };

  const getSortValue = (user: UnifiedUser, key: SortKey): string | number | null => {
    switch (key) {
      case 'name':
        return user.firstName || user.lastName
          ? `${user.firstName || ''} ${user.lastName || ''}`.trim().toLowerCase()
          : null;
      case 'email':
        return user.email.toLowerCase();
      case 'role':
        return user.role?.toLowerCase() || null;
      case 'status':
        return user.status;
      case 'license':
        return user.licenseType?.toLowerCase() || null;
      case 'verified':
        return user.rowType === 'beta_only' ? null : user.emailVerified ? 1 : 0;
      case 'created': {
        const d = user.createdAt || user.cloudBeta?.signedUpAt || user.aiBeta?.signedUpAt;
        return d ? new Date(d).getTime() : null;
      }
      case 'lastLogin':
        return user.lastLogin ? new Date(user.lastLogin).getTime() : null;
      default:
        return null;
    }
  };

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const aVal = getSortValue(a, sortBy);
    const bVal = getSortValue(b, sortBy);

    // Nulls always sort to the bottom
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    let cmp: number;
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }

    return sortDirection === 'asc' ? cmp : -cmp;
  });

  // ── Determine which actions are enabled for selected row ───────────

  const isRegistered = selectedUser?.rowType === 'registered';
  const isBetaOnly = selectedUser?.rowType === 'beta_only';
  const hasCloudBeta = !!selectedUser?.cloudBeta;
  const hasAiBeta = !!selectedUser?.aiBeta;
  const cloudConverted = selectedUser?.cloudBeta?.status === 'converted';
  const aiConverted = selectedUser?.aiBeta?.status === 'converted';
  const allBetasConverted = (!hasCloudBeta || cloudConverted) && (!hasAiBeta || aiConverted);
  const canConvert = isBetaOnly && !allBetasConverted;

  // License-derived helpers for the action menu
  const activeCloudLicense = menuLicenses.find(l => l.licenseType === 'desktop' && l.status === 'active');
  const activeAiLicense = menuLicenses.find(l => l.licenseType === 'notely-ai' && l.status === 'active');
  const hasAnyActiveLicense = menuLicenses.some(l => l.status === 'active');

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>User Management · Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="User Management"
          subtitle="View and manage platform users and beta signups"
          action={
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button
                variant="contained"
                size="small"
                onClick={() => setAddSignupDialogOpen(true)}
              >
                Add Beta Signup
              </Button>
              <Tooltip title="Refresh">
                <IconButton onClick={fetchUsers} disabled={loading} size="small">
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </Box>
          }
        >
          <Card sx={{ borderRadius: 1 }}>
            {/* Description bar */}
            <Box sx={{ p: 2, bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="body2" color="text.secondary">
                Manage user accounts, roles, licenses, and beta signups in one view
              </Typography>
            </Box>

            <Box sx={{ p: 3 }}>
              {/* Filters */}
              <Card variant="outlined" sx={{ borderRadius: '6px', mb: 3 }}>
                <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <TextField
                      placeholder="Search by name or email..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      size="small"
                      sx={{ flex: 1 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon sx={{ color: 'text.secondary' }} />
                          </InputAdornment>
                        ),
                      }}
                    />
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <InputLabel>Status</InputLabel>
                      <Select
                        value={statusFilter}
                        label="Status"
                        onChange={(e) => setStatusFilter(e.target.value)}
                      >
                        <MenuItem value="all">All Statuses</MenuItem>
                        <MenuItem value="registered">Registered</MenuItem>
                        <MenuItem value="suspended">Suspended</MenuItem>
                        <MenuItem value="invited">Invited</MenuItem>
                        <MenuItem value="pending">Pending</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel>Beta</InputLabel>
                      <Select
                        value={betaFilter}
                        label="Beta"
                        onChange={(e) => setBetaFilter(e.target.value)}
                      >
                        <MenuItem value="all">All</MenuItem>
                        <MenuItem value="cloud">Cloud Beta</MenuItem>
                        <MenuItem value="ai">AI Beta</MenuItem>
                        <MenuItem value="none">No Beta</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                </CardContent>
              </Card>

              {/* Bulk Action Bar */}
              {selectedUserIds.size > 0 && (
                <Card variant="outlined" sx={{ borderRadius: '6px', mb: 2, bgcolor: 'action.hover' }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" fontWeight={500}>
                      {selectedUserIds.size} selected
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setBulkAction({ type: 'bulkGrantBeta' })}
                    >
                      Grant Beta
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setBulkAction({ type: 'bulkSuspend' })}
                    >
                      Suspend
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setBulkAction({ type: 'bulkResetActivations' })}
                    >
                      Reset Activations
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => setBulkAction({ type: 'bulkRevoke' })}
                    >
                      Revoke All Licenses
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => setBulkAction({ type: 'bulkDelete' })}
                    >
                      Delete Selected
                    </Button>
                    <Button
                      size="small"
                      onClick={() => setSelectedUserIds(new Set())}
                    >
                      Clear
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Unified Table */}
              <Card variant="outlined" sx={{ borderRadius: '6px' }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            indeterminate={selectedUserIds.size > 0 && selectedUserIds.size < filteredUsers.length}
                            checked={filteredUsers.length > 0 && selectedUserIds.size === filteredUsers.length}
                            onChange={handleSelectAll}
                          />
                        </TableCell>
                        {([
                          ['name', 'Name'],
                          ['email', 'Email'],
                          ['role', 'Role'],
                          ['status', 'Status'],
                        ] as [SortKey, string][]).map(([key, label]) => (
                          <TableCell key={key} sortDirection={sortBy === key ? sortDirection : false}>
                            <TableSortLabel
                              active={sortBy === key}
                              direction={sortBy === key ? sortDirection : 'desc'}
                              onClick={() => handleSort(key)}
                            >
                              {label}
                            </TableSortLabel>
                          </TableCell>
                        ))}
                        <TableCell>Cloud Beta</TableCell>
                        <TableCell>AI Beta</TableCell>
                        {([
                          ['license', 'License'],
                          ['verified', 'Verified'],
                          ['created', 'Created'],
                          ['lastLogin', 'Last Login'],
                        ] as [SortKey, string][]).map(([key, label]) => (
                          <TableCell key={key} sortDirection={sortBy === key ? sortDirection : false}>
                            <TableSortLabel
                              active={sortBy === key}
                              direction={sortBy === key ? sortDirection : 'desc'}
                              onClick={() => handleSort(key)}
                            >
                              {label}
                            </TableSortLabel>
                          </TableCell>
                        ))}
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={12} align="center" sx={{ py: 4 }}>
                            <CircularProgress size={24} />
                          </TableCell>
                        </TableRow>
                      ) : filteredUsers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={12} align="center" sx={{ py: 4 }}>
                            <Typography variant="body2" color="text.secondary">
                              {search || statusFilter !== 'all' || betaFilter !== 'all'
                                ? 'No users match the current filters'
                                : 'No users yet'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedUsers.map((user) => (
                          <TableRow key={`${user.rowType}-${user.id}`} hover>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={selectedUserIds.has(user.id)}
                                onChange={() => toggleUserSelection(user.id)}
                              />
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {user.firstName && user.lastName
                                  ? `${user.firstName} ${user.lastName}`
                                  : user.firstName || user.lastName || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{user.email}</Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {user.role
                                  ? user.role.charAt(0).toUpperCase() + user.role.slice(1).replace('_', ' ')
                                  : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              {getRowStatusChip(user)}
                            </TableCell>
                            <TableCell>
                              {getBetaStatusChip(user.cloudBeta)}
                            </TableCell>
                            <TableCell>
                              {getBetaStatusChip(user.aiBeta)}
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const label = getLicenseLabel(user);
                                return user.licenseExpiresAt ? (
                                  <Tooltip title={`Expires: ${new Date(user.licenseExpiresAt).toLocaleDateString()}`}>
                                    <Typography variant="body2">{label}</Typography>
                                  </Tooltip>
                                ) : (
                                  <Typography variant="body2">{label}</Typography>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {user.rowType === 'beta_only' ? '—' : user.emailVerified ? 'Yes' : 'No'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {(() => {
                                  const date = user.createdAt || user.cloudBeta?.signedUpAt || user.aiBeta?.signedUpAt;
                                  return date
                                    ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
                                    : '—';
                                })()}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {user.lastLogin
                                  ? new Date(user.lastLogin).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
                                  : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <IconButton
                                size="small"
                                onClick={(e) => handleActionMenuOpen(e, user)}
                              >
                                <MoreVertIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                {filteredUsers.length > 0 && (
                  <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', textAlign: 'right' }}>
                    <Typography variant="caption" color="text.secondary">
                      Showing {filteredUsers.length} of {users.length} users
                    </Typography>
                  </Box>
                )}
              </Card>
            </Box>
          </Card>
        </PageContainer>
      </MainLayout>

      {/* ── Unified Actions Menu ─────────────────────────────────────── */}
      <Menu
        anchorEl={actionMenuAnchor}
        open={Boolean(actionMenuAnchor)}
        onClose={handleActionMenuClose}
      >
        {/* User section */}
        <ListSubheader sx={{ lineHeight: '30px', fontSize: '0.7rem', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase' }}>
          User
        </ListSubheader>
        <MenuItem onClick={handleOpenEditDialog} disabled={isBetaOnly}>
          Edit User
        </MenuItem>
        <MenuItem
          onClick={() => { handleActionMenuClose(); setSuspendDialogOpen(true); }}
          disabled={isBetaOnly}
        >
          {selectedUser?.isActive ? 'Suspend User' : 'Activate User'}
        </MenuItem>

        {/* Beta section */}
        <ListSubheader sx={{ lineHeight: '30px', fontSize: '0.7rem', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase' }}>
          Beta
        </ListSubheader>
        <MenuItem
          onClick={() => { handleActionMenuClose(); setSendInvitationDialogOpen(true); }}
          disabled={!hasCloudBeta || cloudConverted}
        >
          Send Cloud Invite
        </MenuItem>
        <MenuItem
          onClick={() => { handleActionMenuClose(); setSendAiInvitationDialogOpen(true); }}
          disabled={!hasAiBeta || aiConverted}
        >
          Send AI Invite
        </MenuItem>
        <MenuItem
          onClick={() => {
            const product = selectedUser?.cloudBeta && selectedUser.cloudBeta.status !== 'converted'
              ? 'cloud'
              : 'ai';
            setConvertProduct(product);
            handleActionMenuClose();
            setConvertDialogOpen(true);
          }}
          disabled={!canConvert}
        >
          Convert to User
        </MenuItem>

        {/* License section */}
        <ListSubheader sx={{ lineHeight: '30px', fontSize: '0.7rem', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase' }}>
          License {menuLicensesLoading && <CircularProgress size={12} sx={{ ml: 1 }} />}
        </ListSubheader>
        <MenuItem
          onClick={() => {
            handleActionMenuClose();
            setConfirmAction({ type: 'grantBeta' });
          }}
          disabled={menuLicensesLoading || isBetaOnly || hasAnyActiveLicense}
        >
          Grant Beta
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleActionMenuClose();
            setConfirmAction({ type: 'reissueDesktop' });
          }}
          disabled={menuLicensesLoading || isBetaOnly}
        >
          Reissue Cloud Beta
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleActionMenuClose();
            setConfirmAction({ type: 'reissueAi' });
          }}
          disabled={menuLicensesLoading}
        >
          Reissue AI Beta
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleActionMenuClose();
            setConfirmAction({ type: 'revoke', licenseId: activeCloudLicense?.id, productLabel: 'Cloud' });
          }}
          disabled={menuLicensesLoading || !activeCloudLicense}
        >
          Revoke Cloud License
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleActionMenuClose();
            setConfirmAction({ type: 'revoke', licenseId: activeAiLicense?.id, productLabel: 'AI' });
          }}
          disabled={menuLicensesLoading || !activeAiLicense}
        >
          Revoke AI License
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleActionMenuClose();
            setConfirmAction({ type: 'resetActivation', licenseId: activeCloudLicense?.id, productLabel: 'Cloud' });
          }}
          disabled={menuLicensesLoading || !activeCloudLicense}
        >
          Reset Cloud Activation
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleActionMenuClose();
            setConfirmAction({ type: 'resetActivation', licenseId: activeAiLicense?.id, productLabel: 'AI' });
          }}
          disabled={menuLicensesLoading || !activeAiLicense}
        >
          Reset AI Activation
        </MenuItem>

        <Divider />

        {/* Destructive actions */}
        {isRegistered ? (
          <Tooltip
            title={selectedUser?.isProtected ? 'Protected system account' : ''}
            placement="left"
          >
            <span>
              <MenuItem
                onClick={() => { handleActionMenuClose(); setDeleteDialogOpen(true); }}
                sx={{ color: selectedUser?.isProtected ? 'text.disabled' : 'error.main' }}
                disabled={!!selectedUser?.isProtected}
              >
                Delete User
              </MenuItem>
            </span>
          </Tooltip>
        ) : (
          <MenuItem
            onClick={() => { handleActionMenuClose(); setDeleteSignupDialogOpen(true); }}
            sx={{ color: 'error.main' }}
          >
            Delete Signup
          </MenuItem>
        )}
      </Menu>

      {/* ── Unified Confirmation Dialog ────────────────────────────────── */}
      <Dialog open={!!confirmAction} onClose={() => !confirmActionLoading && setConfirmAction(null)}>
        <DialogTitle>
          {confirmAction?.type === 'revoke' && `Revoke ${confirmAction.productLabel} license?`}
          {confirmAction?.type === 'resetActivation' && `Reset ${confirmAction.productLabel} activations?`}
          {confirmAction?.type === 'revokeAll' && 'Revoke ALL licenses?'}
          {confirmAction?.type === 'reissueDesktop' && 'Reissue Cloud Beta?'}
          {confirmAction?.type === 'reissueAi' && 'Reissue AI Beta?'}
          {confirmAction?.type === 'grantBeta' && 'Grant beta access?'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmAction?.type === 'revoke' && 'Immediately invalidates the key. The user will lose access.'}
            {confirmAction?.type === 'resetActivation' && 'Deactivates all active activations. The user can re-activate with their existing key.'}
            {confirmAction?.type === 'revokeAll' && 'Revokes every active license for this user. They revert to Free tier.'}
            {confirmAction?.type === 'reissueDesktop' && 'Revokes all existing licenses and creates a fresh Cloud beta.'}
            {confirmAction?.type === 'reissueAi' && 'Revokes all existing licenses and creates a fresh AI beta.'}
            {confirmAction?.type === 'grantBeta' && 'Grants Professional tier access (90 days).'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAction(null)} size="small" disabled={confirmActionLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmAction}
            variant="contained"
            size="small"
            color={confirmAction?.type === 'revoke' || confirmAction?.type === 'revokeAll' ? 'error' : 'primary'}
            disabled={confirmActionLoading}
            startIcon={confirmActionLoading ? <CircularProgress size={16} /> : undefined}
          >
            {confirmActionLoading ? 'Processing...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Bulk Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={!!bulkAction} onClose={() => !bulkActionInProgress && setBulkAction(null)}>
        <DialogTitle>
          {bulkAction?.type === 'bulkRevoke' && 'Revoke all licenses?'}
          {bulkAction?.type === 'bulkDelete' && 'Delete selected users?'}
          {bulkAction?.type === 'bulkSuspend' && 'Suspend selected users?'}
          {bulkAction?.type === 'bulkGrantBeta' && 'Grant beta access?'}
          {bulkAction?.type === 'bulkResetActivations' && 'Reset activations?'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {bulkAction?.type === 'bulkRevoke' && `Revokes every active license for ${selectedUserIds.size} user(s).`}
            {bulkAction?.type === 'bulkDelete' && `Permanently deletes ${selectedUserIds.size} user(s). Admin accounts are excluded. Cannot be undone.`}
            {bulkAction?.type === 'bulkSuspend' && `Suspends ${selectedUserIds.size} user(s). They won't be able to access their accounts.`}
            {bulkAction?.type === 'bulkGrantBeta' && `Grants beta license to ${selectedUserIds.size} user(s) who don't already have one.`}
            {bulkAction?.type === 'bulkResetActivations' && `Resets all activations for ${selectedUserIds.size} user(s). They'll need to re-activate.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkAction(null)} size="small" disabled={bulkActionInProgress}>
            Cancel
          </Button>
          <Button
            onClick={executeBulkAction}
            variant="contained"
            size="small"
            color={bulkAction?.type === 'bulkRevoke' || bulkAction?.type === 'bulkDelete' ? 'error' : 'primary'}
            disabled={bulkActionInProgress}
            startIcon={bulkActionInProgress ? <CircularProgress size={16} /> : undefined}
          >
            {bulkActionInProgress ? 'Processing...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Suspend Confirmation Dialog ──────────────────────────────── */}
      <Dialog open={suspendDialogOpen} onClose={() => setSuspendDialogOpen(false)}>
        <DialogTitle>
          {selectedUser?.isActive ? 'Suspend User' : 'Activate User'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {selectedUser?.isActive
              ? `Are you sure you want to suspend ${selectedUser?.email}? They will no longer be able to access their account.`
              : `Are you sure you want to activate ${selectedUser?.email}? They will be able to access their account again.`
            }
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuspendDialogOpen(false)} size="small">Cancel</Button>
          <Button onClick={handleSuspendUser} color={selectedUser?.isActive ? 'error' : 'primary'} variant="contained" size="small">
            {selectedUser?.isActive ? 'Suspend' : 'Activate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete User Confirmation Dialog ──────────────────────────── */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete User</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {selectedUser?.email}? This action cannot be undone.
            All user data will be permanently removed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} size="small">Cancel</Button>
          <Button onClick={handleDeleteUser} color="error" variant="contained" size="small">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Edit User Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit User</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="First Name"
                  fullWidth
                  size="small"
                  value={editFormData.firstName}
                  onChange={(e) => setEditFormData({ ...editFormData, firstName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Last Name"
                  fullWidth
                  size="small"
                  value={editFormData.lastName}
                  onChange={(e) => setEditFormData({ ...editFormData, lastName: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Email"
                  type="email"
                  fullWidth
                  size="small"
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth size="small">
                  <InputLabel>Role</InputLabel>
                  <Select
                    value={editFormData.role || 'user'}
                    label="Role"
                    onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value })}
                  >
                    <MenuItem value="user">User</MenuItem>
                    <MenuItem value="admin">Admin</MenuItem>
                    <MenuItem value="super_admin">Super Admin</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
              </Grid>

              <Grid item xs={12}>
                <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>
                  Password Reset
                </Typography>
                <FormControl component="fieldset">
                  <RadioGroup
                    value={passwordMode}
                    onChange={(e) => {
                      setPasswordMode(e.target.value as 'none' | 'auto' | 'manual');
                      if (e.target.value !== 'manual') {
                        setEditFormData({ ...editFormData, password: '' });
                      }
                    }}
                  >
                    <FormControlLabel value="none" control={<Radio size="small" />} label="Don't change password" />
                    <FormControlLabel value="auto" control={<Radio size="small" />} label="Auto-generate password" />
                    <FormControlLabel value="manual" control={<Radio size="small" />} label="Set password manually" />
                  </RadioGroup>
                </FormControl>
              </Grid>
              {passwordMode === 'manual' && (
                <Grid item xs={12}>
                  <TextField
                    label="New Password"
                    type="password"
                    fullWidth
                    size="small"
                    value={editFormData.password}
                    onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                    helperText="Minimum 8 characters"
                  />
                </Grid>
              )}
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)} size="small">Cancel</Button>
          <Button onClick={handleSaveUser} variant="contained" color="primary" size="small">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Send Cloud Invitation Dialog ─────────────────────────────── */}
      <Dialog open={sendInvitationDialogOpen} onClose={() => {
        setSendInvitationDialogOpen(false);
        setBccAdminOnInvitation(false);
      }}>
        <DialogTitle>Send Beta Invitation</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Send a beta invitation email to <strong>{selectedUser?.email}</strong>?
            <br /><br />
            They will receive an email with a link that is valid for 24 hours.
            After clicking the link and creating an account with this email address, they will receive 90 days of Professional access.
            {selectedUser?.cloudBeta?.hasActiveToken && (
              <>
                <br /><br />
                <strong>Note:</strong> An invitation is currently active. Sending a new invitation will invalidate the previous link.
              </>
            )}
          </DialogContentText>
          <FormControlLabel
            control={
              <Checkbox
                checked={bccAdminOnInvitation}
                onChange={(e) => setBccAdminOnInvitation(e.target.checked)}
                size="small"
              />
            }
            label="BCC Admin"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setSendInvitationDialogOpen(false);
            setBccAdminOnInvitation(false);
          }} size="small" disabled={invitationSending}>
            Cancel
          </Button>
          <Button
            onClick={handleSendInvitation}
            variant="contained"
            color="primary"
            size="small"
            disabled={invitationSending}
            startIcon={invitationSending ? <CircularProgress size={16} /> : undefined}
          >
            {invitationSending ? 'Sending...' : 'Send Invitation'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Send AI Invitation Dialog ────────────────────────────────── */}
      <Dialog open={sendAiInvitationDialogOpen} onClose={() => {
        setSendAiInvitationDialogOpen(false);
        setBccAdminOnInvitation(false);
      }}>
        <DialogTitle>Send Notely AI License</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Generate a Notely AI license key and email it to <strong>{selectedUser?.email}</strong>?
            <br /><br />
            This will:
            <br />
            &bull; Generate a time-limited license key (expires April 30, 2026)
            <br />
            &bull; Send an email with the license key and activation instructions
            <br />
            &bull; Mark this signup as converted
          </DialogContentText>
          <FormControlLabel
            control={
              <Checkbox
                checked={bccAdminOnInvitation}
                onChange={(e) => setBccAdminOnInvitation(e.target.checked)}
                size="small"
              />
            }
            label="BCC Admin"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setSendAiInvitationDialogOpen(false);
            setBccAdminOnInvitation(false);
          }} size="small" disabled={aiInvitationSending}>
            Cancel
          </Button>
          <Button
            onClick={handleSendAiInvitation}
            variant="contained"
            color="primary"
            size="small"
            disabled={aiInvitationSending}
            startIcon={aiInvitationSending ? <CircularProgress size={16} /> : undefined}
          >
            {aiInvitationSending ? 'Generating...' : 'Send AI License'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Signup Confirmation Dialog ────────────────────────── */}
      <Dialog open={deleteSignupDialogOpen} onClose={() => setDeleteSignupDialogOpen(false)}>
        <DialogTitle>Delete Beta Signup</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the signup for <strong>{selectedUser?.email}</strong>?
            <br /><br />
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteSignupDialogOpen(false)} size="small" disabled={deleteInProgress}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteSignup}
            variant="contained"
            color="error"
            size="small"
            disabled={deleteInProgress}
            startIcon={deleteInProgress ? <CircularProgress size={16} /> : undefined}
          >
            {deleteInProgress ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Convert Beta Signup Dialog ───────────────────────────────── */}
      <Dialog
        open={convertDialogOpen}
        onClose={() => {
          if (!convertInProgress) setConvertDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Convert Beta Signup</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Create a platform account for <strong>{selectedUser?.email}</strong> and assign a license.
          </DialogContentText>
          <FormControl component="fieldset">
            <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>
              Product
            </Typography>
            <RadioGroup
              value={convertProduct}
              onChange={(e) => setConvertProduct(e.target.value as 'cloud' | 'ai')}
            >
              <FormControlLabel
                value="cloud"
                control={<Radio size="small" />}
                label="Notely Cloud"
                disabled={convertInProgress || !selectedUser?.cloudBeta || cloudConverted}
              />
              <FormControlLabel
                value="ai"
                control={<Radio size="small" />}
                label="Notely AI"
                disabled={convertInProgress || !selectedUser?.aiBeta || aiConverted}
              />
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConvertDialogOpen(false)}
            size="small"
            disabled={convertInProgress}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConvert}
            variant="contained"
            color="primary"
            size="small"
            disabled={convertInProgress}
            startIcon={convertInProgress ? <CircularProgress size={16} /> : undefined}
          >
            {convertInProgress ? 'Converting...' : 'Convert'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Add Beta Signup Dialog ───────────────────────────────────── */}
      <Dialog
        open={addSignupDialogOpen}
        onClose={() => {
          if (!addSignupInProgress) {
            setAddSignupDialogOpen(false);
            setAddSignupFormData({ firstName: '', lastName: '', email: '', product: 'cloud' });
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Beta Signup</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Manually add a user to the beta signup list. After adding, you can send them an invitation email.
          </DialogContentText>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="First Name"
                fullWidth
                size="small"
                value={addSignupFormData.firstName}
                onChange={(e) => setAddSignupFormData({ ...addSignupFormData, firstName: e.target.value })}
                disabled={addSignupInProgress}
                autoFocus
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Last Name"
                fullWidth
                size="small"
                value={addSignupFormData.lastName}
                onChange={(e) => setAddSignupFormData({ ...addSignupFormData, lastName: e.target.value })}
                disabled={addSignupInProgress}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Email"
                type="email"
                fullWidth
                size="small"
                value={addSignupFormData.email}
                onChange={(e) => setAddSignupFormData({ ...addSignupFormData, email: e.target.value })}
                disabled={addSignupInProgress}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl size="small" fullWidth>
                <InputLabel>Product</InputLabel>
                <Select
                  value={addSignupFormData.product}
                  label="Product"
                  onChange={(e) => setAddSignupFormData({ ...addSignupFormData, product: e.target.value as 'cloud' | 'ai' })}
                  disabled={addSignupInProgress}
                >
                  <MenuItem value="cloud">Notely Cloud</MenuItem>
                  <MenuItem value="ai">Notely AI</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setAddSignupDialogOpen(false);
              setAddSignupFormData({ firstName: '', lastName: '', email: '', product: 'cloud' });
            }}
            size="small"
            disabled={addSignupInProgress}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAddSignup}
            variant="contained"
            color="primary"
            size="small"
            disabled={addSignupInProgress || !addSignupFormData.firstName.trim() || !addSignupFormData.lastName.trim() || !addSignupFormData.email.trim()}
            startIcon={addSignupInProgress ? <CircularProgress size={16} /> : undefined}
          >
            {addSignupInProgress ? 'Adding...' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// Server-side protection - only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'users:read' });
