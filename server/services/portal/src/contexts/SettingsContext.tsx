import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import clientLogger from '@/lib/clientLogger';

type ColorMode = 'light' | 'dark';

export type Settings = {
  mode: ColorMode;
  navCollapsed: boolean;
  navWidth: number;
};

export type SettingsContextValue = {
  settings: Settings;
  setMode: (mode: ColorMode) => void;
  toggleNavCollapsed: () => void;
};

const defaultSettings: Settings = {
  mode: 'dark',
  navCollapsed: false,
  navWidth: 280,
};

export const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  setMode: () => undefined,
  toggleNavCollapsed: () => undefined,
});

type SettingsProviderProps = {
  children: ReactNode;
};

const SettingsProvider = ({ children }: SettingsProviderProps) => {
  const [settings, setSettings] = useState<Settings>(() => {
    // Load from localStorage on mount
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('portal-settings');
        if (stored) {
          return { ...defaultSettings, ...JSON.parse(stored) };
        }
      } catch (error) {
        clientLogger.error('Failed to load settings from localStorage', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return defaultSettings;
  });

  // Persist to localStorage when settings change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('portal-settings', JSON.stringify(settings));
      } catch (error) {
        clientLogger.error('Failed to save settings to localStorage', { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }, [settings]);

  const setMode = useCallback((mode: ColorMode) => {
    setSettings((prev) => ({ ...prev, mode }));
  }, []);

  const toggleNavCollapsed = useCallback(() => {
    setSettings((prev) => ({ ...prev, navCollapsed: !prev.navCollapsed }));
  }, []);

  const value = useMemo(
    () => ({
      settings,
      setMode,
      toggleNavCollapsed,
    }),
    [settings, setMode, toggleNavCollapsed],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export default SettingsProvider;
