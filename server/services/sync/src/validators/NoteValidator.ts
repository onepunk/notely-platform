/**
 * Note Entity Validator
 * Validates note data before persistence to ensure data integrity
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that content is valid Lexical JSON if present
 * Lexical JSON should be a valid JSON string containing editor state
 */
function isValidLexicalJson(content: string): boolean {
  try {
    const parsed = JSON.parse(content);
    // Basic structure check - Lexical JSON should be an object with a root node
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

/**
 * Validates note entity data
 * Ensures all required fields are present and have correct types and values
 */
export function validate(data: any): ValidationResult {
  console.error('[NOTE_VALIDATOR] Starting validation', {
    hasData: !!data,
    dataType: typeof data,
    keys: data ? Object.keys(data) : []
  });

  const errors: string[] = [];

  // Required fields check
  console.error('[NOTE_VALIDATOR] Checking id', {
    hasId: !!data.id,
    idType: typeof data.id,
    idValue: data.id
  });
  if (!data.id || typeof data.id !== 'string') {
    errors.push('id is required and must be a string');
  }

  console.error('[NOTE_VALIDATOR] Checking user_id', {
    hasUserId: !!data.user_id,
    userIdType: typeof data.user_id,
    userIdValue: data.user_id
  });
  if (!data.user_id || typeof data.user_id !== 'string') {
    errors.push('user_id is required and must be a string');
  }

  console.error('[NOTE_VALIDATOR] Checking binder_id', {
    hasBinderId: !!data.binder_id,
    binderIdType: typeof data.binder_id,
    binderIdValue: data.binder_id
  });
  if (!data.binder_id || typeof data.binder_id !== 'string') {
    errors.push('binder_id is required and must be a string');
  }

  console.error('[NOTE_VALIDATOR] Checking title', {
    hasTitle: data.title !== undefined && data.title !== null,
    titleType: typeof data.title,
    titleValue: data.title
  });
  if (data.title === undefined || data.title === null || typeof data.title !== 'string') {
    errors.push('title is required and must be a string');
  }

  console.error('[NOTE_VALIDATOR] Checking deleted', {
    hasDeleted: data.deleted !== undefined && data.deleted !== null,
    deletedType: typeof data.deleted,
    deletedValue: data.deleted
  });
  if (data.deleted === undefined || data.deleted === null) {
    errors.push('deleted is required');
  } else if (typeof data.deleted !== 'number' || (data.deleted !== 0 && data.deleted !== 1)) {
    errors.push('deleted must be 0 or 1 (not boolean)');
  }

  console.error('[NOTE_VALIDATOR] Checking created_at', {
    hasCreatedAt: !!data.created_at,
    createdAtType: typeof data.created_at,
    createdAtValue: data.created_at
  });
  if (!data.created_at) {
    errors.push('created_at is required');
  } else if (typeof data.created_at !== 'number' || data.created_at <= 0) {
    errors.push('created_at must be a positive number (milliseconds since epoch)');
  }

  console.error('[NOTE_VALIDATOR] Checking updated_at', {
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
  if (data.content !== undefined && data.content !== null) {
    if (typeof data.content !== 'string') {
      errors.push('content must be a string or null');
    } else if (data.content.trim().length > 0 && !isValidLexicalJson(data.content)) {
      errors.push('content must be valid Lexical JSON format');
    }
  }

  if (data.sort_index !== undefined) {
    if (typeof data.sort_index !== 'number') {
      errors.push('sort_index must be a number');
    } else if (data.sort_index < 0 || !Number.isInteger(data.sort_index)) {
      errors.push('sort_index must be a non-negative integer');
    }
  }

  if (data.pinned !== undefined && data.pinned !== null) {
    if (typeof data.pinned !== 'number' || (data.pinned !== 0 && data.pinned !== 1)) {
      errors.push('pinned must be 0 or 1 (not boolean)');
    }
  }

  if (data.starred !== undefined && data.starred !== null) {
    if (typeof data.starred !== 'number' || (data.starred !== 0 && data.starred !== 1)) {
      errors.push('starred must be 0 or 1 (not boolean)');
    }
  }

  if (data.archived !== undefined && data.archived !== null) {
    if (typeof data.archived !== 'number' || (data.archived !== 0 && data.archived !== 1)) {
      errors.push('archived must be 0 or 1 (not boolean)');
    }
  }

  if (data.deleted_at !== undefined && data.deleted_at !== null) {
    if (typeof data.deleted_at !== 'number' || data.deleted_at <= 0) {
      errors.push('deleted_at must be a positive number (milliseconds since epoch) or null');
    }
  }

  console.error('[NOTE_VALIDATOR] Validation complete', {
    valid: errors.length === 0,
    errorCount: errors.length,
    errors
  });

  return {
    valid: errors.length === 0,
    errors
  };
}
