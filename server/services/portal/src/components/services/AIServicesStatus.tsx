/**
 * AI Services Status Component
 * Displays status information for AI models (Whisper, LLM)
 */

import { useState, useEffect } from 'react';
import clientLogger from '@/lib/clientLogger';
import {
  Paper,
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Psychology as PsychologyIcon,
  Memory as MemoryIcon,
  Speed as SpeedIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { resolveApiUrl } from '@/utils/api';

interface AIModel {
  service: string;
  model: string;
  status: 'loaded' | 'loading' | 'error';
  device?: string | null;
  memory?: string;
  performance?: string;
  version?: string;
}

const AIServicesStatus = () => {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAIModels = async () => {
    setLoading(true);
    try {
      const token =
        sessionStorage.getItem('notely_token') || localStorage.getItem('notely_token');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Fetch both Whisper and LLM model status in parallel
      const [whisperResponse, llmResponse] = await Promise.allSettled([
        axios.get(resolveApiUrl('/api/ai/whisper/models'), { headers }),
        axios.get(resolveApiUrl('/api/ai/llm/models'), { headers }),
      ]);

      const modelList: AIModel[] = [];

      // Process Whisper response
      if (whisperResponse.status === 'fulfilled' && whisperResponse.value.data) {
        const whisperData = whisperResponse.value.data;
        const currentModel = whisperData.current_model || 'base';
        const deviceLabel = whisperData.device ? String(whisperData.device) : 'cpu';
        let version = '1.0'; // default
        if (currentModel.includes('large-v3')) version = '3.0';
        else if (currentModel.includes('large-v2')) version = '2.0';

        modelList.push({
          service: 'Whisper (Transcription)',
          model: currentModel,
          status: whisperData.loaded_models?.length > 0 ? 'loaded' : 'error',
          device: deviceLabel,
          memory: whisperData.memory_usage || 'N/A',
          performance: whisperData.performance || 'N/A',
          version: version,
        });
      }

      // Process LLM response
      if (llmResponse.status === 'fulfilled' && llmResponse.value.data) {
        const llmData = llmResponse.value.data;
        const deviceLabel = llmData.device ? String(llmData.device) : 'cpu';
        modelList.push({
          service: 'LLM (Summarization)',
          model: llmData.current_model || 'DialoGPT-medium',
          status: llmData.loaded_models?.length > 0 ? 'loaded' : 'error',
          device: deviceLabel,
          memory: llmData.memory_usage || 'N/A',
          performance: llmData.performance || 'N/A',
        });
      }

      setModels(modelList);
      setError(null);
    } catch (err: any) {
      clientLogger.error('Failed to fetch AI models:', { error: err instanceof Error ? err.message : String(err) });
      setError(err.message || 'Failed to fetch AI model status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAIModels();
    const interval = setInterval(fetchAIModels, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'loaded':
        return <CheckCircleIcon color="success" />;
      case 'loading':
        return <CircularProgress size={20} />;
      case 'error':
        return <ErrorIcon color="error" />;
      default:
        return <WarningIcon color="warning" />;
    }
  };

  const getDeviceChip = (device: string | null | undefined) => {
    const label =
      typeof device === 'string' && device.trim().length > 0 ? device : 'unknown';
    const normalized = label.toLowerCase();
    const isGPU = normalized.includes('cuda') || normalized.includes('gpu');
    return (
      <Chip
        size="small"
        label={label.toUpperCase()}
        color={isGPU ? 'success' : 'default'}
        icon={isGPU ? <SpeedIcon /> : <MemoryIcon />}
      />
    );
  };

  if (loading && models.length === 0) {
    return (
      <Paper sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
          <PsychologyIcon color="primary" />
          <Typography variant="h6">AI Services Status</Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton onClick={fetchAIModels} size="small" disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <List>
        {models.map((model, index) => (
          <ListItem
            key={index}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              mb: 1,
              bgcolor: 'background.default',
            }}
          >
            <ListItemIcon>{getStatusIcon(model.status)}</ListItemIcon>
            <ListItemText
              primary={
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="subtitle1">{model.service}</Typography>
                  {getDeviceChip(model.device)}
                </Box>
              }
              secondary={
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Model: <strong>{model.model}</strong>
                    {model.version && model.version !== '1.0' && ` (Whisper v${model.version})`}
                  </Typography>
                  {model.memory && (
                    <Typography variant="caption" color="text.secondary">
                      Memory: {model.memory}
                    </Typography>
                  )}
                </Box>
              }
            />
          </ListItem>
        ))}
      </List>

      {models.length === 0 && !loading && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography color="text.secondary">No AI services detected</Typography>
        </Box>
      )}

      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          AI models are automatically loaded when needed. GPU acceleration provides faster
          processing.
        </Typography>
      </Box>
    </Paper>
  );
};

export default AIServicesStatus;
