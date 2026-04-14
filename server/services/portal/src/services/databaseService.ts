/**
 * Database Service
 * Handles database table and record operations for admin database viewer
 */

import { apiRequest } from '@/utils/api';

export interface TableInfo {
  name: string;
  count: number;
}

export interface RecordData {
  [key: string]: any;
}

export interface TableRecordsResponse {
  records: RecordData[];
  columns: string[];
  totalCount: number;
}

class DatabaseService {
  // No longer needs axios instance - using centralized apiRequest

  /**
   * Get list of all database tables
   */
  async getTables(database = 'notely_v3'): Promise<TableInfo[]> {
    const response = await apiRequest<{ success: boolean; data: TableInfo[] }>(
      `/api/admin/database/tables?database=${encodeURIComponent(database)}`
    );

    const tableData = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response)
      ? response
      : [];

    return tableData;
  }

  /**
   * Get records from a specific table
   */
  async getTableRecords(
    tableName: string,
    params?: { database?: string; page?: number; limit?: number }
  ): Promise<TableRecordsResponse> {
    const queryParams = new URLSearchParams({
      database: params?.database || 'notely_v3',
      ...(params?.page !== undefined && { page: String(params.page) }),
      ...(params?.limit !== undefined && { limit: String(params.limit) }),
    });

    const response = await apiRequest<TableRecordsResponse | { success: boolean; data: TableRecordsResponse }>(
      `/api/admin/database/tables/${encodeURIComponent(tableName)}/records?${queryParams}`
    );

    // Handle both direct response and wrapped response
    const payload = 'data' in response ? response.data : response;

    return {
      records: payload.records || [],
      columns: payload.columns || [],
      totalCount: Number(payload.totalCount || 0),
    };
  }

  /**
   * Delete a specific record from a table
   */
  async deleteRecord(tableName: string, recordId: string, database = 'notely_v3'): Promise<void> {
    await apiRequest(
      `/api/admin/database/tables/${encodeURIComponent(tableName)}/records/${encodeURIComponent(
        recordId
      )}?database=${encodeURIComponent(database)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Delete all records from a table
   */
  async deleteAllRecords(
    tableName: string,
    database = 'notely_v3'
  ): Promise<{ deletedCount: number }> {
    const response = await apiRequest<{ success: boolean; data: { deletedCount: number } }>(
      `/api/admin/database/tables/${encodeURIComponent(tableName)}/records?scope=all&database=${encodeURIComponent(database)}`,
      { method: 'DELETE' }
    );

    return response.data || { deletedCount: 0 };
  }

  /**
   * Update a specific record (partial update)
   */
  async updateRecord(
    tableName: string,
    recordId: string,
    values: Record<string, unknown>,
    database = 'notely_v3'
  ): Promise<RecordData> {
    const response = await apiRequest<{ success: boolean; data: RecordData }>(
      `/api/admin/database/tables/${encodeURIComponent(tableName)}/records/${encodeURIComponent(
        recordId
      )}?database=${encodeURIComponent(database)}`,
      {
        method: 'PATCH',
        body: { values },
      }
    );

    return response.data;
  }
}

// Export singleton instance
export const databaseService = new DatabaseService();
