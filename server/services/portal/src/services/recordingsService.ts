import { apiRequest } from '@/utils/api';

export interface UserRecording {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  mediaType: 'audio' | 'video';
  status: string;
  durationSeconds: number | null;
  uploadedAt: string;
  transcriptId?: string | null;
  downloadUrl: string;
}

interface ListRecordingsResponse {
  success: boolean;
  recordings: UserRecording[];
}

interface UploadRecordingResponse {
  success: boolean;
  recording: UserRecording;
}

export async function listRecordings(): Promise<UserRecording[]> {
  const response = await apiRequest<ListRecordingsResponse>('/api/portal/recordings');
  return response.recordings || [];
}

export async function uploadRecording(file: File): Promise<UserRecording> {
  const formData = new FormData();
  formData.append('recording', file);

  const response = await apiRequest<UploadRecordingResponse>('/api/portal/recordings', {
    method: 'POST',
    body: formData,
  });

  return response.recording;
}

export async function deleteRecording(recordingId: string): Promise<void> {
  await apiRequest(`/api/portal/recordings/${recordingId}`, {
    method: 'DELETE',
  });
}
