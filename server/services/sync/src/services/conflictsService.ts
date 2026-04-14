import { z } from 'zod';
import { conflictsQuerySchema } from '../validation/admin';

type ConflictsQueryInput = z.infer<typeof conflictsQuerySchema>;

type ConflictRecord = {
  id: string;
  user_id: string;
  user_email: string;
  entity_type: string;
  entity_id: string | null;
  conflict_type: string;
  resolved_at: Date;
  resolution_strategy: string;
  devices_involved: string[];
};

type ConflictsResponse = {
  conflicts: ConflictRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

/**
 * Get sync conflicts.
 *
 * The current cursor-based sync protocol handles conflicts automatically
 * using optimistic locking with version numbers and server-wins resolution.
 *
 * This endpoint returns empty results for backward compatibility.
 * Conflict tracking may be re-implemented in the future if needed.
 */
export async function getConflicts(rawQuery: unknown): Promise<ConflictsResponse> {
  const parsed = conflictsQuerySchema.parse(rawQuery ?? {}) as ConflictsQueryInput;
  const { page, limit } = parsed;

  // Return empty results - conflicts are handled automatically by cursor-based sync
  return {
    conflicts: [],
    pagination: {
      page,
      limit,
      total: 0,
      pages: 0,
    },
  };
}
