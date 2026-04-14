/**
 * Backup Settings Tab
 * Disaster recovery backup, restore, and state reconstruction
 * Clean, minimal design - no icons, compact inputs
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import {
  apiRequest,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  ServerError,
} from '@/utils/api';

type NullableDate = string | null;

interface BackupOptions {
  includeUserData: boolean;
  includeMerkleState: boolean;
  includeMetrics: boolean;
  compressionEnabled: boolean;
  maxUsers: number | null;
}

interface BackupScheduler {
  enabled: boolean;
  cronExpression: string;
  timezone: string;
}

interface BackupConfig {
  options: BackupOptions;
  retentionDays: number;
  backupDirectory: string;
  scheduler: BackupScheduler;
}

interface BackupFile {
  name: string;
  size: number;
  checksum: string;
  recordCount?: number;
}

interface BackupRecord {
  backupId: string;
  timestamp: string;
  version: string;
  backupType?: string;
  status?: string;
  options: BackupOptions;
  files: BackupFile[];
  statistics: {
    totalSize: number;
    totalRecords: number;
    totalTables?: number;
    compressionRatio?: number;
    duration?: number;
  };
  integrity: {
    verified: boolean;
    checksums: { [key: string]: string };
  };
  errorMessage?: string;
}

interface BackupListResponse {
  success: boolean;
  data: BackupRecord[];
  count: number;
}

interface BackupCreateResponse {
  success: boolean;
  data: BackupRecord;
}

interface BackupRestoreResponse {
  success: boolean;
  data: {
    backupId: string;
    restored: boolean;
    recordsRestored: number;
    errors: any[];
  };
}

interface BackupCleanupResponse {
  success: boolean;
  data: {
    removed: number;
    freed: number;
    remaining: number;
  };
}

function formatFileSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  const mb = bytes / (1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${mb.toFixed(2)} MB`;
}

const DEFAULT_BACKUP_DIR = '/workspace/database-backups';

// Reusable toggle row component
const ToggleRow = ({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, mb: 2.5 }}>
    <Box sx={{ flex: '0 0 200px' }}>
      <Typography variant="body2" fontWeight={500}>
        {label}
      </Typography>
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
    </Box>
    <Box sx={{ width: 200 }}>
      <Switch
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        size="small"
        disabled={disabled}
      />
    </Box>
  </Box>
);

// Reusable field row component
const FieldRow = ({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, mb: 2.5 }}>
    <Box sx={{ flex: '0 0 200px', pt: 1 }}>
      <Typography variant="body2" fontWeight={500}>
        {label}
      </Typography>
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
    </Box>
    <Box sx={{ flex: 1 }}>{children}</Box>
  </Box>
);

// Section header component
const SectionHeader = ({ children }: { children: React.ReactNode }) => (
  <Typography
    variant="body2"
    sx={{
      color: 'text.secondary',
      fontWeight: 600,
      mb: 2,
      mt: 0,
    }}
  >
    {children}
  </Typography>
);

export default function BackupSettingsTab() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [cleanupInProgress, setCleanupInProgress] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupOptions, setBackupOptions] = useState<BackupOptions>({
    includeUserData: true,
    includeMerkleState: true,
    includeMetrics: false,
    compressionEnabled: true,
    maxUsers: null,
  });
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [backupDirectory, setBackupDirectory] = useState<string>(DEFAULT_BACKUP_DIR);
  const [scheduler, setScheduler] = useState<BackupScheduler>({
    enabled: false,
    cronExpression: '0 2 * * *',
    timezone: 'UTC',
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [originalConfig, setOriginalConfig] = useState<BackupConfig | null>(null);

  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);

  const handleApiError = useCallback(
    (error: unknown, context: string) => {
      if (error instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (error instanceof AuthorizationError) {
        toast.error('You do not have permission to perform this action.');
      } else if (error instanceof ValidationError) {
        toast.error(error.message || 'Invalid input.');
      } else if (error instanceof ServerError) {
        toast.error('Server error. Please try again later.');
      } else if (error instanceof Error) {
        toast.error(error.message || `${context} failed`);
      } else {
        toast.error('An unexpected error occurred');
      }
    },
    [router]
  );

  const fetchBackupConfig = useCallback(async () => {
    try {
      const response = await apiRequest<{ config: BackupConfig }>('/api/admin/config/backup');
      const config = response?.config || {
        options: {
          includeUserData: true,
          includeMerkleState: true,
          includeMetrics: false,
          compressionEnabled: true,
          maxUsers: null,
        },
        retentionDays: 30,
        backupDirectory: DEFAULT_BACKUP_DIR,
        scheduler: { enabled: false, cronExpression: '0 2 * * *', timezone: 'UTC' },
      };

      if (config.options) setBackupOptions(config.options);

      const resolvedBackupDir =
        typeof config.backupDirectory === 'string' && config.backupDirectory.trim() !== ''
          ? config.backupDirectory
          : DEFAULT_BACKUP_DIR;
      const normalizedBackupDir =
        resolvedBackupDir === '/tmp/database-backups' ? DEFAULT_BACKUP_DIR : resolvedBackupDir;
      config.backupDirectory = normalizedBackupDir;

      if (typeof config.retentionDays === 'number') setRetentionDays(config.retentionDays);
      setBackupDirectory(config.backupDirectory);
      if (config.scheduler) setScheduler(config.scheduler);

      setOriginalConfig(config);
      setHasUnsavedChanges(false);
      setConfigLoaded(true);
    } catch (error) {
      handleApiError(error, 'Load backup config');
      setConfigLoaded(true);
    }
  }, [handleApiError]);

  const loadBackups = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiRequest<BackupListResponse>('/api/admin/database/backups');
      setBackups(response.data);
    } catch (error) {
      handleApiError(error, 'Load backups');
    } finally {
      setLoading(false);
    }
  }, [handleApiError]);

  useEffect(() => {
    fetchBackupConfig();
  }, [fetchBackupConfig]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const saveBackupConfig = useCallback(async () => {
    setSaving(true);
    try {
      const payload = { options: backupOptions, retentionDays, backupDirectory, scheduler };
      await apiRequest('/api/admin/config/backup', { method: 'POST', body: payload });
      setOriginalConfig(payload);
      setHasUnsavedChanges(false);
      toast.success('Backup configuration saved');
    } catch (error) {
      handleApiError(error, 'Save backup configuration');
    } finally {
      setSaving(false);
    }
  }, [backupOptions, retentionDays, backupDirectory, scheduler, handleApiError]);

  useEffect(() => {
    if (!configLoaded || !originalConfig) return;
    const hasChanges =
      JSON.stringify(backupOptions) !== JSON.stringify(originalConfig.options) ||
      retentionDays !== originalConfig.retentionDays ||
      backupDirectory !== originalConfig.backupDirectory ||
      JSON.stringify(scheduler) !== JSON.stringify(originalConfig.scheduler);
    setHasUnsavedChanges(hasChanges);
  }, [backupOptions, retentionDays, backupDirectory, scheduler, configLoaded, originalConfig]);

  const handleBackupOptionChange = (field: keyof BackupOptions, value: any) => {
    setBackupOptions((prev) => ({ ...prev, [field]: value }));
  };

  const startManualBackup = async () => {
    setBackupInProgress(true);
    try {
      if (hasUnsavedChanges) await saveBackupConfig();
      await apiRequest<BackupCreateResponse>('/api/admin/database/backups', {
        method: 'POST',
        body: backupOptions,
      });
      toast.success('Backup created successfully');
      await loadBackups();
    } catch (error) {
      handleApiError(error, 'Create backup');
    } finally {
      setBackupInProgress(false);
    }
  };

  const deleteBackup = async (backupId: string) => {
    try {
      await apiRequest(`/api/admin/database/backups/${backupId}`, { method: 'DELETE' });
      toast.success('Backup deleted');
      await loadBackups();
    } catch (error) {
      handleApiError(error, 'Delete backup');
    }
  };

  const restoreFromBackup = async (backup: BackupRecord) => {
    setRestoreDialogOpen(false);
    try {
      const response = await apiRequest<BackupRestoreResponse>(
        `/api/admin/database/backups/restore/${backup.backupId}`,
        {
          method: 'POST',
          body: {
            validateIntegrity: true,
            skipExistingUsers: false,
            dryRun: false,
            restoreUserData: backup.options.includeUserData,
            restoreMerkleState: backup.options.includeMerkleState,
            restoreMetrics: backup.options.includeMetrics,
          },
        }
      );
      toast.success(`Restored ${response.data.recordsRestored} records from backup`);
      await loadBackups();
    } catch (error) {
      handleApiError(error, 'Restore from backup');
    }
  };

  const cleanupOldBackups = async () => {
    setCleanupInProgress(true);
    try {
      if (hasUnsavedChanges) await saveBackupConfig();
      const response = await apiRequest<BackupCleanupResponse>(
        '/api/admin/database/backups/cleanup',
        { method: 'DELETE', body: { maxAgeDays: retentionDays } }
      );
      toast.success(`Cleaned up ${response.data.removed} backup(s), freed ${formatFileSize(response.data.freed)}`);
      await loadBackups();
    } catch (error) {
      handleApiError(error, 'Cleanup old backups');
    } finally {
      setCleanupInProgress(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box>
      <Grid container spacing={3}>
        {/* Left Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Backup Options */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Backup Options</SectionHeader>
                <ToggleRow
                  label="Include user data"
                  description="Entity hashes and registration"
                  checked={backupOptions.includeUserData}
                  onChange={(checked) => handleBackupOptionChange('includeUserData', checked)}
                  disabled={saving}
                />
                <ToggleRow
                  label="Include Merkle state"
                  description="Merkle tree roots and counts"
                  checked={backupOptions.includeMerkleState}
                  onChange={(checked) => handleBackupOptionChange('includeMerkleState', checked)}
                  disabled={saving}
                />
                <ToggleRow
                  label="Include metrics"
                  description="Sync metrics and performance"
                  checked={backupOptions.includeMetrics}
                  onChange={(checked) => handleBackupOptionChange('includeMetrics', checked)}
                  disabled={saving}
                />
                <ToggleRow
                  label="Enable compression"
                  description="Compress files to save space"
                  checked={backupOptions.compressionEnabled}
                  onChange={(checked) => handleBackupOptionChange('compressionEnabled', checked)}
                  disabled={saving}
                />
                <FieldRow label="Max users" description="Leave empty for all">
                  <TextField
                    size="small"
                    type="number"
                    value={backupOptions.maxUsers ?? ''}
                    onChange={(e) =>
                      handleBackupOptionChange('maxUsers', e.target.value ? parseInt(e.target.value) : null)
                    }
                    disabled={saving}
                    sx={{ width: 200 }}
                    inputProps={{ min: 1 }}
                  />
                </FieldRow>
                <FieldRow label="Directory" description="Server storage path">
                  <TextField
                    size="small"
                    value={backupDirectory}
                    onChange={(e) => setBackupDirectory(e.target.value)}
                    disabled={saving}
                    fullWidth
                  />
                </FieldRow>
              </CardContent>
            </Card>

            {/* Scheduler */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Automatic Scheduler</SectionHeader>
                <ToggleRow
                  label="Enable automatic backups"
                  description="Run on schedule"
                  checked={scheduler.enabled}
                  onChange={(checked) => setScheduler({ ...scheduler, enabled: checked })}
                  disabled={saving}
                />
                <FieldRow label="Cron schedule" description="e.g., 0 2 * * * = 2 AM daily">
                  <TextField
                    size="small"
                    value={scheduler.cronExpression}
                    onChange={(e) => setScheduler({ ...scheduler, cronExpression: e.target.value })}
                    disabled={!scheduler.enabled || saving}
                    sx={{ width: 200 }}
                  />
                </FieldRow>
                <FieldRow label="Timezone" description="Default: UTC">
                  <TextField
                    size="small"
                    value={scheduler.timezone}
                    onChange={(e) => setScheduler({ ...scheduler, timezone: e.target.value })}
                    disabled={!scheduler.enabled || saving}
                    sx={{ width: 200 }}
                  />
                </FieldRow>
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Manual Operations */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Manual Operations</SectionHeader>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Create immediate backup with current settings
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={startManualBackup}
                      disabled={backupInProgress}
                      fullWidth
                    >
                      {backupInProgress ? 'Creating...' : 'Start Backup'}
                    </Button>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Remove backups older than retention period
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        type="number"
                        label="Days"
                        value={retentionDays}
                        onChange={(e) => setRetentionDays(parseInt(e.target.value))}
                        sx={{ width: 100 }}
                        inputProps={{ min: 1, max: 365 }}
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={cleanupOldBackups}
                        disabled={cleanupInProgress}
                      >
                        {cleanupInProgress ? 'Cleaning...' : 'Cleanup'}
                      </Button>
                    </Stack>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            {/* Backup History */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <SectionHeader>Backup History</SectionHeader>
                  <Button size="small" onClick={loadBackups}>
                    Refresh
                  </Button>
                </Box>
                {backups.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No backups available
                  </Typography>
                ) : (
                  <TableContainer sx={{ maxHeight: 300 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ py: 0.5 }}>ID</TableCell>
                          <TableCell sx={{ py: 0.5 }}>Size</TableCell>
                          <TableCell sx={{ py: 0.5 }}>Status</TableCell>
                          <TableCell sx={{ py: 0.5 }}>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {backups.map((backup) => (
                          <TableRow key={backup.backupId}>
                            <TableCell sx={{ py: 0.5 }}>
                              <Typography variant="caption" fontFamily="monospace">
                                {backup.backupId.slice(0, 8)}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ py: 0.5 }}>
                              <Typography variant="caption">
                                {formatFileSize(backup.statistics.totalSize)}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ py: 0.5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Box
                                  sx={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    bgcolor:
                                      backup.status === 'failed'
                                        ? 'error.main'
                                        : backup.status === 'running'
                                        ? 'warning.main'
                                        : backup.integrity?.verified
                                        ? 'success.main'
                                        : 'warning.main',
                                  }}
                                />
                                <Typography variant="caption">
                                  {backup.status === 'failed'
                                    ? 'Failed'
                                    : backup.status === 'running'
                                    ? 'Running'
                                    : backup.integrity?.verified
                                    ? 'OK'
                                    : 'Pending'}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell sx={{ py: 0.5 }}>
                              <Stack direction="row" spacing={0.5}>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setSelectedBackup(backup);
                                    setRestoreDialogOpen(true);
                                  }}
                                  disabled={!backup.integrity?.verified || backup.status !== 'completed'}
                                >
                                  Restore
                                </Button>
                                <Button size="small" color="error" onClick={() => deleteBackup(backup.backupId)}>
                                  Delete
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
        {hasUnsavedChanges && (
          <Alert severity="warning" sx={{ mr: 'auto', py: 0.5 }}>
            Unsaved changes
          </Alert>
        )}
        <Button variant="outlined" size="small" onClick={fetchBackupConfig} disabled={loading || saving}>
          Reset
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={saveBackupConfig}
          disabled={!hasUnsavedChanges || saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>

      {/* Restore Confirmation Dialog */}
      <Dialog open={restoreDialogOpen} onClose={() => setRestoreDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm Restore</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will restore your system to the selected backup. Current data will be overwritten.
          </Alert>
          {selectedBackup && (
            <Stack spacing={1}>
              <Typography variant="body2">
                <strong>ID:</strong> {selectedBackup.backupId}
              </Typography>
              <Typography variant="body2">
                <strong>Created:</strong> {new Date(selectedBackup.timestamp).toLocaleString()}
              </Typography>
              <Typography variant="body2">
                <strong>Size:</strong> {formatFileSize(selectedBackup.statistics.totalSize)}
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={() => selectedBackup && restoreFromBackup(selectedBackup)}
            color="warning"
            variant="contained"
          >
            Restore
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
