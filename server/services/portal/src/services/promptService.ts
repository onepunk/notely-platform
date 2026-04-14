import { apiRequest } from '@/utils/api';

export interface PromptTemplate {
  id: string;
  name: string;
  system_prompt: string;
  output_structure: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePromptInput {
  name: string;
  system_prompt: string;
  output_structure: string;
}

export interface UpdatePromptInput {
  name?: string;
  system_prompt?: string;
  output_structure?: string;
}

export const promptService = {
  list: () =>
    apiRequest<{ templates: PromptTemplate[] }>('/api/admin/prompts'),

  get: (id: string) =>
    apiRequest<PromptTemplate>(`/api/admin/prompts/${id}`),

  create: (data: CreatePromptInput) =>
    apiRequest<PromptTemplate>('/api/admin/prompts', { method: 'POST', body: data }),

  update: (id: string, data: UpdatePromptInput) =>
    apiRequest<PromptTemplate>(`/api/admin/prompts/${id}`, { method: 'PUT', body: data }),

  delete: (id: string) =>
    apiRequest(`/api/admin/prompts/${id}`, { method: 'DELETE' }),

  activate: (id: string) =>
    apiRequest(`/api/admin/prompts/${id}/activate`, { method: 'POST' }),
};
