import { tauriInvoke, type Result } from "./tauri";
import type {
  RegistrySkill,
  RegistrySearchResult,
  RegistrySkillContent,
  RegistryInstallInput,
  RegistryInstallResult,
} from "../types";

export const REGISTRY_SOURCE_ID = "skills-sh-registry";

/**
 * Search skills from skills.sh registry
 */
export async function registrySearch(
  query: string,
  limit: number = 30
): Promise<Result<RegistrySearchResult>> {
  return tauriInvoke<RegistrySearchResult>("registry_search", {
    query,
    limit,
  });
}

/**
 * Fetch SKILL.md content for a registry skill
 */
export async function registryFetchContent(
  source: string,
  skillId: string
): Promise<Result<RegistrySkillContent>> {
  return tauriInvoke<RegistrySkillContent>("registry_fetch_content", {
    source,
    skillId,
  });
}

/**
 * Install a registry skill to specified apps
 */
export async function registryInstall(
  input: RegistryInstallInput
): Promise<Result<RegistryInstallResult>> {
  return tauriInvoke<RegistryInstallResult>("registry_install", { input });
}

/**
 * Transform RegistrySkill to display format
 */
export interface RegistrySkillDisplay {
  id: string;
  registryId: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
  formattedInstalls: string;
}

export function transformRegistrySkillToDisplay(
  skill: RegistrySkill
): RegistrySkillDisplay {
  return {
    id: `${REGISTRY_SOURCE_ID}::${skill.id}`,
    registryId: skill.id,
    skillId: skill.skillId,
    name: skill.name,
    installs: skill.installs,
    source: skill.source,
    formattedInstalls: formatInstallCount(skill.installs),
  };
}

function formatInstallCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(".0", "")}M`;
  } else if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(".0", "")}K`;
  }
  return `${count}`;
}