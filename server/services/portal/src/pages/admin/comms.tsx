/**
 * Admin Communications Page
 * Manage email templates with HTML editor, flow visualization, and live preview
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Article as ArticleIcon,
  ArrowForward as ArrowIcon,
  Description as DescriptionIcon,
  Preview as PreviewIcon,
  RestartAlt as ResetIcon,
  Save as SaveIcon,
  Send as SendIcon,
} from '@mui/icons-material';
import { apiRequest } from '@/utils/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string | null;
  html_content?: string;
  description: string | null;
  variables: string[];
  is_base: boolean;
  flow: string | null;
  flow_order: number;
  updated_at: string;
  updated_by: string | null;
  hasDefault?: boolean;
  isModified?: boolean;
}

// Flow colors for visual grouping
const FLOW_COLORS: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error' | 'default'> = {
  'Registration': 'primary',
  'Notely AI': 'secondary',
  'Notely Cloud': 'info',
  'Contact Form': 'success',
  'Admin Alerts': 'warning',
  'Deprecated': 'default',
};

/**
 * Group templates by flow, with base template at the top
 */
function groupByFlow(templates: EmailTemplate[]): { flow: string; templates: EmailTemplate[] }[] {
  const groups: Record<string, EmailTemplate[]> = {};
  const base: EmailTemplate[] = [];

  for (const t of templates) {
    if (t.is_base) {
      base.push(t);
    } else {
      const key = t.flow || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
  }

  // Sort each group by flow_order
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.flow_order - b.flow_order);
  }

  const result: { flow: string; templates: EmailTemplate[] }[] = [];
  if (base.length) result.push({ flow: 'Base', templates: base });
  // Deterministic flow order
  const flowOrder = ['Registration', 'Notely AI', 'Notely Cloud', 'Contact Form', 'Admin Alerts', 'Deprecated', 'Other'];
  for (const flow of flowOrder) {
    if (groups[flow]) result.push({ flow, templates: groups[flow] });
  }
  // Any remaining flows
  for (const flow of Object.keys(groups)) {
    if (!flowOrder.includes(flow)) result.push({ flow, templates: groups[flow] });
  }

  return result;
}

