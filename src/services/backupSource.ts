import { tauriInvoke, type Result } from "./tauri";
import type { BackupSourceStatus } from "../types";

export const BACKUP_SOURCE_REPO_ID = "__backup_source__";

export async function backupSourceStatus(): Promise<Result<BackupSourceStatus>> {
  return tauriInvoke<BackupSourceStatus>("backup_source_status");
}

export async function backupSourceConnect(): Promise<Result<BackupSourceStatus>> {
  return tauriInvoke<BackupSourceStatus>("backup_source_connect");
}

export async function backupSourcePull(): Promise<Result<BackupSourceStatus>> {
  return tauriInvoke<BackupSourceStatus>("backup_source_pull");
}

export async function backupSourcePush(): Promise<Result<BackupSourceStatus>> {
  return tauriInvoke<BackupSourceStatus>("backup_source_push");
}
