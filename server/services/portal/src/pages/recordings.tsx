import type { NextPage } from 'next';
import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';
import { withAuth } from '@/lib/auth/serverAuth';
import { ROLES } from '@notely/shared/constants/roles';
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Stack,
} from '@mui/material';
import MainLayout from '@/components/layout/MainLayout';
import PageContainer from '@/components/common/PageContainer';
import FeatureGate from '@/components/feature-gate/FeatureGate';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DescriptionIcon from '@mui/icons-material/Description';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import toast from 'react-hot-toast';
import type { UserRecording } from '@/services/recordingsService';
import { listRecordings, uploadRecording as uploadRecordingApi, deleteRecording as deleteRecordingApi } from '@/services/recordingsService';

function extractErrorMessage(error: any, fallback: string) {
  const responseMessage = error?.response?.data?.message || error?.response?.data?.error;
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage;
  }
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) {
    return '—';
  }
  const totalSeconds = Math.max(0, seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const RecordingsPage: NextPage = () => {
  const [recordings, setRecordings] = useState<UserRecording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [actionRecordingId, setActionRecordingId] = useState<string | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      setIsLoading(true);
      setFetchError(null);
      const data = await listRecordings();
      setRecordings(data);
    } catch (error: any) {
      setFetchError(extractErrorMessage(error, 'Failed to load recordings'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    const file = files[0];
    try {
      setUploading(true);
      const newRecording = await uploadRecordingApi(file);
      setRecordings((prev) => [newRecording, ...prev]);
      toast.success(`${file.name} uploaded successfully`);
    } catch (error: any) {
      toast.error(extractErrorMessage(error, 'Failed to upload recording'));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleViewTranscript = (recording: UserRecording) => {
    if (!recording.transcriptId) {
      toast('Transcript not available yet for this recording');
      return;
    }
    window.open(`/transcripts/${recording.transcriptId}`, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = (recording: UserRecording) => {
    window.open(recording.downloadUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (recording: UserRecording) => {
    if (!window.confirm(`Delete ${recording.fileName}? This cannot be undone.`)) {
      return;
    }

    try {
      setActionRecordingId(recording.id);
      await deleteRecordingApi(recording.id);
      setRecordings((prev) => prev.filter((item) => item.id !== recording.id));
      toast.success('Recording deleted');
    } catch (error: any) {
      toast.error(extractErrorMessage(error, 'Failed to delete recording'));
    } finally {
      setActionRecordingId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'uploaded':
      case 'processing':
        return 'warning';
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <>
      <Head>
        <title>Recordings · Notely Portal</title>
      </Head>
      <MainLayout>
        <PageContainer
          title="Recordings"
          subtitle="Upload and manage your audio recordings"
        >
          <FeatureGate
            featureKey="upload-recordings"
            isImplemented={true}
            placeholderTitle="Recordings"
            placeholderDescription="Upload and transcribe your audio recordings."
            placeholderIcon={<CloudUploadIcon sx={{ fontSize: 40 }} />}
            featureName="Upload Recordings"
            upgradeDescription="Upload your own audio and video recordings for transcription and analysis."
            upgradeBenefits={[
              'Upload audio and video files',
              'Automatic transcription',
              'Speaker identification',
              'Searchable transcript library',
              'Export to multiple formats'
            ]}
          >
          <Grid container spacing={3}>
            {/* Upload Section */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
                    <CloudUploadIcon sx={{ fontSize: 64, color: 'primary.main' }} />
                    <Typography variant="h6" fontWeight={600}>
                      Upload Audio Recording
                    </Typography>
                    <Typography variant="body2" color="text.secondary" align="center">
                      Upload audio or video files (MP3, WAV, M4A, MP4, MOV, WEBM). Each upload is stored securely and processed for transcription.
                    </Typography>
                    <Button
                      variant="contained"
                      component="label"
                      startIcon={<CloudUploadIcon />}
                      disabled={uploading}
                    >
                      {uploading ? 'Uploading...' : 'Choose File'}
                      <input
                        type="file"
                        hidden
                        accept="audio/*,video/*"
                        onChange={handleFileUpload}
                      />
                    </Button>
                    <Typography variant="caption" color="text.secondary">
                      Max file size: 500 MB
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            {/* Recordings List */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    Your Recordings
                  </Typography>
                  {fetchError && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                      {fetchError}
                    </Alert>
                  )}
                  {isLoading ? (
                    <Box display="flex" justifyContent="center" py={6}>
                      <CircularProgress />
                    </Box>
                  ) : recordings.length === 0 ? (
                    <Box py={4} textAlign="center">
                      <Typography color="text.secondary">
                        You have not uploaded any recordings yet.
                      </Typography>
                    </Box>
                  ) : (
                    <TableContainer component={Paper} variant="outlined">
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableCell>File Name</TableCell>
                            <TableCell>Duration</TableCell>
                            <TableCell>Uploaded</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {recordings.map((recording) => {
                            const transcriptAvailable = Boolean(recording.transcriptId);
                            return (
                              <TableRow key={recording.id} hover>
                                <TableCell>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <PlayArrowIcon fontSize="small" color="action" />
                                    <Box>
                                      <Typography variant="body2">{recording.fileName}</Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {(recording.fileSize / (1024 * 1024)).toFixed(2)} MB · {recording.mediaType}
                                      </Typography>
                                    </Box>
                                  </Stack>
                                </TableCell>
                                <TableCell>{formatDuration(recording.durationSeconds)}</TableCell>
                                <TableCell>{new Date(recording.uploadedAt).toLocaleString()}</TableCell>
                                <TableCell>
                                  <Chip
                                    label={recording.status.replace(/_/g, ' ')}
                                    color={getStatusColor(recording.status)}
                                    size="small"
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                                    {transcriptAvailable && (
                                      <IconButton
                                        size="small"
                                        color="primary"
                                        onClick={() => handleViewTranscript(recording)}
                                        title="View Transcript"
                                      >
                                        <DescriptionIcon fontSize="small" />
                                      </IconButton>
                                    )}
                                    <IconButton
                                      size="small"
                                      color="default"
                                      onClick={() => handleDownload(recording)}
                                      title="Download"
                                    >
                                      <DownloadIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                      size="small"
                                      color="error"
                                      onClick={() => handleDelete(recording)}
                                      title="Delete"
                                      disabled={actionRecordingId === recording.id}
                                    >
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
          </FeatureGate>
        </PageContainer>
      </MainLayout>
    </>
  );
};

export default RecordingsPage;

// Server-side protection - standard users and admins can access
export const getServerSideProps = withAuth([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], { requiredPermission: 'recordings:read' });
