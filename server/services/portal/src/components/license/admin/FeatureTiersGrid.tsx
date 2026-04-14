/**
 * Feature Tiers Grid Component
 * Table-based UI for managing feature tier assignments and implementation status
 */

import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  Checkbox,
  CircularProgress,
  Alert,
  Tooltip,
  Stack,
  Button,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  CheckCircle as ImplementedIcon,
  Schedule as ComingSoonIcon,
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import type { TierWithFeatures, FeatureWithImplementation } from '@/types/license';
import { licenseClient } from '@/lib/licenseClient';
import toast from 'react-hot-toast';

interface UnifiedFeature {
  feature_key: string;
  display_name: string;
  description: string | null;
  feature_category: 'desktop' | 'portal' | 'both';
  is_implemented: boolean;
  minimum_tier_key: string | null;
  minimum_tier_level: number | null;
}

interface TierColumn {
  id: string;
  tier_key: string;
  display_name: string;
  tier_level: number;
  badge_color: string;
}

interface FeatureFormData {
  feature_key: string;
  display_name: string;
  description: string;
  feature_category: 'desktop' | 'portal' | 'both';
  is_implemented: boolean;
}

const defaultFormData: FeatureFormData = {
  feature_key: '',
  display_name: '',
  description: '',
  feature_category: 'both',
  is_implemented: false,
};

