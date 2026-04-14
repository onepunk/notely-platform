/**
 * Sync Settings Tab
 * Sync system parameters, rate limits, and blob upload configuration
 * Clean, minimal design - no icons, compact inputs
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

interface SyncConfigItem {
  setting_key: string;
  setting_value: string;
  data_type: 'integer' | 'boolean' | 'string' | 'json';
  description: string;
  category: string;
  min_value?: number;
  max_value?: number;
  default_value: string;
  updated_at: string;
  updated_by?: string;
}

interface CategoryConfig {
  [key: string]: SyncConfigItem[];
}

interface CategoryMeta {
  title: string;
  description: string;
}

const categoryInfo: { [key: string]: CategoryMeta } = {
  rate_limiting: {
    title: 'Rate Limiting',
    description: 'Control request rates and prevent abuse',
  },
  c_sync_operations: {
    title: 'Sync Operations',
    description: 'Configure push/pull batch sizes and limits',
  },
  blob_uploads: {
    title: 'Blob Uploads',
    description: 'Settings for chunked file uploads',
  },
  sessions: {
    title: 'Session Management',
    description: 'Timeouts and session handling',
  },
  caching: {
    title: 'Caching & Idempotency',
    description: 'Cache settings and duplicate prevention',
  },
  cleanup: {
    title: 'Data Cleanup',
    description: 'Retention policies and maintenance',
  },
  features: {
    title: 'Feature Flags',
    description: 'Enable/disable sync functionality',
  },
  performance: {
    title: 'Performance',
    description: 'Database and connection settings',
  },
};

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

export default function SyncSettingsTab() {
  const router = useRouter();
  const [config, setConfig] = useState<CategoryConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [changes, setChanges] = useState<{ [key: string]: string }>({});

  const loadSyncConfig = async () => {
    try {
      setLoading(true);

      interface SyncConfigResponse {
        success: boolean;
        data: SyncConfigItem[];
      }

      const data = await apiRequest<SyncConfigResponse>('/api/admin/config/sync');

      // Group by category
      const grouped: CategoryConfig = {};
      data.data.forEach((item: SyncConfigItem) => {
        if (!grouped[item.category]) {
          grouped[item.category] = [];
        }
        grouped[item.category].push(item);
      });

      setConfig(grouped);
      setChanges({});
    } catch (err: any) {
      clientLogger.error('Failed to load sync config:', { error: err instanceof Error ? err.message : String(err) });

      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please login again.');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to view sync configuration');
      } else {
        toast.error(err.message || 'Failed to load sync configuration');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (settingKey: string, value: string) => {
    setChanges((prev) => ({
      ...prev,
      [settingKey]: value,
    }));
  };

  const resetChanges = () => {
    setChanges({});
    toast.success('Changes discarded');
  };

  const saveChanges = async () => {
    if (Object.keys(changes).length === 0) {
      return;
    }

    try {
      setSaving(true);

      const updates = Object.entries(changes).map(([setting_key, setting_value]) => ({
        setting_key,
        setting_value,
        updated_by: 'admin',
      }));

      interface BulkUpdateResponse {
        success: boolean;
      }

      await apiRequest<BulkUpdateResponse>('/api/admin/config/sync/bulk-update', {
        method: 'POST',
        body: { updates },
      });

      toast.success(`Updated ${updates.length} setting${updates.length !== 1 ? 's' : ''}`);
      setChanges({});

      await loadSyncConfig();
    } catch (err: any) {
      clientLogger.error('Failed to save sync config:', { error: err instanceof Error ? err.message : String(err) });

      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please login again.');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to update sync configuration');
      } else {
        toast.error(err.message || 'Failed to save changes');
      }
    } finally {
      setSaving(false);
    }
  };

  const refreshConfigCache = async () => {
    try {
      setRefreshing(true);

      interface RefreshResponse {
        success: boolean;
      }

      await apiRequest<RefreshResponse>('/api/sync/admin/config/refresh', {
        method: 'POST',
      });

      toast.success('Configuration cache refreshed');
    } catch (err: any) {
      clientLogger.error('Failed to refresh cache:', { error: err instanceof Error ? err.message : String(err) });

      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please login again.');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to refresh configuration cache');
      } else {
        toast.error(err.message || 'Failed to refresh cache');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const renderConfigItem = (item: SyncConfigItem) => {
    const currentValue = changes[item.setting_key] ?? item.setting_value;
    const hasChanged = changes[item.setting_key] !== undefined;
    const displayLabel = item.setting_key.replace('sync.', '').replace(/[._]/g, ' ');

    if (item.data_type === 'boolean') {
      return (
        <Box key={item.setting_key} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={hasChanged ? 600 : 500}>
                {displayLabel}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {item.description}
              </Typography>
            </Box>
            <Switch
              checked={currentValue === 'true'}
              onChange={(e) => handleValueChange(item.setting_key, e.target.checked.toString())}
              size="small"
            />
          </Box>
        </Box>
      );
    }

    return (
      <Box key={item.setting_key} sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Box sx={{ flex: '0 0 180px' }}>
            <Typography variant="body2" fontWeight={hasChanged ? 600 : 500}>
              {displayLabel}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {item.description}
            </Typography>
          </Box>
          <TextField
            value={currentValue}
            onChange={(e) => handleValueChange(item.setting_key, e.target.value)}
            type={item.data_type === 'integer' ? 'number' : 'text'}
            size="small"
            sx={{ width: 120 }}
            inputProps={{
              min: item.min_value,
              max: item.max_value,
            }}
            error={
              item.data_type === 'integer' &&
              ((item.min_value !== undefined && parseInt(currentValue) < item.min_value) ||
                (item.max_value !== undefined && parseInt(currentValue) > item.max_value))
            }
          />
        </Box>
        {hasChanged && (
          <Typography variant="caption" color="primary.main" sx={{ ml: 0 }}>
            Changed from: {item.setting_value}
          </Typography>
        )}
      </Box>
    );
  };

  useEffect(() => {
    loadSyncConfig();
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  const totalChanges = Object.keys(changes).length;
  const categories = Object.entries(config);
  const leftCategories = categories.slice(0, Math.ceil(categories.length / 2));
  const rightCategories = categories.slice(Math.ceil(categories.length / 2));

  return (
    <Box>
      {/* Pending Changes Alert */}
      {totalChanges > 0 && (
        <Alert severity="info" sx={{ mb: 3, fontSize: '0.75rem' }}>
          {totalChanges} pending change{totalChanges !== 1 ? 's' : ''}:{' '}
          {Object.keys(changes)
            .map((key) => key.replace('sync.', ''))
            .join(', ')}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Left Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {leftCategories.map(([category, items]) => {
              const categoryMeta = categoryInfo[category] || {
                title: category.replace(/_/g, ' '),
                description: `${category} configuration settings`,
              };

              return (
                <Card key={category} variant="outlined" sx={{ borderRadius: '6px' }}>
                  <CardContent>
                    <SectionHeader>{categoryMeta.title}</SectionHeader>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                      {categoryMeta.description}
                    </Typography>
                    {items.map((item) => renderConfigItem(item))}
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {rightCategories.map(([category, items]) => {
              const categoryMeta = categoryInfo[category] || {
                title: category.replace(/_/g, ' '),
                description: `${category} configuration settings`,
              };

              return (
                <Card key={category} variant="outlined" sx={{ borderRadius: '6px' }}>
                  <CardContent>
                    <SectionHeader>{categoryMeta.title}</SectionHeader>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                      {categoryMeta.description}
                    </Typography>
                    {items.map((item) => renderConfigItem(item))}
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </Grid>
      </Grid>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={refreshConfigCache}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh Cache'}
        </Button>
        {totalChanges > 0 && (
          <Button variant="outlined" size="small" onClick={resetChanges}>
            Discard ({totalChanges})
          </Button>
        )}
        <Button
          variant="contained"
          size="small"
          onClick={saveChanges}
          disabled={saving || totalChanges === 0}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}
