import { tauriInvoke, type Result } from "./tauri";
import type { LibraryRepoStatus, RepoPreflightResult, RepoConnectInput } from "../types";

/**
 * Preflight check for repo connection
 * Maps to backend: repo_preflight(RepoPreflightInput) -> RepoPreflightResult
 */
export async function repoPreflight(
  input: {
    path?: string;
    localPath?: string;
    remoteUrl?: string;
    branch?: string;
  }
): Promise<Result<RepoPreflightResult>> {
  return tauriInvoke<RepoPreflightResult>("repo_preflight", { input });
}

/**
 * Connect to a git repository
 * Maps to backend: repo_connect(RepoConnectInput) -> RepoStatus
 */
export async function repoConnect(input: RepoConnectInput): Promise<Result<LibraryRepoStatus>> {
  return tauriInvoke<LibraryRepoStatus>("repo_connect", { input });
}

/**
 * Get current repo connection status
 * Maps to backend: repo_status() -> RepoStatus
 */
export async function repoStatus(): Promise<Result<LibraryRepoStatus>> {
  return tauriInvoke<LibraryRepoStatus>("repo_status");
}

/**
 * Git pull on connected repo
 * Maps to backend: repo_pull() -> RepoStatus
 */
export async function repoPull(): Promise<Result<LibraryRepoStatus>> {
  return tauriInvoke<LibraryRepoStatus>("repo_pull");
}

/**
 * Git push on connected repo
 * Maps to backend: repo_push() -> RepoStatus
 */
export async function repoPush(): Promise<Result<LibraryRepoStatus>> {
  return tauriInvoke<LibraryRepoStatus>("repo_push");
}

/**
 * Git sync (pull only) on connected repo
 * Maps to backend: repo_sync() -> RepoStatus
 */
export async function repoSync(): Promise<Result<LibraryRepoStatus>> {
  return tauriInvoke<LibraryRepoStatus>("repo_sync");
}