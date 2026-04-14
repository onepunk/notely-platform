/**
 * AI Prompt Templates Management Page
 *
 * Allows admins to manage prompt templates used for AI summary generation.
 * Layout mirrors the desktop-ai PromptsTab: left sidebar template list,
 * right editor with System Prompt / Output Structure sub-tabs.
 */

import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Add as AddIcon,
  ContentCopy as CloneIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Undo as DiscardIcon,
  CheckCircle as ActiveIcon,
} from '@mui/icons-material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import { promptService, PromptTemplate } from '@/services/promptService';
import toast from 'react-hot-toast';

/** Parse output_structure JSON into extraction and refinement fields. */
function parseOutputStructure(raw: string): { extraction: string; refinement: string } {
  try {
    const parsed = JSON.parse(raw);
    return {
      extraction: parsed.chunk_extraction ?? '',
      refinement: parsed.refinement ?? '',
    };
  } catch {
    return { extraction: '', refinement: '' };
  }
}

export default function PromptsPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState(0); // 0 = System Prompt, 1 = Output Structure
  const [editedPrompt, setEditedPrompt] = useState('');
  const [editedExtraction, setEditedExtraction] = useState('');
  const [editedRefinement, setEditedRefinement] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId]
  );

  const isReadOnly = selectedTemplate?.is_default ?? false;
  const isActive = selectedTemplate?.is_active ?? false;

  // Fetch templates
  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const data = await promptService.list();
      setTemplates(data.templates);
      if (!selectedId && data.templates.length > 0) {
        setSelectedId(data.templates[0].id);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to load prompt templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load selected template into editor
  useEffect(() => {
    if (selectedTemplate) {
      setEditedPrompt(selectedTemplate.system_prompt);
      const fields = parseOutputStructure(selectedTemplate.output_structure);
      setEditedExtraction(fields.extraction);
      setEditedRefinement(fields.refinement);
      setIsDirty(false);
    }
  }, [selectedTemplate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!selectedId || isReadOnly) return;
    try {
      await promptService.update(selectedId, {
        system_prompt: editedPrompt,
        output_structure: JSON.stringify({
          chunk_extraction: editedExtraction,
          refinement: editedRefinement,
        }),
      });
      setIsDirty(false);
      toast.success('Template saved');
      fetchTemplates();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save template');
    }
  };

  const handleDiscard = () => {
    if (selectedTemplate) {
      setEditedPrompt(selectedTemplate.system_prompt);
      const fields = parseOutputStructure(selectedTemplate.output_structure);
      setEditedExtraction(fields.extraction);
      setEditedRefinement(fields.refinement);
      setIsDirty(false);
    }
  };

  const handleCreate = async () => {
    if (!newTemplateName.trim()) return;
    try {
      const created = await promptService.create({
        name: newTemplateName.trim(),
        system_prompt: '',
        output_structure: JSON.stringify({ chunk_extraction: '', refinement: '' }),
      });
      setCreateDialogOpen(false);
      setNewTemplateName('');
      toast.success('Template created');
      await fetchTemplates();
      setSelectedId(created.id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create template');
    }
  };

  const handleClone = async () => {
    if (!selectedTemplate) return;
    try {
      const created = await promptService.create({
        name: `${selectedTemplate.name} (Copy)`,
        system_prompt: selectedTemplate.system_prompt,
        output_structure: selectedTemplate.output_structure,
      });
      toast.success('Template cloned');
      await fetchTemplates();
      setSelectedId(created.id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to clone template');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await promptService.delete(id);
      toast.success('Template deleted');
      if (selectedId === id) {
        const remaining = templates.filter((t) => t.id !== id);
        setSelectedId(remaining.length > 0 ? remaining[0].id : null);
      }
      fetchTemplates();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete template');
    }
  };

  const handleActivate = async () => {
    if (!selectedId) return;
    try {
      await promptService.activate(selectedId);
      toast.success('Template activated');
      fetchTemplates();
    } catch (error: any) {
      toast.error(error.message || 'Failed to activate template');
    }
  };

  return (
    <MainLayout>
      <Head>
        <title>Prompts | Notely Admin</title>
      </Head>
      <PageContainer title="AI Prompt Templates" subtitle="Manage prompt templates for AI summary generation.">
        <Box sx={{ display: 'flex', gap: 3, minHeight: 500 }}>
          {/* Left sidebar: Template list */}
          <Box sx={{ width: 280, flexShrink: 0, borderRight: 1, borderColor: 'divider', pr: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle2">Templates</Typography>
              <Tooltip title="New Template">
                <IconButton size="small" onClick={() => setCreateDialogOpen(true)}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <List dense disablePadding>
              {templates.map((t) => (
                <ListItemButton
                  key={t.id}
                  selected={t.id === selectedId}
                  onClick={() => setSelectedId(t.id)}
                  sx={{ borderRadius: 1, mb: 0.5 }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" noWrap>{t.name}</Typography>
                        {t.is_active && <Chip label="Active" size="small" color="success" sx={{ height: 20 }} />}
                        {t.is_default && <Chip label="Default" size="small" variant="outlined" sx={{ height: 20 }} />}
                      </Stack>
                    }
                  />
                  {!t.is_default && (
                    <IconButton
                      size="small"
                      edge="end"
                      onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </ListItemButton>
              ))}
            </List>
          </Box>

          {/* Right panel: Editor */}
          <Box sx={{ flex: 1 }}>
            {selectedTemplate ? (
              <>
                {/* Header */}
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="h6">{selectedTemplate.name}</Typography>
                  <Stack direction="row" spacing={1}>
                    {isActive ? (
                      <Chip icon={<ActiveIcon />} label="Active Template" color="success" size="small" />
                    ) : (
                      <Button size="small" variant="contained" onClick={handleActivate}>
                        Set as Active
                      </Button>
                    )}
                    <Button size="small" variant="outlined" startIcon={<CloneIcon />} onClick={handleClone}>
                      Clone
                    </Button>
                  </Stack>
                </Stack>

                <Divider sx={{ mb: 2 }} />

                {/* Sub-tabs */}
                <Tabs value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mb: 2 }}>
                  <Tab label="System Prompt" />
                  <Tab label="Output Structure" />
                </Tabs>

                {subTab === 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      Instructions sent to the AI before the transcript. Leave empty to use defaults.
                    </Typography>
                    <TextField
                      multiline
                      fullWidth
                      minRows={8}
                      maxRows={16}
                      value={editedPrompt}
                      onChange={(e) => { setEditedPrompt(e.target.value); setIsDirty(true); }}
                      disabled={isReadOnly}
                      placeholder={isReadOnly ? 'Default system prompt (managed by the AI backend)' : 'Enter your custom system prompt...'}
                    />
                  </Box>
                )}

                {subTab === 1 && (
                  <Stack spacing={3}>
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>Step 1: Data Extraction</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                        Instructions for extracting structured data from each transcript chunk.
                      </Typography>
                      <TextField
                        multiline
                        fullWidth
                        minRows={6}
                        maxRows={12}
                        value={editedExtraction}
                        onChange={(e) => { setEditedExtraction(e.target.value); setIsDirty(true); }}
                        disabled={isReadOnly}
                        placeholder={isReadOnly ? 'Default extraction prompt (managed by the AI backend)' : 'Enter instructions for extracting data...'}
                      />
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>Step 2: Final Summary</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                        Instructions for producing the final polished summary from extracted data.
                      </Typography>
                      <TextField
                        multiline
                        fullWidth
                        minRows={6}
                        maxRows={12}
                        value={editedRefinement}
                        onChange={(e) => { setEditedRefinement(e.target.value); setIsDirty(true); }}
                        disabled={isReadOnly}
                        placeholder={isReadOnly ? 'Default refinement prompt (managed by the AI backend)' : 'Enter instructions for the final summary...'}
                      />
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      Placeholders: {'{base_prompt}'} inserts your system prompt. {'{text}'} is replaced with the transcript or extracted data.
                    </Typography>
                  </Stack>
                )}

                {/* Save / Discard buttons */}
                {!isReadOnly && (
                  <Stack direction="row" spacing={1} mt={3}>
                    <Button
                      variant="contained"
                      startIcon={<SaveIcon />}
                      onClick={handleSave}
                      disabled={!isDirty}
                    >
                      Save
                    </Button>
                    {isDirty && (
                      <Button variant="outlined" startIcon={<DiscardIcon />} onClick={handleDiscard}>
                        Discard
                      </Button>
                    )}
                  </Stack>
                )}
              </>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Typography color="text.secondary">
                  Select a template from the list or create a new one.
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* Create Template Dialog */}
        <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>New Prompt Template</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              label="Template Name"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate} disabled={!newTemplateName.trim()}>
              Create
            </Button>
          </DialogActions>
        </Dialog>
      </PageContainer>
    </MainLayout>
  );
}

export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'system:admin' });
