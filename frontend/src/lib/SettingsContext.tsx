import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getAppInfo, getSettings, type AppInfo, type AppSettings } from "./api";
import { useAuth } from "./AuthContext";

interface SettingsContextValue {
  appInfo: AppInfo | null;
  settings: AppSettings | null;
  /** Settings were fetched once (successfully or not) */
  loaded: boolean;
  /** Required API keys that are not configured yet (empty once loaded and complete). */
  missingKeys: ("groq_api_key" | "openrouter_api_key")[];
  refresh: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  appInfo: null,
  settings: null,
  loaded: false,
  missingKeys: [],
  refresh: async () => {},
});

const REQUIRED_KEYS = ["groq_api_key", "openrouter_api_key"] as const;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSettings(await getSettings());
    } catch {
      // Not signed in yet / API unreachable — the banner simply stays hidden
    } finally {
      setLoaded(true);
    }
  }, []);

  const { user } = useAuth();

  useEffect(() => {
    getAppInfo().then(setAppInfo).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  const missingKeys = settings ? REQUIRED_KEYS.filter((k) => !settings.keys[k]?.configured) : [];

  return (
    <SettingsContext.Provider value={{ appInfo, settings, loaded, missingKeys, refresh }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
