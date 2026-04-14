/**
 * AI Settings Tab
 * AI model and transcription configuration for Whisper and LLM services
 * Clean, minimal design - no icons, compact inputs
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import clientLogger from '@/lib/clientLogger';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  Grid,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import toast from 'react-hot-toast';
import { apiRequest, AuthenticationError, AuthorizationError } from '@/utils/api';

interface WhisperModel {
  name: string;
  version: string;
  description: string;
  memoryRequirement: string;
  performance: string;
}

const WHISPER_MODELS: WhisperModel[] = [
  { name: 'tiny', version: '1.0', description: 'Fastest, least accurate', memoryRequirement: '~39 MB', performance: 'Very Fast' },
  { name: 'base', version: '1.0', description: 'Balanced speed/accuracy', memoryRequirement: '~74 MB', performance: 'Fast' },
  { name: 'small', version: '1.0', description: 'Better accuracy', memoryRequirement: '~244 MB', performance: 'Medium' },
  { name: 'medium', version: '1.0', description: 'High accuracy', memoryRequirement: '~769 MB', performance: 'Medium' },
  { name: 'large-v2', version: '2.0', description: 'Very high accuracy', memoryRequirement: '~1550 MB', performance: 'Slow' },
  { name: 'large-v3', version: '3.0', description: 'Highest accuracy', memoryRequirement: '~1550 MB', performance: 'Slow' },
];

interface AIStatus {
  whisper: {
    current_model: string;
    device: string;
    loaded_models: string[];
    available_models: string[];
    status: string;
  };
  llm: {
    current_model: string;
    device: string;
    loaded_models: string[];
    available_models?: string[];
    status: string;
    backend?: string;
    device_info?: any;
    config?: any;
  };
}

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
    <Box sx={{ width: 200 }}>{children}</Box>
  </Box>
);

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

// Status row component
const StatusRow = ({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: 'healthy' | 'error' | 'unknown';
}) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 4, mb: 1.5 }}>
    <Box sx={{ flex: '0 0 200px' }}>
      <Typography variant="body2" fontWeight={500}>
        {label}
      </Typography>
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {status && (
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: status === 'healthy' ? 'success.main' : status === 'error' ? 'error.main' : 'warning.main',
          }}
        />
      )}
      <Typography variant="body2" color="text.secondary">
        {value}
      </Typography>
    </Box>
  </Box>
);

export default function AISettingsTab() {
  const router = useRouter();
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [selectedWhisperModel, setSelectedWhisperModel] = useState('');
  const [autoReload, setAutoReload] = useState(true);
  const [llmGpuEnabled, setLlmGpuEnabled] = useState(false);
  const [llmAutoReload, setLlmAutoReload] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);

  const fetchAiConfig = async () => {
    try {
      const data = await apiRequest<{ config?: { whisper?: any; llm?: any } }>(
        '/api/admin/config/ai'
      );

      const config = data?.config || {};
      const whisper = config.whisper || {};
      const llm = config.llm || {};

      if (typeof whisper.model === 'string') {
        setSelectedWhisperModel(whisper.model);
      }
      if (typeof whisper.autoReload === 'boolean') {
        setAutoReload(whisper.autoReload);
      }

      const preference = String(llm.devicePreference || 'cpu').toLowerCase();
      setLlmGpuEnabled(preference === 'cuda');
      if (typeof llm.autoReload === 'boolean') {
        setLlmAutoReload(llm.autoReload);
      }
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to access AI configuration');
        return;
      }
      clientLogger.error('Failed to fetch AI config:', { error: err instanceof Error ? err.message : String(err) });
      toast.error('Failed to load AI configuration');
    }
  };

  const fetchAIStatus = async () => {
    setLoading(true);
    try {
      const [whisperResult, llmResult] = await Promise.allSettled([
        apiRequest<any>('/api/portal/admin/ai/whisper/models'),
        apiRequest<any>('/api/portal/admin/ai/llm/models'),
      ]);

      let whisperData = {
        current_model: 'unknown',
        device: 'unknown',
        loaded_models: [],
        available_models: [],
        status: 'error',
      };
      let llmData = { current_model: 'unknown', device: 'unknown', loaded_models: [], status: 'error' };

      if (whisperResult.status === 'fulfilled') {
        whisperData = whisperResult.value;
      }
      if (llmResult.status === 'fulfilled') {
        llmData = llmResult.value;
      }

      setAiStatus({ whisper: whisperData, llm: llmData });
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to access AI status');
        return;
      }
      clientLogger.error('Failed to fetch AI status:', { error: err instanceof Error ? err.message : String(err) });
      toast.error('Failed to fetch AI service status');
    } finally {
      setLoading(false);
    }
  };

  const saveWhisperModel = async () => {
    if (!selectedWhisperModel) return;

    setSaving(true);
    const isLargeModel = selectedWhisperModel.includes('large');
    if (isLargeModel) {
      toast.loading('Loading large model... This may take 5-10 minutes', { duration: 10000 });
    }

    try {
      await apiRequest('/api/admin/config/ai', {
        method: 'POST',
        body: { whisper: { model: selectedWhisperModel, autoReload } },
        timeout: isLargeModel ? 600000 : 60000,
      });

      toast.success(`Whisper model updated to ${selectedWhisperModel}`);
      fetchAiConfig();
      setTimeout(() => fetchAIStatus(), autoReload ? 5000 : 1000);
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to update AI configuration');
        return;
      }
      if (err.code === 'REQUEST_TIMEOUT' && isLargeModel) {
        toast.error('Request timed out. Model is likely still loading in background.');
      } else {
        toast.error(err.message || 'Failed to update Whisper model');
      }
    } finally {
      setSaving(false);
    }
  };

  const saveLlmConfiguration = async () => {
    setLlmSaving(true);
    try {
      await apiRequest('/api/admin/config/ai', {
        method: 'POST',
        body: { llm: { devicePreference: llmGpuEnabled ? 'cuda' : 'cpu', autoReload: llmAutoReload } },
      });

      toast.success(`LLM configuration updated`);
      fetchAiConfig();
      setTimeout(() => fetchAIStatus(), llmAutoReload ? 5000 : 1000);
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
        return;
      }
      if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to update LLM configuration');
        return;
      }
      toast.error(err.message || 'Failed to update LLM configuration');
    } finally {
      setLlmSaving(false);
    }
  };

  useEffect(() => {
    fetchAiConfig().finally(() => fetchAIStatus());
    const interval = setInterval(fetchAIStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusText = (status: string): 'healthy' | 'error' | 'unknown' => {
    if (status === 'healthy' || status === 'loaded') return 'healthy';
    if (status === 'error' || status === 'unhealthy') return 'error';
    return 'unknown';
  };

  if (loading && !aiStatus) {
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
            {/* Service Status */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Service Status</SectionHeader>
                <StatusRow
                  label="Whisper"
                  value={`${aiStatus?.whisper.current_model || 'Unknown'} (${aiStatus?.whisper.device || 'unknown'})`}
                  status={getStatusText(aiStatus?.whisper.status || 'unknown')}
                />
                <StatusRow
                  label="LLM"
                  value={`${aiStatus?.llm.current_model || 'Unknown'} (${aiStatus?.llm.device || 'unknown'})`}
                  status={getStatusText(aiStatus?.llm.status || 'unknown')}
                />
                {aiStatus?.llm.backend && (
                  <StatusRow label="Backend" value={aiStatus.llm.backend} />
                )}
              </CardContent>
            </Card>

            {/* LLM Configuration */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>LLM Configuration</SectionHeader>
                <ToggleRow
                  label="GPU acceleration"
                  description="Use CUDA if available"
                  checked={llmGpuEnabled}
                  onChange={setLlmGpuEnabled}
                  disabled={llmSaving}
                />
                <ToggleRow
                  label="Auto-reload"
                  description="Restart on config change"
                  checked={llmAutoReload}
                  onChange={setLlmAutoReload}
                  disabled={llmSaving}
                />
                {llmGpuEnabled && aiStatus?.llm.device !== 'cuda' && (
                  <Alert severity="warning" sx={{ mt: 2, fontSize: '0.75rem' }}>
                    GPU enabled but service running on CPU
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={6}>
          <Stack spacing={3}>
            {/* Whisper Configuration */}
            <Card variant="outlined" sx={{ borderRadius: '6px' }}>
              <CardContent>
                <SectionHeader>Whisper Configuration</SectionHeader>
                <FieldRow label="Model" description="Speech-to-text model">
                  <FormControl size="small" fullWidth>
                    <Select
                      value={selectedWhisperModel}
                      onChange={(e) => setSelectedWhisperModel(e.target.value)}
                      disabled={saving}
                      displayEmpty
                    >
                      {WHISPER_MODELS.map((model) => (
                        <MenuItem key={model.name} value={model.name}>
                          {model.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </FieldRow>
                <ToggleRow
                  label="Auto-reload"
                  description="Restart on model change"
                  checked={autoReload}
                  onChange={setAutoReload}
                  disabled={saving}
                />
                {selectedWhisperModel && (
                  <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: '4px' }}>
                    <Typography variant="caption" color="text.secondary">
                      {WHISPER_MODELS.find(m => m.name === selectedWhisperModel)?.description} •{' '}
                      {WHISPER_MODELS.find(m => m.name === selectedWhisperModel)?.memoryRequirement} •{' '}
                      {WHISPER_MODELS.find(m => m.name === selectedWhisperModel)?.performance}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => { fetchAiConfig(); fetchAIStatus(); }}
          disabled={loading || saving || llmSaving}
        >
          Reset
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={() => { saveWhisperModel(); saveLlmConfiguration(); }}
          disabled={saving || llmSaving}
        >
          {saving || llmSaving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}
