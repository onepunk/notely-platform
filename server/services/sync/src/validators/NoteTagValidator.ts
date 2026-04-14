/**
 * NoteTag Junction Entity Validator
 * Validates note_tag junction data before persistence to ensure data integrity
 * This is a separate sync entity with its own id for full junction table sync strategy
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates note_tag entity data
 * Ensures all required fields are present and have correct types and values
 * For deleted entities, only id, user_id, deleted, and updated_at are required
 */
export function validate(data: any): ValidationResult {
  const errors: string[] = [];
  const isDeleted = data.deleted === 1;

  // Required fields check - always required
  if (!data.id || typeof data.id !== 'string') {
    errors.push('id is required and must be a string');
  }

  if (!data.user_id || typeof data.user_id !== 'string') {
    errors.push('user_id is required and must be a string');
  }

  if (data.deleted === undefined || data.deleted === null) {
    errors.push('deleted is required');
  } else if (typeof data.deleted !== 'number' || (data.deleted !== 0 && data.deleted !== 1)) {
    errors.push('deleted must be 0 or 1 (not boolean)');
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

  // For non-deleted entities, note_id, tag_id, and created_at are required
  if (!isDeleted) {
    if (!data.note_id || typeof data.note_id !== 'string') {
      errors.push('note_id is required and must be a string');
    }

    if (!data.tag_id || typeof data.tag_id !== 'string') {
      errors.push('tag_id is required and must be a string');
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
  }

  // Optional fields validation
  if (data.sync_version !== undefined && data.sync_version !== null) {
    if (typeof data.sync_version !== 'number' || !Number.isInteger(data.sync_version)) {
      errors.push('sync_version must be an integer');
    }
  }

  if (data.sync_checksum !== undefined && data.sync_checksum !== null) {
    if (typeof data.sync_checksum !== 'string') {
      errors.push('sync_checksum must be a string or null');
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