export default function AdminCommsPage() {
  // Template list state
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorSubject, setEditorSubject] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Preview state
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sampleData, setSampleData] = useState<Record<string, string>>({});

  // Test email state
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);

  // Dialogs
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingTemplateName, setPendingTemplateName] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load template list
  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiRequest<{ templates: EmailTemplate[] }>('/api/email/admin/templates');
      setTemplates(data.templates);
    } catch (err: any) {
      setError(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load notification email for pre-populating test email field
  useEffect(() => {
    loadTemplates();
    // Fetch notification config for default test email
    apiRequest<{ config: { registration?: { recipientEmail?: string } } }>('/api/admin/config/notifications')
      .then((data) => {
        const email = data?.config?.registration?.recipientEmail;
        if (email) setTestEmail(email);
      })
      .catch(() => {
        // Silently fail — test email field will just be empty
      });
  }, [loadTemplates]);

  // Load full template details
  const loadTemplate = useCallback(async (name: string) => {
    try {
      const data = await apiRequest<{ template: EmailTemplate }>(`/api/email/admin/templates/${name}`);
      const tmpl = data.template;
      setSelectedTemplate(tmpl);
      setEditorContent(tmpl.html_content || '');
      setEditorSubject(tmpl.subject || '');
      setEditorDescription(tmpl.description || '');
      setIsDirty(false);

      // Initialize sample data from variables
      const initial: Record<string, string> = {};
      (tmpl.variables || []).forEach((v: string) => {
        initial[v] = sampleData[v] || '';
      });
      setSampleData(initial);

      // Auto-load preview
      loadPreview(name, tmpl.html_content || '', initial);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load template');
    }
  }, [sampleData]);

  // Select a template (with unsaved changes check)
  const handleSelectTemplate = (name: string) => {
    if (isDirty) {
      setPendingTemplateName(name);
      setUnsavedDialogOpen(true);
      return;
    }
    loadTemplate(name);
  };

  const confirmDiscardAndSwitch = () => {
    setUnsavedDialogOpen(false);
    if (pendingTemplateName) {
      loadTemplate(pendingTemplateName);
      setPendingTemplateName(null);
    }
  };

  // Save template
  const handleSave = async () => {
    if (!selectedTemplate) return;
    try {
      setSaving(true);
      await apiRequest(`/api/email/admin/templates/${selectedTemplate.name}`, {
        method: 'PUT',
        body: {
          htmlContent: editorContent,
          subject: editorSubject || null,
          description: editorDescription || null,
        },
      });
      toast.success('Template saved');
      setIsDirty(false);
      loadTemplates();
      loadPreview(selectedTemplate.name, editorContent, sampleData);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  // Reset to default
  const handleReset = async () => {
    if (!selectedTemplate) return;
    try {
      setResetDialogOpen(false);
      setSaving(true);
      await apiRequest(`/api/email/admin/templates/${selectedTemplate.name}/reset`, {
        method: 'POST',
      });
      toast.success('Template reset to default');
      loadTemplate(selectedTemplate.name);
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reset template');
    } finally {
      setSaving(false);
    }
  };

  // Load preview
  const loadPreview = async (name?: string, content?: string, data?: Record<string, string>) => {
    const templateName = name || selectedTemplate?.name;
    if (!templateName) return;

    try {
      setPreviewLoading(true);
      const result = await apiRequest<{ html: string }>(
        `/api/email/admin/templates/${templateName}/preview`,
        {
          method: 'POST',
          body: {
            htmlContent: content || editorContent,
            sampleData: data || sampleData,
          },
        }
      );
      setPreviewHtml(result.html);
    } catch (err: any) {
      toast.error('Preview failed: ' + (err.message || 'Unknown error'));
    } finally {
      setPreviewLoading(false);
    }
  };

  // Send test email
  const handleSendTest = async () => {
    if (!selectedTemplate || !testEmail) return;
    try {
      setTestSending(true);
      await apiRequest(`/api/email/admin/templates/${selectedTemplate.name}/test`, {
        method: 'POST',
        body: {
          recipientEmail: testEmail,
          sampleData,
        },
      });
      toast.success(`Test email sent to ${testEmail}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to send test email');
    } finally {
      setTestSending(false);
    }
  };

  // Write preview HTML to iframe
  useEffect(() => {
    if (iframeRef.current && previewHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewHtml);
        doc.close();
      }
    }
  }, [previewHtml]);

  const flowGroups = groupByFlow(templates);

  return (
    <>
      <Head>
        <title>Communications &middot; Notely Admin</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Communications"
          subtitle="Manage email templates"
        >
          {loading && !templates.length ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : (
            <Box sx={{ display: 'flex', gap: 3, minHeight: 600 }}>
              {/* Left Panel — Template List grouped by flow */}
              <Card sx={{ width: 320, flexShrink: 0, overflow: 'auto' }}>
                <CardContent sx={{ p: 0 }}>
                  <Box sx={{ p: 2, pb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Templates ({templates.length})
                    </Typography>
                  </Box>
                  <List disablePadding>
                    {flowGroups.map((group) => (
                      <Box key={group.flow}>
                        <ListSubheader
                          sx={{
                            lineHeight: '32px',
                            bgcolor: 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            px: 2,
                          }}
                        >
                          <Chip
                            label={group.flow}
                            size="small"
                            color={FLOW_COLORS[group.flow] || 'default'}
                            variant="outlined"
                            sx={{ fontSize: '0.7rem', height: 22 }}
                          />
                          {group.flow !== 'Base' && (
                            <Typography variant="caption" color="text.secondary">
                              {group.templates.length} step{group.templates.length !== 1 ? 's' : ''}
                            </Typography>
                          )}
                        </ListSubheader>
                        {group.templates.map((tmpl, idx) => (
                          <ListItemButton
                            key={tmpl.name}
                            selected={selectedTemplate?.name === tmpl.name}
                            onClick={() => handleSelectTemplate(tmpl.name)}
                            sx={{ px: 2, py: 1 }}
                          >
                            <ListItemIcon sx={{ minWidth: 32 }}>
                              {tmpl.is_base ? (
                                <ArticleIcon fontSize="small" color="primary" />
                              ) : (
                                <Tooltip title={`Step ${tmpl.flow_order}`} placement="left">
                                  <Box
                                    sx={{
                                      width: 22,
                                      height: 22,
                                      borderRadius: '50%',
                                      bgcolor: `${FLOW_COLORS[tmpl.flow || ''] || 'default'}.main`,
                                      color: 'white',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                    }}
                                  >
                                    {tmpl.flow_order}
                                  </Box>
                                </Tooltip>
                              )}
                            </ListItemIcon>
                            <ListItemText
                              primary={
                                <Typography variant="body2" noWrap>
                                  {tmpl.name}
                                </Typography>
                              }
                              secondary={tmpl.description || (tmpl.updated_at ? format(new Date(tmpl.updated_at), 'MMM d, yyyy') : null)}
                              secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                            />
                            {/* Show arrow between steps in the same flow */}
                            {!tmpl.is_base && idx < group.templates.length - 1 && (
                              <ArrowIcon sx={{ fontSize: 14, color: 'text.disabled', ml: 0.5 }} />
                            )}
                          </ListItemButton>
                        ))}
                      </Box>
                    ))}
                  </List>
                </CardContent>
              </Card>

              {/* Right Panel */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {!selectedTemplate ? (
                  <Card sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography color="text.secondary">
                      Select a template to edit
                    </Typography>
                  </Card>
                ) : (
                  <Stack spacing={3}>
                    {/* Editor Card */}
                    <Card>
                      <CardContent>
                        <Stack spacing={2}>
                          {/* Header with flow badge */}
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Stack direction="row" spacing={1.5} alignItems="center">
                              <Typography variant="h6">{selectedTemplate.name}</Typography>
                              {selectedTemplate.flow && (
                                <Chip
                                  label={`${selectedTemplate.flow} — Step ${selectedTemplate.flow_order}`}
                                  size="small"
                                  color={FLOW_COLORS[selectedTemplate.flow] || 'default'}
                                  variant="outlined"
                                  sx={{ fontSize: '0.75rem' }}
                                />
                              )}
                            </Stack>
                            <Stack direction="row" spacing={1}>
                              {selectedTemplate.hasDefault && (
                                <Button
                                  variant="outlined"
                                  size="small"
                                  startIcon={<ResetIcon />}
                                  onClick={() => setResetDialogOpen(true)}
                                  disabled={saving}
                                  color="warning"
                                >
                                  Reset to Default
                                </Button>
                              )}
                              <Button
                                variant="contained"
                                size="small"
                                startIcon={<SaveIcon />}
                                onClick={handleSave}
                                disabled={!isDirty || saving}
                              >
                                {saving ? 'Saving...' : 'Save'}
                              </Button>
                            </Stack>
                          </Stack>

                          {/* Description */}
                          <TextField
                            label="Description"
                            size="small"
                            fullWidth
                            value={editorDescription}
                            onChange={(e) => {
                              setEditorDescription(e.target.value);
                              setIsDirty(true);
                            }}
                          />

                          {/* Subject (hidden for base template) */}
                          {!selectedTemplate.is_base && (
                            <TextField
                              label="Default Subject"
                              size="small"
                              fullWidth
                              value={editorSubject}
                              onChange={(e) => {
                                setEditorSubject(e.target.value);
                                setIsDirty(true);
                              }}
                            />
                          )}

                          {/* Variables reference */}
                          {selectedTemplate.variables?.length > 0 && (
                            <Box>
                              <Typography variant="caption" color="text.secondary" gutterBottom>
                                Variables:
                              </Typography>
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {selectedTemplate.variables.map((v: string) => (
                                  <Chip
                                    key={v}
                                    label={`{{${v}}}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                                  />
                                ))}
                              </Stack>
                            </Box>
                          )}

                          {/* HTML Editor */}
                          <TextField
                            label="HTML Content"
                            multiline
                            minRows={12}
                            maxRows={30}
                            fullWidth
                            value={editorContent}
                            onChange={(e) => {
                              setEditorContent(e.target.value);
                              setIsDirty(true);
                            }}
                            slotProps={{
                              input: {
                                sx: {
                                  fontFamily: 'monospace',
                                  fontSize: '0.85rem',
                                  lineHeight: 1.5,
                                },
                              },
                            }}
                          />
                        </Stack>
                      </CardContent>
                    </Card>

                    {/* Preview + Test Card */}
                    <Card>
                      <CardContent>
                        <Stack spacing={2}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="h6">Preview</Typography>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={previewLoading ? <CircularProgress size={16} /> : <PreviewIcon />}
                              onClick={() => loadPreview()}
                              disabled={previewLoading}
                            >
                              Refresh Preview
                            </Button>
                          </Stack>

                          {/* Sample data inputs */}
                          {selectedTemplate.variables?.length > 0 && (
                            <>
                              <Typography variant="caption" color="text.secondary">
                                Sample data for preview:
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {selectedTemplate.variables.map((v: string) => (
                                  <TextField
                                    key={v}
                                    label={v}
                                    size="small"
                                    value={sampleData[v] || ''}
                                    onChange={(e) => {
                                      setSampleData((prev) => ({ ...prev, [v]: e.target.value }));
                                    }}
                                    sx={{ width: 200 }}
                                    slotProps={{
                                      input: {
                                        sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
                                      },
                                    }}
                                  />
                                ))}
                              </Box>
                              <Divider />
                            </>
                          )}

                          {/* Preview iframe */}
                          <Box
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              overflow: 'hidden',
                              bgcolor: '#ffffff',
                            }}
                          >
                            {previewHtml ? (
                              <iframe
                                ref={iframeRef}
                                title="Email Preview"
                                style={{
                                  width: '100%',
                                  minHeight: 500,
                                  border: 'none',
                                  display: 'block',
                                }}
                                sandbox="allow-same-origin"
                              />
                            ) : (
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  minHeight: 200,
                                }}
                              >
                                <Typography color="text.secondary" variant="body2">
                                  Click &quot;Refresh Preview&quot; to render
                                </Typography>
                              </Box>
                            )}
                          </Box>

                          {/* Send Test Email */}
                          {!selectedTemplate.is_base && (
                            <>
                              <Divider />
                              <Stack direction="row" spacing={1.5} alignItems="center">
                                <TextField
                                  label="Test email address"
                                  size="small"
                                  value={testEmail}
                                  onChange={(e) => setTestEmail(e.target.value)}
                                  sx={{ width: 320 }}
                                  slotProps={{
                                    input: {
                                      startAdornment: (
                                        <InputAdornment position="start">
                                          <SendIcon fontSize="small" color="action" />
                                        </InputAdornment>
                                      ),
                                    },
                                  }}
                                />
                                <Button
                                  variant="contained"
                                  size="small"
                                  startIcon={testSending ? <CircularProgress size={16} /> : <SendIcon />}
                                  onClick={handleSendTest}
                                  disabled={!testEmail || testSending || selectedTemplate.is_base}
                                >
                                  {testSending ? 'Sending...' : 'Send Test'}
                                </Button>
                                <Typography variant="caption" color="text.secondary">
                                  Sends a real email using sample data above
                                </Typography>
                              </Stack>
                            </>
                          )}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Stack>
                )}
              </Box>
            </Box>
          )}

          {/* Reset Confirmation Dialog */}
          <Dialog open={resetDialogOpen} onClose={() => setResetDialogOpen(false)}>
            <DialogTitle>Reset to Default?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                This will overwrite the current template content with the original file-system
                default. This action cannot be undone.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setResetDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleReset} color="warning" variant="contained">
                Reset
              </Button>
            </DialogActions>
          </Dialog>

          {/* Unsaved Changes Dialog */}
          <Dialog open={unsavedDialogOpen} onClose={() => setUnsavedDialogOpen(false)}>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogContent>
              <DialogContentText>
                You have unsaved changes. Discard them and switch templates?
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setUnsavedDialogOpen(false)}>Cancel</Button>
              <Button onClick={confirmDiscardAndSwitch} color="error">
                Discard
              </Button>
            </DialogActions>
          </Dialog>
        </PageContainer>
      </MainLayout>
    </>
  );
}

// Server-side protection — only admins can access
export const getServerSideProps = withAuth([ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'comms:read' });
