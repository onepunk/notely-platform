/**
 * Settings Service
 * Handles API calls for user settings, Teams configuration, and profile updates
 */

import axios, { AxiosInstance } from 'axios';
import { getApiBasePath } from '@/utils/api';

export interface TeamsConfig {
  teams_enabled: boolean;
  teams_bot_app_id: string;
  teams_tenant_id: string;
  teams_auto_join: boolean;
  teams_email_recipients: string | string[];
}

export interface TeamsStatus {
  microsoftEmail: boolean;
  ms?: {
    sender?: string;
  };
}

export interface CalendarStatus {
  connected: boolean;
  syncStatus?: string | null;
  lastSyncTime?: string | null;
  errorMessage?: string | null;
}

export interface ProfileUpdateData {
  firstName?: string;
  lastName?: string;
  timezone?: string;
}

export interface TeamsSelfStatus {
  enabled: boolean;
  autoJoin: boolean;
  licenseActive: boolean;
  consentStatus: 'not_started' | 'pending' | 'granted' | 'denied';
  consentGrantedAt?: string | null;
  consentUpdatedAt?: string | null;
  tenantId?: string | null;
  emailMode: 'notely_smtp' | 'customer_graph';
  joinMode?: 'acs' | 'graph';
  lastFailureReason?: string | null;
  lastFailureAt?: string | null;
}

export interface BotProfile {
  acsDisplayFirstName: string;
  acsDisplayPrefix: string;
  displayName: string;
  allowedPrefixes: string[];
  defaultPrefix: string;
}

class SettingsService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: getApiBasePath() || '/api',
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true,
    });
  }

  // Profile methods
  async updateProfile(data: ProfileUpdateData) {
    const response = await this.api.put('auth/profile', data);
    return response.data;
  }

  // Teams configuration methods
  async getTeamsConfig(): Promise<TeamsConfig> {
    const response = await this.api.get('admin/config/teams');
    return response.data.config;
  }

  async updateTeamsConfig(config: TeamsConfig) {
    const response = await this.api.post('admin/config/teams', config);
    return response.data;
  }

  async getTeamsStatus(): Promise<TeamsStatus> {
    const response = await this.api.get('admin/teams/status');
    return response.data.data;
  }

  async sendTestEmail(to?: string) {
    const response = await this.api.post('admin/teams/test-email', { to });
    return response.data;
  }

  async enableUserTeams(email: string, enabled: boolean) {
    const response = await this.api.post('admin/teams/enable-user', { email, enabled });
    return response.data;
  }

  async bulkEnableTeams(enabled: boolean, includeAdmins: boolean, confirm: string) {
    const response = await this.api.post('admin/teams/enable-all', {
      enabled,
      includeAdmins,
      confirm,
    });
    return response.data;
  }

  // Calendar methods
  async getCalendarStatus(): Promise<CalendarStatus> {
    const response = await this.api.get('outlook/status');
    return response.data.data;
  }

  async disconnectCalendar() {
    const response = await this.api.delete('outlook/disconnect');
    return response.data;
  }

  // User Teams methods
  async getTeamsSelfStatus(): Promise<TeamsSelfStatus> {
    const response = await this.api.get('teams/self/status');
    return response.data.data;
  }

  async getBotProfile(): Promise<BotProfile> {
    const response = await this.api.get('teams/profile');
    return response.data.data;
  }

  async updateBotProfile(firstName: string, prefix: string) {
    const response = await this.api.put('teams/profile', { firstName, prefix });
    return response.data;
  }

  async getConsentUrl() {
    const response = await this.api.post('teams/self/consent-url');
    return response.data;
  }

  async enableTeamsSelf(autoJoin: boolean, allowPersonal: boolean, tenantId?: string | null) {
    const response = await this.api.post('teams/self/enable', { autoJoin, allowPersonal, tenantId });
    return response.data;
  }

  async disableTeamsSelf() {
    const response = await this.api.post('teams/self/disable');
    return response.data;
  }

  async updateTeamsJoinMode(mode: 'acs' | 'graph') {
    const response = await this.api.put('teams/self/join-mode', { mode });
    return response.data;
  }

  async updateUserJoinMode(email: string, mode: 'acs' | 'graph') {
    const response = await this.api.put('admin/teams/user-join-mode', { email, mode });
    return response.data;
  }
}

const settingsService = new SettingsService();
export default settingsService;
