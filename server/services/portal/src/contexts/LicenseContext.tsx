/**
 * License Context - Provides dual-product license & beta status
 * Fetches license overview on mount when authenticated
 */

'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { licenseClient } from '@/lib/licenseClient';
import type { License } from '@/types/license';
import clientLogger from '@/lib/clientLogger';

export interface BetaSignupStatus {
  status: 'pending' | 'confirmed' | 'invite_sent' | 'converted' | 'unsubscribed';
  product: 'cloud' | 'ai';
  signedUpAt: string;
  invitationSentAt: string | null;
  convertedAt: string | null;
}

interface LicenseOverview {
  cloudLicense: (License & { status: string }) | null;
  aiLicense: (License & { status: string }) | null;
  betaStatus: {
    cloud: BetaSignupStatus | null;
    ai: BetaSignupStatus | null;
  };
  hasActiveCloudLicense: boolean;
  hasActiveAiLicense: boolean;
  isLoading: boolean;
  refreshLicenses: () => Promise<void>;
}

const LicenseContext = createContext<LicenseOverview | undefined>(undefined);

function isActiveLicense(license: (License & { status: string }) | null): boolean {
  if (!license) return false;
  return license.status === 'active';
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [cloudLicense, setCloudLicense] = useState<(License & { status: string }) | null>(null);
  const [aiLicense, setAiLicense] = useState<(License & { status: string }) | null>(null);
  const [betaStatus, setBetaStatus] = useState<{ cloud: BetaSignupStatus | null; ai: BetaSignupStatus | null }>({
    cloud: null,
    ai: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchLicenses = useCallback(async () => {
    if (!isAuthenticated) {
      setCloudLicense(null);
      setAiLicense(null);
      setBetaStatus({ cloud: null, ai: null });
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const [licenseResult, betaResult] = await Promise.allSettled([
        licenseClient.getAllCurrentLicenses(),
        fetch('/api/support/beta/my-status', { credentials: 'include' }).then(r => {
          if (!r.ok) throw new Error(`Beta status request failed: ${r.status}`);
          return r.json();
        }),
      ]);

      if (licenseResult.status === 'fulfilled') {
        const data = licenseResult.value;
        setCloudLicense(data.cloud as (License & { status: string }) | null);
        setAiLicense(data.notelyAi as (License & { status: string }) | null);
      } else {
        clientLogger.warn('[LicenseContext] Failed to fetch licenses', {
          error: licenseResult.reason instanceof Error ? licenseResult.reason.message : String(licenseResult.reason),
        });
        setCloudLicense(null);
        setAiLicense(null);
      }

      if (betaResult.status === 'fulfilled') {
        const betaData = betaResult.value;
        const data = betaData && typeof betaData === 'object' && 'data' in betaData
          ? (betaData as any).data
          : betaData;
        setBetaStatus({
          cloud: data?.cloud ?? null,
          ai: data?.ai ?? null,
        });
      } else {
        clientLogger.warn('[LicenseContext] Failed to fetch beta status', {
          error: betaResult.reason instanceof Error ? betaResult.reason.message : String(betaResult.reason),
        });
        setBetaStatus({ cloud: null, ai: null });
      }
    } catch (err) {
      clientLogger.error('[LicenseContext] Unexpected error fetching license overview', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!authLoading) {
      fetchLicenses();
    }
  }, [authLoading, fetchLicenses]);

  const value = useMemo<LicenseOverview>(
    () => ({
      cloudLicense,
      aiLicense,
      betaStatus,
      hasActiveCloudLicense: isActiveLicense(cloudLicense),
      hasActiveAiLicense: isActiveLicense(aiLicense),
      isLoading,
      refreshLicenses: fetchLicenses,
    }),
    [cloudLicense, aiLicense, betaStatus, isLoading, fetchLicenses]
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicenseOverview(): LicenseOverview {
  const context = useContext(LicenseContext);
  if (!context) {
    throw new Error('useLicenseOverview must be used within LicenseProvider');
  }
  return context;
}
