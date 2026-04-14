/**
 * Support API Client
 * Handles communication with the Support microservice via the Gateway
 */

import { apiRequest } from '@/utils/api';
import clientLogger from '@/lib/clientLogger';

// =============================================================================
// Types
// =============================================================================

export interface Ticket {
  id: string;
  ticketNumber: string;
  userEmail: string;
  userFirstName?: string;
  userLastName?: string;
  subject: string;
  description?: string;
  status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  source: 'portal' | 'email';
  assignedTo?: string;
  assignedToEmail?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  closedAt?: string;
  messages?: Message[];
}

export interface Message {
  id: string;
  ticketId?: string;
  userId?: string;
  senderEmail: string;
  senderName?: string;
  message: string;
  isInternal: boolean;
  source?: string;
  createdAt: string;
}

export interface TicketStats {
  byStatus: {
    open: number;
    inProgress: number;
    waiting: number;
    resolved: number;
    closed: number;
  };
  priority: {
    urgent: number;
    high: number;
  };
  activity: {
    createdLast24h: number;
    resolvedLast24h: number;
  };
}

export interface CreateTicketData {
  subject: string;
  description: string;
  category?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface UpdateTicketData {
  status?: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  category?: string;
  assigned_to?: string | null;
}

export interface DiagnosticsBundle {
  id: string;
  user_id: string;
  user_email: string;
  filename: string;
  size_bytes: number;
  app_version: string | null;
  platform: string | null;
  os_version: string | null;
  arch: string | null;
  cpu_model: string | null;
  cpu_cores: number | null;
  total_memory_gb: number | null;
  gpu_name: string | null;
  status: 'pending_review' | 'reviewed' | 'dismissed';
  scan_result: 'pending' | 'clean' | 'infected';
  scan_details?: string;
  admin_notes?: string;
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  analysis_status?: 'in_progress' | 'completed' | 'failed' | null;
  analysis_result?: string | null;
  analysis_error?: string | null;
  analysis_started_at?: string | null;
  analysis_completed_at?: string | null;
}

// =============================================================================
// API Client
// =============================================================================

class SupportClient {
  /**
   * Create a new support ticket
   */
  async createTicket(data: CreateTicketData): Promise<Ticket> {
    try {
      const response = await apiRequest<{ success: boolean; ticket: Ticket }>(
        '/api/support/tickets',
        {
          method: 'POST',
          body: data,
        }
      );
      return response.ticket;
    } catch (error: any) {
      clientLogger.error('[Support] Failed to create ticket', { error: error.message });
      throw error;
    }
  }

  /**
   * Get current user's tickets
   */
  async getMyTickets(params?: { status?: string; limit?: number; offset?: number }): Promise<{
    tickets: Ticket[];
    pagination: { limit: number; offset: number };
  }> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.status) queryParams.append('status', params.status);
      if (params?.limit) queryParams.append('limit', String(params.limit));
      if (params?.offset) queryParams.append('offset', String(params.offset));

      const queryString = queryParams.toString();
      const url = `/api/support/tickets${queryString ? `?${queryString}` : ''}`;

