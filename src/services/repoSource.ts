import { tauriInvoke, type Result } from "./tauri";
import type { RemoteSkill, ThirdPartyRepo } from "../types";

export const SOURCE_NOT_SYNCED_ERROR = "source repo has not been synced locally yet";
export const SOURCE_INVALID_GIT_ERROR = "local source repo is missing git metadata, please sync again";

export function repoSourceNeedsSync(error?: string | null): boolean {
  if (!error) return false;
  return error.includes(SOURCE_NOT_SYNCED_ERROR) || error.includes(SOURCE_INVALID_GIT_ERROR);
}

export async function repoSourceSync(repo: ThirdPartyRepo): Promise<Result<ThirdPartyRepo>> {
  return tauriInvoke<ThirdPartyRepo>("repo_source_sync", { repo });
}

export async function repoSourceDelete(repo: ThirdPartyRepo): Promise<Result<void>> {
  return tauriInvoke<void>("repo_source_delete", { repo });
}

export async function repoSourceListSkills(repo: ThirdPartyRepo): Promise<Result<RemoteSkill[]>> {
  return tauriInvoke<RemoteSkill[]>("repo_source_list_skills", { repo });
}