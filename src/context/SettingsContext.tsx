import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getCurrentWindow, type Theme as TauriTheme } from "@tauri-apps/api/window";
import { settingsGet, settingsSet, defaultSettings } from "../services/settings";
import type { AppSettings } from "../services/settings";
import type { BackupSource } from "../types";

interface SettingsContextValue {
  settings: AppSettings;
  loading: boolean;
  error: string | null;
  updateSettings: (updates: Partial<AppSettings>) => Promise<boolean>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
const BACKUP_SOURCE_STORAGE_KEY = "skill-switch_backup_source";

function readBackupSourceCache(): BackupSource | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(BACKUP_SOURCE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as BackupSource;
  } catch {
    return null;
  }
}

function writeBackupSourceCache(source: BackupSource | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!source) {
      window.localStorage.removeItem(BACKUP_SOURCE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(BACKUP_SOURCE_STORAGE_KEY, JSON.stringify(source));
  } catch {
    // Ignore storage failures. Settings still persist through the backend.
  }
}

type ResolvedTheme = Exclude<AppSettings["theme"], "system">;

function resolveFallbackTheme(): ResolvedTheme {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function resolveTauriTheme(theme: TauriTheme | null | undefined): ResolvedTheme {
  return theme === "dark" ? "dark" : "light";
}

function applyDocumentTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      const result = await settingsGet();
      if (result.ok) {
        const cachedBackupSource = readBackupSourceCache();
        const backupSource = result.value.backupSource ?? cachedBackupSource ?? null;
        setSettings({ ...result.value, backupSource });
        writeBackupSourceCache(backupSource);
      } else {
        setError(result.error);
      }
      setLoading(false);
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;

    const updateResolvedTheme = (theme: ResolvedTheme) => {
      if (!disposed) {
        applyDocumentTheme(theme);
      }
    };

    const syncTheme = async () => {
      if (settings.theme === "light" || settings.theme === "dark") {
        updateResolvedTheme(settings.theme);
        return;
      }

      try {
        const currentWindow = getCurrentWindow();
        updateResolvedTheme(resolveTauriTheme(await currentWindow.theme()));

        const unlisten = await currentWindow.onThemeChanged(({ payload }) => {
          updateResolvedTheme(resolveTauriTheme(payload));
        });

        if (disposed) {
          unlisten();
          return;
        }

        cleanup = unlisten;
        return;
      } catch {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const mediaHandler = (event: MediaQueryListEvent) => {
          updateResolvedTheme(event.matches ? "dark" : "light");
        };

        updateResolvedTheme(media.matches ? "dark" : "light");

        if (typeof media.addEventListener === "function") {
          media.addEventListener("change", mediaHandler);
          cleanup = () => media.removeEventListener("change", mediaHandler);
          return;
        }

        media.addListener(mediaHandler);
        cleanup = () => media.removeListener(mediaHandler);
      }
    };

    updateResolvedTheme(
      settings.theme === "system" ? resolveFallbackTheme() : settings.theme
    );
    void syncTheme();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [settings.theme]);

  const updateSettings = useCallback(async (updates: Partial<AppSettings>): Promise<boolean> => {
    const newSettings = { ...settings, ...updates };
    const result = await settingsSet(newSettings);
    if (result.ok) {
      setSettings(newSettings);
      if ("backupSource" in updates) {
        writeBackupSourceCache(newSettings.backupSource ?? null);
      }
      return true;
    }
    setError(result.error);
    return false;
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, loading, error, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