export default function FeatureTiersGrid() {
  const [tiers, setTiers] = useState<TierWithFeatures[]>([]);
  const [allFeatures, setAllFeatures] = useState<Map<string, UnifiedFeature>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingFeatures, setUpdatingFeatures] = useState<Set<string>>(new Set());
  const [updatingTierFeatures, setUpdatingTierFeatures] = useState<Set<string>>(new Set());
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Actions menu state
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedFeature, setSelectedFeature] = useState<UnifiedFeature | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<FeatureFormData>(defaultFormData);
  const [isSaving, setIsSaving] = useState(false);

  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchTiersAndFeatures();
  }, []);

  const fetchTiersAndFeatures = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Step 1: Fetch all tiers and all features in parallel
      const [tiersResponse, featuresResponse] = await Promise.all([
        licenseClient.getTiers(),
        licenseClient.getFeatures(),
      ]);

      const sortedTiers = tiersResponse.tiers.sort((a, b) => a.tier_level - b.tier_level);
      setTiers(sortedTiers);

      // Step 2: Build a map of feature_key -> minimum tier assignment
      // by fetching tier features for each tier
      const featureTierAssignments = new Map<string, { tier_key: string; tier_level: number }>();

      await Promise.all(
        sortedTiers.map(async (tier) => {
          try {
            const tierFeaturesResponse = await licenseClient.getTierFeatures(tier.tier_key);

            // For each feature in this tier, track the minimum tier level
            tierFeaturesResponse.feature_details.forEach((feature) => {
              const existing = featureTierAssignments.get(feature.feature_key);
              if (!existing || feature.minimum_tier_level < existing.tier_level) {
                featureTierAssignments.set(feature.feature_key, {
                  tier_key: feature.minimum_tier_key,
                  tier_level: feature.minimum_tier_level,
                });
              }
            });
          } catch (err) {
            console.error(`Failed to fetch features for tier ${tier.tier_key}:`, err);
          }
        })
      );

      // Step 3: Build the unified features map from ALL features
      const featuresMap = new Map<string, UnifiedFeature>();

      featuresResponse.features.forEach((feature) => {
        const tierAssignment = featureTierAssignments.get(feature.feature_key);

        featuresMap.set(feature.feature_key, {
          feature_key: feature.feature_key,
          display_name: feature.display_name,
          description: feature.description ?? null,
          feature_category: feature.feature_category as 'desktop' | 'portal' | 'both',
          is_implemented: feature.is_implemented ?? false,
          minimum_tier_key: tierAssignment?.tier_key ?? null,
          minimum_tier_level: tierAssignment?.tier_level ?? null,
        });
      });

      setAllFeatures(featuresMap);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load feature tiers';
      console.error('Failed to fetch tiers:', err);
      setError(errorMessage);
      toast.error('Failed to load feature tiers');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleImplementation = async (featureKey: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;

    // Add to updating set
    setUpdatingFeatures((prev) => new Set(prev).add(featureKey));

    try {
      await licenseClient.updateFeatureImplementation(featureKey, newStatus);

      // Update local state
      setAllFeatures((prev) => {
        const newMap = new Map(prev);
        const feature = newMap.get(featureKey);
        if (feature) {
          newMap.set(featureKey, { ...feature, is_implemented: newStatus });
        }
        return newMap;
      });

      toast.success(
        `Feature "${featureKey}" marked as ${newStatus ? 'Implemented' : 'Coming Soon'}`
      );
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update feature status';
      console.error('Failed to update feature implementation:', err);
      toast.error(errorMessage);
    } finally {
      // Remove from updating set
      setUpdatingFeatures((prev) => {
        const newSet = new Set(prev);
        newSet.delete(featureKey);
        return newSet;
      });
    }
  };

  const handleToggleTierFeature = async (
    tierId: string,
    tierKey: string,
    featureKey: string,
    isCurrentlyAssigned: boolean
  ) => {
    const updateKey = `${tierId}-${featureKey}`;

    // Prevent double-clicks
    if (updatingTierFeatures.has(updateKey)) {
      return;
    }

    // Add to updating set
    setUpdatingTierFeatures((prev) => new Set(prev).add(updateKey));

    // Save scroll position before update
    const scrollTop = tableContainerRef.current?.scrollTop || 0;

    try {
      if (isCurrentlyAssigned) {
        // Remove feature from tier
        await licenseClient.removeFeatureFromTier(tierId, featureKey);
      } else {
        // Add feature to tier
        await licenseClient.addFeatureToTier(tierId, featureKey);
      }

      // Refresh data to reflect changes
      await fetchTiersAndFeatures();

      // Restore scroll position after data refresh
      requestAnimationFrame(() => {
        if (tableContainerRef.current) {
          tableContainerRef.current.scrollTop = scrollTop;
        }
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update tier feature';
      console.error('Failed to update tier feature:', err);
      toast.error(errorMessage);
    } finally {
      // Remove from updating set
      setUpdatingTierFeatures((prev) => {
        const newSet = new Set(prev);
        newSet.delete(updateKey);
        return newSet;
      });
    }
  };

  // Actions menu handlers
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, feature: UnifiedFeature) => {
    setMenuAnchorEl(event.currentTarget);
    setSelectedFeature(feature);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
  };

  // Dialog handlers
  const handleOpenAddDialog = () => {
    setDialogMode('add');
    setFormData(defaultFormData);
    setDialogOpen(true);
  };

  const handleOpenEditDialog = () => {
    if (selectedFeature) {
      setDialogMode('edit');
      setFormData({
        feature_key: selectedFeature.feature_key,
        display_name: selectedFeature.display_name,
        description: selectedFeature.description || '',
        feature_category: selectedFeature.feature_category,
        is_implemented: selectedFeature.is_implemented,
      });
      setDialogOpen(true);
    }
    handleMenuClose();
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setFormData(defaultFormData);
  };

  const handleFormChange = (field: keyof FeatureFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveFeature = async () => {
    if (!formData.feature_key || !formData.display_name) {
      toast.error('Feature key and display name are required');
      return;
    }

    setIsSaving(true);
    try {
      if (dialogMode === 'add') {
        await licenseClient.createFeature({
          feature_key: formData.feature_key,
          display_name: formData.display_name,
          description: formData.description || null,
          feature_category: formData.feature_category,
          is_implemented: formData.is_implemented,
        });
        toast.success('Feature created successfully');
      } else {
        await licenseClient.updateFeature(formData.feature_key, {
          display_name: formData.display_name,
          description: formData.description || null,
          feature_category: formData.feature_category,
          is_implemented: formData.is_implemented,
        });
        toast.success('Feature updated successfully');
      }
      handleCloseDialog();
      await fetchTiersAndFeatures();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save feature';
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Delete handlers
  const handleOpenDeleteDialog = () => {
    setDeleteDialogOpen(true);
    handleMenuClose();
  };

  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setSelectedFeature(null);
  };

  const handleDeleteFeature = async () => {
    if (!selectedFeature) return;

    setIsDeleting(true);
    try {
      await licenseClient.deleteFeature(selectedFeature.feature_key);
      toast.success('Feature deleted successfully');
      handleCloseDeleteDialog();
      await fetchTiersAndFeatures();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete feature';
      toast.error(errorMessage);
    } finally {
      setIsDeleting(false);
    }
  };

  // Prepare tier columns
  const tierColumns: TierColumn[] = useMemo(() => {
    return tiers.map((tier) => ({
      id: tier.id,
      tier_key: tier.tier_key,
      display_name: tier.display_name,
      tier_level: tier.tier_level,
      badge_color: tier.metadata?.badge_color || 'default',
    }));
  }, [tiers]);

  // Sort features: first by category, then alphabetically by display_name
  const sortedFeatures = useMemo(() => {
    const featuresArray = Array.from(allFeatures.values());

    const categoryOrder: Record<string, number> = {
      desktop: 1,
      portal: 2,
      both: 3,
    };

    return featuresArray.sort((a, b) => {
      // First by category
      const categoryCompare = categoryOrder[a.feature_category] - categoryOrder[b.feature_category];
      if (categoryCompare !== 0) return categoryCompare;

      // Then alphabetically by display_name
      return a.display_name.localeCompare(b.display_name);
    });
  }, [allFeatures]);

  const getTierChipColor = (badgeColor: string) => {
    const colorMap: Record<string, 'info' | 'success' | 'secondary' | 'warning' | 'default'> = {
      blue: 'info',
      green: 'success',
      purple: 'secondary',
      orange: 'warning',
      gold: 'warning',
    };
    return colorMap[badgeColor] || 'default';
  };

  if (isLoading) {
    return (
      <Paper sx={{ p: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" py={8}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper sx={{ p: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Paper>
    );
  }

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden' }}>
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h5" gutterBottom>
            Feature Tiers Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage feature availability and implementation status across tiers
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleOpenAddDialog}
        >
          Add Feature
        </Button>
      </Box>

      <TableContainer ref={tableContainerRef} sx={{ maxHeight: 'calc(100vh - 250px)' }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 200, fontWeight: 600 }}>Feature Name</TableCell>
              <TableCell sx={{ minWidth: 100, fontWeight: 600 }}>Category</TableCell>
              <TableCell sx={{ minWidth: 120, fontWeight: 600 }}>Implemented</TableCell>
              {tierColumns.map((tier) => (
                <TableCell key={tier.tier_key} align="center" sx={{ minWidth: 120 }}>
                  <Chip
                    label={tier.display_name}
                    color={getTierChipColor(tier.badge_color)}
                    size="small"
                    sx={{ fontWeight: 600 }}
                  />
                </TableCell>
              ))}
              <TableCell sx={{ width: 60, fontWeight: 600 }} align="center">
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedFeatures.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4 + tierColumns.length} align="center">
                  <Alert severity="info">No features found</Alert>
                </TableCell>
              </TableRow>
            ) : (
              sortedFeatures.map((feature) => {
                const isUpdating = updatingFeatures.has(feature.feature_key);

                return (
                  <TableRow key={feature.feature_key} hover>
                    {/* Feature Name with Description */}
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography variant="subtitle2">
                          {feature.display_name}
                        </Typography>
                        {feature.description && (
                          <Typography variant="caption" color="text.secondary">
                            {feature.description}
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>

                    {/* Category */}
                    <TableCell>
                      <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                        {feature.feature_category}
                      </Typography>
                    </TableCell>

                    {/* Implemented Toggle */}
                    <TableCell>
                      {isUpdating ? (
                        <CircularProgress size={20} />
                      ) : (
                        <Checkbox
                          checked={feature.is_implemented}
                          onChange={() =>
                            handleToggleImplementation(
                              feature.feature_key,
                              feature.is_implemented
                            )
                          }
                          disabled={isUpdating}
                          color="success"
                          icon={<ComingSoonIcon />}
                          checkedIcon={<ImplementedIcon />}
                        />
                      )}
                    </TableCell>

                    {/* Tier Assignment Checkboxes (EDITABLE) */}
                    {tierColumns.map((tier) => {
                      const isAssignedToTier = feature.minimum_tier_level !== null && feature.minimum_tier_level <= tier.tier_level;
                      const updateKey = `${tier.id}-${feature.feature_key}`;
                      const isUpdatingThisTierFeature = updatingTierFeatures.has(updateKey);

                      return (
                        <TableCell key={tier.tier_key} align="center">
                          {isUpdatingThisTierFeature ? (
                            <CircularProgress size={24} />
                          ) : (
                            <Tooltip
                              title={
                                isAssignedToTier
                                  ? `Click to remove from ${tier.tier_key} tier`
                                  : `Click to add to ${tier.tier_key} tier`
                              }
                              arrow
                            >
                              <Checkbox
                                checked={isAssignedToTier}
                                onChange={() =>
                                  handleToggleTierFeature(
                                    tier.id,
                                    tier.display_name,
                                    feature.feature_key,
                                    isAssignedToTier
                                  )
                                }
                                disabled={isUpdatingThisTierFeature}
                                color="primary"
                              />
                            </Tooltip>
                          )}
                        </TableCell>
                      );
                    })}

                    {/* Actions Menu */}
                    <TableCell align="center">
                      <IconButton
                        size="small"
                        onClick={(e) => handleMenuOpen(e, feature)}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Actions Menu */}
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={handleOpenEditDialog}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleOpenDeleteDialog} sx={{ color: 'error.main' }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Add/Edit Feature Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {dialogMode === 'add' ? 'Add New Feature' : 'Edit Feature'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              label="Feature Key"
              value={formData.feature_key}
              onChange={(e) => handleFormChange('feature_key', e.target.value)}
              disabled={dialogMode === 'edit'}
              fullWidth
              required
              helperText={
                dialogMode === 'add'
                  ? 'Lowercase letters, numbers, hyphens, and underscores only'
                  : 'Feature key cannot be changed'
              }
              placeholder="my-feature-key"
            />
            <TextField
              label="Display Name"
              value={formData.display_name}
              onChange={(e) => handleFormChange('display_name', e.target.value)}
              fullWidth
              required
              placeholder="My Feature Name"
            />
            <TextField
              label="Description"
              value={formData.description}
              onChange={(e) => handleFormChange('description', e.target.value)}
              fullWidth
              multiline
              rows={3}
              placeholder="Describe what this feature does..."
            />
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={formData.feature_category}
                label="Category"
                onChange={(e) =>
                  handleFormChange('feature_category', e.target.value as 'desktop' | 'portal' | 'both')
                }
              >
                <MenuItem value="both">Both</MenuItem>
                <MenuItem value="desktop">Desktop</MenuItem>
                <MenuItem value="portal">Portal</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_implemented}
                  onChange={(e) => handleFormChange('is_implemented', e.target.checked)}
                />
              }
              label="Is Implemented"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseDialog} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveFeature}
            variant="contained"
            disabled={isSaving || !formData.feature_key || !formData.display_name}
          >
            {isSaving ? <CircularProgress size={24} /> : dialogMode === 'add' ? 'Create' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Feature</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the feature{' '}
            <strong>{selectedFeature?.display_name}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This action will deactivate the feature and remove it from all tiers.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseDeleteDialog} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteFeature}
            variant="contained"
            color="error"
            disabled={isDeleting}
          >
            {isDeleting ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
