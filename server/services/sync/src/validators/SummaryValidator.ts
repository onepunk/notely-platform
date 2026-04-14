/**
 * Summary Entity Validator
 * Validates summary data before persistence to ensure data integrity
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_SUMMARY_TYPES = ['full', 'bullet', 'key_points'];

/**
 * Validates summary entity data
 * Ensures all required fields are present and have correct types and values
 */
export function validate(data: any): ValidationResult {
  const errors: string[] = [];

  // Required fields check
  if (!data.id || typeof data.id !== 'string') {
    errors.push('id is required and must be a string');
  }

  if (!data.user_id || typeof data.user_id !== 'string') {
    errors.push('user_id is required and must be a string');
  }

  if (!data.transcription_id || typeof data.transcription_id !== 'string') {
    errors.push('transcription_id is required and must be a string');
  }

  if (!data.summary_type || typeof data.summary_type !== 'string') {
    errors.push('summary_type is required and must be a string');
  } else if (!VALID_SUMMARY_TYPES.includes(data.summary_type)) {
    errors.push(
      `summary_type must be one of: ${VALID_SUMMARY_TYPES.join(', ')}. Got: ${data.summary_type}`
    );
  }

  if (data.deleted === undefined || data.deleted === null) {
    errors.push('deleted is required');
  } else if (typeof data.deleted !== 'number' || (data.deleted !== 0 && data.deleted !== 1)) {
    errors.push('deleted must be 0 or 1 (not boolean)');
  }

  if (data.sync_version === undefined || data.sync_version === null) {
    errors.push('sync_version is required');
  } else if (typeof data.sync_version !== 'number' || !Number.isInteger(data.sync_version)) {
    errors.push('sync_version must be an integer');
  }

  if (!data.created_at) {
    errors.push('created_at is required');
  } else {
    // Handle both number and bigint types
    const createdAt = typeof data.created_at === 'bigint'
      ? Number(data.created_at)
      : data.created_at;

    if (typeof createdAt !== 'number' || createdAt <= 0) {
      errors.push('created_at must be a positive number (milliseconds since epoch)');
    }
  }

  if (!data.updated_at) {
    errors.push('updated_at is required');
  } else {
    // Handle both number and bigint types
    const updatedAt = typeof data.updated_at === 'bigint'
      ? Number(data.updated_at)
      : data.updated_at;

    if (typeof updatedAt !== 'number' || updatedAt <= 0) {
      errors.push('updated_at must be a positive number (milliseconds since epoch)');
    }
  }

  // Optional fields validation
  if (data.summary_text !== undefined && data.summary_text !== null) {
    if (typeof data.summary_text !== 'string') {
      errors.push('summary_text must be a string or null');
    }
  }

  if (data.summary_text_encrypted !== undefined && data.summary_text_encrypted !== null) {
    if (typeof data.summary_text_encrypted !== 'string') {
      errors.push('summary_text_encrypted must be a string or null');
    }
  }

  if (data.is_summary_encrypted !== undefined && data.is_summary_encrypted !== null) {
    if (typeof data.is_summary_encrypted !== 'number' ||
        (data.is_summary_encrypted !== 0 && data.is_summary_encrypted !== 1)) {
      errors.push('is_summary_encrypted must be 0 or 1 (not boolean)');
    }
  }

  if (data.pipeline_used !== undefined && data.pipeline_used !== null) {
    if (typeof data.pipeline_used !== 'number' ||
        (data.pipeline_used !== 0 && data.pipeline_used !== 1)) {
      errors.push('pipeline_used must be 0 or 1 (not boolean)');
    }
  }

  if (data.processing_time_ms !== undefined && data.processing_time_ms !== null) {
    if (typeof data.processing_time_ms !== 'number') {
      errors.push('processing_time_ms must be a number or null');
    } else if (data.processing_time_ms < 0 || !Number.isInteger(data.processing_time_ms)) {
      errors.push('processing_time_ms must be a non-negative integer');
    }
  }

  if (data.model_used !== undefined && data.model_used !== null) {
    if (typeof data.model_used !== 'string') {
      errors.push('model_used must be a string or null');
    }
  }

  if (data.backend_type !== undefined && data.backend_type !== null) {
    if (typeof data.backend_type !== 'string') {
      errors.push('backend_type must be a string or null');
    }
  }

  if (data.checksum !== undefined && data.checksum !== null) {
    if (typeof data.checksum !== 'string') {
      errors.push('checksum must be a string or null');
    }
  }

  if (data.server_updated_at !== undefined && data.server_updated_at !== null) {
    // Handle both number and bigint types
    const serverUpdatedAt = typeof data.server_updated_at === 'bigint'
      ? Number(data.server_updated_at)
      : data.server_updated_at;

    if (typeof serverUpdatedAt !== 'number' || serverUpdatedAt <= 0) {
      errors.push('server_updated_at must be a positive number (milliseconds since epoch) or null');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
