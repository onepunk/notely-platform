/**
 * Transcription Entity Validator
 * Validates transcription data before persistence to ensure data integrity
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_STATUSES = ['recording', 'completing', 'completed'];

/**
 * Validates transcription entity data
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

  if (!data.transcription_text && data.transcription_text !== null) {
    // Allow null for in-progress transcriptions
    if (data.transcription_text === undefined) {
      errors.push('transcription_text is required (can be null for in-progress)');
    }
  } else if (data.transcription_text !== null && typeof data.transcription_text !== 'string') {
    errors.push('transcription_text must be a string or null');
  }

  if (!data.language || typeof data.language !== 'string') {
    errors.push('language is required and must be a string');
  }

  if (!data.status || typeof data.status !== 'string') {
    errors.push('status is required and must be a string');
  } else if (!VALID_STATUSES.includes(data.status)) {
    errors.push(
      `status must be one of: ${VALID_STATUSES.join(', ')}. Got: ${data.status}`
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
  } else if (typeof data.created_at !== 'number' || data.created_at <= 0) {
    errors.push('created_at must be a positive number (milliseconds since epoch)');
  }

  if (!data.updated_at) {
    errors.push('updated_at is required');
  } else if (typeof data.updated_at !== 'number' || data.updated_at <= 0) {
    errors.push('updated_at must be a positive number (milliseconds since epoch)');
  }

  // Optional fields validation
  if (data.note_id !== undefined && data.note_id !== null && typeof data.note_id !== 'string') {
    errors.push('note_id must be a string or null');
  }

  if (data.binder_id !== undefined && data.binder_id !== null && typeof data.binder_id !== 'string') {
    errors.push('binder_id must be a string or null');
  }

  if (data.start_time !== undefined && data.start_time !== null) {
    if (typeof data.start_time !== 'number' || data.start_time <= 0) {
      errors.push('start_time must be a positive number (milliseconds since epoch) or null');
    }
  }

  if (data.end_time !== undefined && data.end_time !== null) {
    if (typeof data.end_time !== 'number' || data.end_time <= 0) {
      errors.push('end_time must be a positive number (milliseconds since epoch) or null');
    }
  }

  if (data.duration_ms !== undefined && data.duration_ms !== null) {
    if (typeof data.duration_ms !== 'number') {
      errors.push('duration_ms must be a number or null');
    } else if (data.duration_ms < 0 || !Number.isInteger(data.duration_ms)) {
      errors.push('duration_ms must be a non-negative integer');
    }
  }

  if (data.char_count !== undefined && data.char_count !== null) {
    if (typeof data.char_count !== 'number') {
      errors.push('char_count must be a number or null');
    } else if (data.char_count < 0 || !Number.isInteger(data.char_count)) {
      errors.push('char_count must be a non-negative integer');
    }
  }

  if (data.word_count !== undefined && data.word_count !== null) {
    if (typeof data.word_count !== 'number') {
      errors.push('word_count must be a number or null');
    } else if (data.word_count < 0 || !Number.isInteger(data.word_count)) {
      errors.push('word_count must be a non-negative integer');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
