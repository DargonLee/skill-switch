import { listen } from "@tauri-apps/api/event";
import { tauriInvoke, type Result } from "./tauri";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total?: number;
}

export interface UpdateResult {
  success: boolean;
  message: string;
  requiresRestart: boolean;
}

/**
 * Check if an app update is available
 */
export async function checkAppUpdate(): Promise<Result<UpdateInfo | null>> {
  return tauriInvoke<UpdateInfo | null>("check_app_update");
}

/**
 * Download and install the update
 * @param onProgress - Callback for download progress
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void
): Promise<Result<UpdateResult>> {
  let unlisten: (() => void) | null = null;

  if (onProgress) {
    unlisten = await listen<UpdateProgress>("update-progress", (event) => {
      onProgress(event.payload);
    });
  }

  try {
    const result = await tauriInvoke<UpdateResult>("download_and_install_update");
    return result;
  } finally {
    if (unlisten) {
      unlisten();
    }
  }
}

/**
 * Get the current app version
 */
export async function getCurrentVersion(): Promise<Result<string>> {
  return tauriInvoke<string>("get_current_version");
}