      return await apiRequest<{ success: boolean; tickets: Ticket[]; pagination: { limit: number; offset: number } }>(url);
    } catch (error: any) {
      clientLogger.error('[Support] Failed to get tickets', { error: error.message });
      throw error;
    }
  }

  /**
   * Get a specific ticket with messages
   */
  async getTicket(ticketId: string): Promise<Ticket> {
    try {
      const response = await apiRequest<{ success: boolean; ticket: Ticket }>(
        `/api/support/tickets/${ticketId}`
      );
      return response.ticket;
    } catch (error: any) {
      clientLogger.error('[Support] Failed to get ticket', { error: error.message, ticketId });
      throw error;
    }
  }

  /**
   * Add a reply to a ticket
   */
  async addReply(ticketId: string, message: string): Promise<Message> {
    try {
      const response = await apiRequest<{ success: boolean; message: Message }>(
        `/api/support/tickets/${ticketId}/messages`,
        {
          method: 'POST',
          body: { message },
        }
      );
      return response.message;
    } catch (error: any) {
      clientLogger.error('[Support] Failed to add reply', { error: error.message, ticketId });
      throw error;
    }
  }

  // =========================================================================
  // Admin Methods
  // =========================================================================

  /**
   * Get all tickets (admin)
   */
  async getAllTickets(params?: {
    status?: string;
    priority?: string;
    assigned_to?: string;
    search?: string;
    created_since?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ tickets: Ticket[]; pagination: { limit: number; offset: number } }> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.status) queryParams.append('status', params.status);
      if (params?.priority) queryParams.append('priority', params.priority);
      if (params?.assigned_to) queryParams.append('assigned_to', params.assigned_to);
      if (params?.search) queryParams.append('search', params.search);
      if (params?.created_since) queryParams.append('created_since', params.created_since);
      if (params?.limit) queryParams.append('limit', String(params.limit));
      if (params?.offset) queryParams.append('offset', String(params.offset));

      const queryString = queryParams.toString();
      const url = `/api/support/admin/tickets${queryString ? `?${queryString}` : ''}`;

      return await apiRequest<{ success: boolean; tickets: Ticket[]; pagination: { limit: number; offset: number } }>(url);
    } catch (error: any) {
      clientLogger.error('[Support] Failed to get admin tickets', { error: error.message });
      throw error;
    }
  }

  /**
   * Get ticket statistics (admin)
   */
  async getStats(): Promise<TicketStats> {
    try {
      const response = await apiRequest<{ success: boolean; stats: TicketStats }>(
        '/api/support/admin/tickets/stats'
      );
      return response.stats;
    } catch (error: any) {
      clientLogger.error('[Support] Failed to get stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Get ticket detail (admin view with internal notes)
   */
  async getAdminTicket(ticketId: string): Promise<Ticket> {
    try {
      const response = await apiRequest<{ success: boolean; ticket: Ticket }>(
        `/api/support/admin/tickets/${ticketId}`
      );
      return response.ticket;
    } catch (error: any) {
      clientLogger.error('[Support] Failed to get admin ticket', { error: error.message, ticketId });
      throw error;
    }
  }

  /**
   * Update ticket (admin)
   */
  async updateTicket(ticketId: string, updates: UpdateTicketData): Promise<Ticket> {
    try {
      const response = await apiRequest<{ success: boolean; ticket: Ticket }>(
        `/api/support/admin/tickets/${ticketId}`,
        {
          method: 'PATCH',
          body: updates,
        }
      );
      return response.ticket;
    } catch (error: any) {
      clientLogger.error('[Support] Failed to update ticket', { error: error.message, ticketId });
      throw error;
    }
  }

  /**
   * Add internal note (admin)
   */
  async addInternalNote(ticketId: string, note: string): Promise<Message> {
    try {
      const response = await apiRequest<{ success: boolean; note: Message }>(
        `/api/support/admin/tickets/${ticketId}/notes`,
        {
          method: 'POST',
          body: { note },
        }
      );
      return response.note;
    } catch (error: any) {
      clientLogger.error('[Support] Failed to add internal note', { error: error.message, ticketId });
      throw error;
    }
  }

  // =========================================================================
  // Diagnostics Methods
  // =========================================================================

  /**
   * Upload a diagnostics bundle
   */
  async uploadDiagnostics(file: File): Promise<{ bundleId: string }> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/support/diagnostics/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `Upload failed (${response.status})`);
      }

      return await response.json();
    } catch (error: any) {
      clientLogger.error('[Support] Failed to upload diagnostics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get current user's diagnostics bundles
   */
  async getMyDiagnostics(): Promise<{ bundles: DiagnosticsBundle[] }> {
    try {
      return await apiRequest<{ bundles: DiagnosticsBundle[] }>('/api/support/diagnostics');
    } catch (error: any) {
      clientLogger.error('[Support] Failed to get diagnostics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all diagnostics bundles (admin)
   */
  async getAdminDiagnostics(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ bundles: DiagnosticsBundle[]; total: number }> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.status) queryParams.append('status', params.status);
      if (params?.limit) queryParams.append('limit', String(params.limit));
      if (params?.offset) queryParams.append('offset', String(params.offset));

      const queryString = queryParams.toString();
      const url = `/api/support/admin/diagnostics${queryString ? `?${queryString}` : ''}`;

      return await apiRequest<{ bundles: DiagnosticsBundle[]; total: number }>(url);
    } catch (error: any) {
      clientLogger.error('[Support] Failed to get admin diagnostics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get a diagnostics bundle detail (admin)
   */
  async getDiagnosticsBundle(id: string): Promise<DiagnosticsBundle> {
    try {
      return await apiRequest<DiagnosticsBundle>(`/api/support/admin/diagnostics/${id}`);
    } catch (error: any) {
      clientLogger.error('[Support] Failed to get diagnostics bundle', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Download a diagnostics bundle (admin)
   */
  async downloadBundle(id: string): Promise<void> {
    window.open(`/api/support/admin/diagnostics/${id}/download`, '_blank');
  }

  /**
   * Update a diagnostics bundle (admin)
   */
  async updateBundle(
    id: string,
    data: { status?: string; admin_notes?: string }
  ): Promise<DiagnosticsBundle> {
    try {
      return await apiRequest<DiagnosticsBundle>(`/api/support/admin/diagnostics/${id}`, {
        method: 'PATCH',
        body: data,
      });
    } catch (error: any) {
      clientLogger.error('[Support] Failed to update diagnostics bundle', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Trigger AI analysis of a diagnostics bundle (admin)
   */
  async analyzeBundle(id: string): Promise<{ status: string; bundleId: string }> {
    try {
      return await apiRequest<{ status: string; bundleId: string }>(
        `/api/support/admin/diagnostics/${id}/analyze`,
        { method: 'POST' }
      );
    } catch (error: any) {
      clientLogger.error('[Support] Failed to trigger analysis', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Delete a diagnostics bundle (admin)
   */
  async deleteBundle(id: string): Promise<void> {
    try {
      await apiRequest(`/api/support/admin/diagnostics/${id}`, {
        method: 'DELETE',
      });
    } catch (error: any) {
      clientLogger.error('[Support] Failed to delete diagnostics bundle', { error: error.message, id });
      throw error;
    }
  }
}

// Export singleton instance
export const supportClient = new SupportClient();

export default SupportClient;
