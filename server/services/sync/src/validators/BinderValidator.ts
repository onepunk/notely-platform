/**
 * Binder Entity Validator
 * Validates binder data before persistence to ensure data integrity
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_BINDER_TYPES = ['USER', 'SHARED', 'ARCHIVED', 'SYSTEM'];

/**
 * Validates binder entity data
 * Ensures all required fields are present and have correct types and values
 */
export function validate(data: any): ValidationResult {
  console.error('[BINDER_VALIDATOR] Starting validation', {
    hasData: !!data,
    dataType: typeof data,
    keys: data ? Object.keys(data) : []
  });

  const errors: string[] = [];

  // Required fields check
  console.error('[BINDER_VALIDATOR] Checking id', {
    hasId: !!data.id,
    idType: typeof data.id,
    idValue: data.id
  });
  if (!data.id || typeof data.id !== 'string') {
    errors.push('id is required and must be a string');
  }

  console.error('[BINDER_VALIDATOR] Checking user_id', {
    hasUserId: !!data.user_id,
    userIdType: typeof data.user_id,
    userIdValue: data.user_id
  });
  if (!data.user_id || typeof data.user_id !== 'string') {
    errors.push('user_id is required and must be a string');
  }

  console.error('[BINDER_VALIDATOR] Checking name', {
    hasName: !!data.name,
    nameType: typeof data.name,
    nameValue: data.name
  });
  if (!data.name || typeof data.name !== 'string') {
    errors.push('name is required and must be a string');
  }

  console.error('[BINDER_VALIDATOR] Checking binder_type', {
    hasBinderType: !!data.binder_type,
    binderTypeType: typeof data.binder_type,
    binderTypeValue: data.binder_type,
    validTypes: VALID_BINDER_TYPES
  });
  if (!data.binder_type || typeof data.binder_type !== 'string') {
    errors.push('binder_type is required and must be a string');
  } else if (!VALID_BINDER_TYPES.includes(data.binder_type)) {
    errors.push(
      `binder_type must be one of: ${VALID_BINDER_TYPES.join(', ')}. Got: ${data.binder_type}`
    );
  }

  console.error('[BINDER_VALIDATOR] Checking deleted', {
    hasDeleted: data.deleted !== undefined && data.deleted !== null,
    deletedType: typeof data.deleted,
    deletedValue: data.deleted
  });
  if (data.deleted === undefined || data.deleted === null) {
    errors.push('deleted is required');
  } else if (typeof data.deleted !== 'number' || (data.deleted !== 0 && data.deleted !== 1)) {
    errors.push('deleted must be 0 or 1 (not boolean)');
  }

  console.error('[BINDER_VALIDATOR] Checking created_at', {
    hasCreatedAt: !!data.created_at,
    createdAtType: typeof data.created_at,
    createdAtValue: data.created_at
  });
  if (!data.created_at) {
    errors.push('created_at is required');
  } else if (typeof data.created_at !== 'number' || data.created_at <= 0) {
    errors.push('created_at must be a positive number (milliseconds since epoch)');
  }

  console.error('[BINDER_VALIDATOR] Checking updated_at', {
    hasUpdatedAt: !!data.updated_at,
    updatedAtType: typeof data.updated_at,
    updatedAtValue: data.updated_at
  });
  if (!data.updated_at) {
    errors.push('updated_at is required');
  } else if (typeof data.updated_at !== 'number' || data.updated_at <= 0) {
    errors.push('updated_at must be a positive number (milliseconds since epoch)');
  }

  // Optional fields validation
  if (data.color !== undefined && data.color !== null && typeof data.color !== 'string') {
    errors.push('color must be a string or null');
  }

  if (data.icon !== undefined && data.icon !== null && typeof data.icon !== 'string') {
    errors.push('icon must be a string or null');
  }

  if (data.sort_index !== undefined) {
    if (typeof data.sort_index !== 'number') {
      errors.push('sort_index must be a number');
    } else if (!Number.isInteger(data.sort_index)) {
      errors.push('sort_index must be an integer');
    } else if (data.sort_index < 0 && data.binder_type !== 'SYSTEM') {
      errors.push('sort_index must be non-negative for non-system binders');
    }
  }

  if (data.deleted_at !== undefined && data.deleted_at !== null) {
    if (typeof data.deleted_at !== 'number' || data.deleted_at <= 0) {
      errors.push('deleted_at must be a positive number (milliseconds since epoch) or null');
    }
  }

  console.error('[BINDER_VALIDATOR] Validation complete', {
    valid: errors.length === 0,
    errorCount: errors.length,
    errors
  });

  return {
    valid: errors.length === 0,
    errors
  };
}
