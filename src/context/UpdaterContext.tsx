import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  checkAppUpdate,
  downloadAndInstallUpdate,
  getCurrentVersion,
  type UpdateInfo,
  type UpdateProgress,
} from "../services/updater";
import { useSettings } from "./SettingsContext";

interface UpdaterContextValue {
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  isDownloading: boolean;
  downloadProgress: UpdateProgress | null;
  error: string | null;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  downloadUpdate: () => Promise<boolean>;
  dismissUpdate: () => void;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load current version on mount
  useEffect(() => {
    getCurrentVersion().then((result) => {
      if (result.ok) {
        setCurrentVersion(result.value);
      }
    });
  }, []);

  // Auto-check on startup if enabled
  useEffect(() => {
    if (settings.autoCheckAppUpdates && currentVersion) {
      const timer = setTimeout(() => {
        checkForUpdates(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [settings.autoCheckAppUpdates, currentVersion]);

  const checkForUpdates = useCallback(async (silent = false) => {
    setIsChecking(true);
    setError(null);

    const result = await checkAppUpdate();

    setIsChecking(false);

    if (result.ok) {
      setUpdateInfo(result.value);
      if (!result.value && !silent) {
        setError("已是最新版本");
        setTimeout(() => setError(null), 3000);
      }
    } else {
      if (!silent) {
        setError(result.error);
        setTimeout(() => setError(null), 3000);
      }
    }
  }, []);

  const downloadUpdate = useCallback(async (): Promise<boolean> => {
    if (!updateInfo) return false;

    setIsDownloading(true);
    setDownloadProgress(null);
    setError(null);

    const result = await downloadAndInstallUpdate((progress) => {
      setDownloadProgress(progress);
    });

    setIsDownloading(false);

    if (result.ok && result.value.success) {
      setUpdateInfo(null);
      return true;
    } else {
      setError(result.ok ? result.value.message : result.error);
      return false;
    }
  }, [updateInfo]);

  const dismissUpdate = useCallback(() => {
    setUpdateInfo(null);
    setError(null);
  }, []);

  return (
    <UpdaterContext.Provider
      value={{
        currentVersion,
        updateInfo,
        isChecking,
        isDownloading,
        downloadProgress,
        error,
        checkForUpdates,
        downloadUpdate,
        dismissUpdate,
      }}
    >
      {children}
    </UpdaterContext.Provider>
  );
}

export function useUpdater() {
  const context = useContext(UpdaterContext);
  if (!context) {
    throw new Error("useUpdater must be used within UpdaterProvider");
  }
  return context;
}