import { tauriInvoke, type Result } from "./tauri";
import type { AppSettings, BackupSource, ThirdPartyRepo } from "../types";

export type { AppSettings } from "../types";

export const DEFAULT_THIRD_PARTY_REPOS: ThirdPartyRepo[] = [
  {
    id: "anthropics-skills",
    url: "https://github.com/anthropics/skills",
    label: "anthropics/skills",
    enabled: true,
    addedAt: 0,
    localPath: null,
    lastSyncedAt: null,
  },
  {
    id: "composio-awesome",
    url: "https://github.com/ComposioHQ/awesome-claude-skills",
    label: "ComposioHQ/awesome-claude-skills",
    enabled: true,
    addedAt: 0,
    localPath: null,
    lastSyncedAt: null,
  },
  {
    id: "openai-skills",
    url: "https://github.com/openai/skills",
    label: "openai/skills",
    enabled: true,
    addedAt: 0,
    localPath: null,
    lastSyncedAt: null,
  },
];

const defaultSettings: AppSettings = {
  theme: "system",
  locale: "zh-CN",
  autoCheckUpdates: true,
  autoCheckAppUpdates: true,
  autoStart: false,
  backupPath: null,
  maxBackups: 10,
  backupSource: null,
  thirdPartyRepos: DEFAULT_THIRD_PARTY_REPOS,
};

function normalizeBackupSource(source: BackupSource | null | undefined): BackupSource | null {
  if (!source) {
    return null;
  }

  return {
    enabled: source.enabled,
    repo: source.repo,
    label: source.label,
    remoteUrl: source.remoteUrl,
    branch: source.branch || "main",
    localPath: source.localPath ?? null,
    lastSyncedAt: source.lastSyncedAt ?? null,
  };
}

/**
 * Get app settings
 * Maps to backend: settings_get -> AppSettings
 */
export async function settingsGet(): Promise<Result<AppSettings>> {
  const result = await tauriInvoke<AppSettings>("settings_get");
  if (result.ok) {
    // Ensure thirdPartyRepos exists (backwards compat)
    if (!result.value.thirdPartyRepos) {
      result.value.thirdPartyRepos = DEFAULT_THIRD_PARTY_REPOS;
    } else {
      result.value.thirdPartyRepos = result.value.thirdPartyRepos.map((repo) => ({
        ...repo,
        localPath: repo.localPath ?? null,
        lastSyncedAt: repo.lastSyncedAt ?? null,
      }));
    }
    result.value.backupSource = normalizeBackupSource(result.value.backupSource);
  }
  return result;
}

/**
 * Set app settings
 * Maps to backend: settings_set(settings) -> ()
 */
export async function settingsSet(settings: AppSettings): Promise<Result<void>> {
  return tauriInvoke<void>("settings_set", { settings });
}

export { defaultSettings };
