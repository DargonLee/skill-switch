import { tauriInvoke, type Result } from "./tauri";
import type {
  Skill,
  CreateSkillResult,
  CreateSkillInput,
  UpdateSkillInput,
} from "../types";

export function formatSkillOperationError(error: string, action: "安装" | "保存" = "安装"): string {
  if (error.includes("library repo is not connected")) {
    return `${action}失败：我的库仓库尚未连接`;
  }

  return `${action}失败：${error}`;
}

/**
 * List all skills
 * Maps to backend: skill_list -> Vec<LegacySkillDto>
 */
export async function skillList(): Promise<Result<Skill[]>> {
  return tauriInvoke<Skill[]>("skill_list");
}

/**
 * Get a specific skill by ID
 * Maps to backend: skill_get(id) -> Option<LegacySkillDto>
 */
export async function skillGet(id: string): Promise<Result<Skill | null>> {
  return tauriInvoke<Skill | null>("skill_get", { id });
}

/**
 * Create a new skill
 * Maps to backend: skill_create(CreateSkillInput) -> CreateSkillResult
 */
export async function skillCreate(input: CreateSkillInput): Promise<Result<CreateSkillResult>> {
  return tauriInvoke<CreateSkillResult>("skill_create", { input });
}

/**
 * Update an existing skill
 * Maps to backend: skill_update(UpdateSkillInput) -> LegacySkillDto
 */
export async function skillUpdate(input: UpdateSkillInput): Promise<Result<Skill>> {
  return tauriInvoke<Skill>("skill_update", { input });
}

/**
 * Delete a skill by ID
 * Maps to backend: skill_delete(id) -> ()
 */
export async function skillDelete(id: string): Promise<Result<void>> {
  return tauriInvoke<void>("skill_delete", { id });
}

/**
 * Search skills by query string
 * Maps to backend: skill_search(query) -> Vec<LegacySkillDto>
 */
export async function skillSearch(query: string): Promise<Result<Skill[]>> {
  return tauriInvoke<Skill[]>("skill_search", { query });
}

/**
 * Install a skill to a project for specified CLI apps
 * Maps to backend: skill_install_to_project(InstallSkillToProjectInput) -> InstallSkillToProjectResult
 */
export interface InstallSkillToProjectInput {
  skillId: string;
  projectPath: string;
  apps: string[];
}

export interface InstallSkillToProjectResult {
  installedApps: string[];
  failedApps: string[];
}

export async function skillInstallToProject(
  input: InstallSkillToProjectInput
): Promise<Result<InstallSkillToProjectResult>> {
  return tauriInvoke<InstallSkillToProjectResult>("skill_install_to_project", { input });
}

/**
 * Uninstall a skill from a project for specified CLI apps
 * Maps to backend: skill_uninstall_from_project(InstallSkillToProjectInput) -> InstallSkillToProjectResult
 */
export async function skillUninstallFromProject(
  input: InstallSkillToProjectInput
): Promise<Result<InstallSkillToProjectResult>> {
  return tauriInvoke<InstallSkillToProjectResult>("skill_uninstall_from_project", { input });
}

/**
 * Remove CLI folders from a project directory
 * Maps to backend: project_remove_cli_folders(RemoveProjectCliInput) -> RemoveProjectCliResult
 */
export interface RemoveProjectCliInput {
  projectPath: string;
  apps: string[];
}

export interface RemoveProjectCliResult {
  removedApps: string[];
  failedApps: string[];
}

export async function projectRemoveCliFolders(
  input: RemoveProjectCliInput
): Promise<Result<RemoveProjectCliResult>> {
  return tauriInvoke<RemoveProjectCliResult>("project_remove_cli_folders", { input });
}

/**
 * Install a skill globally for specified CLI apps
 * Maps to backend: skill_install_global(InstallSkillGlobalInput) -> InstallSkillGlobalResult
 */
export interface InstallSkillGlobalInput {
  skillId: string;
  apps: string[];
}

export interface InstallSkillGlobalResult {
  installedApps: string[];
  failedApps: string[];
}

export async function skillInstallGlobal(
  input: InstallSkillGlobalInput
): Promise<Result<InstallSkillGlobalResult>> {
  return tauriInvoke<InstallSkillGlobalResult>("skill_install_global", { input });
}

/**
 * Uninstall a skill globally for specified CLI apps
 * Maps to backend: skill_uninstall_global(InstallSkillGlobalInput) -> InstallSkillGlobalResult
 */
export async function skillUninstallGlobal(
  input: InstallSkillGlobalInput
): Promise<Result<InstallSkillGlobalResult>> {
  return tauriInvoke<InstallSkillGlobalResult>("skill_uninstall_global", { input });
}

/**
 * Check symlink status of a skill installation
 * Maps to backend: skill_check_symlink_status(CheckSymlinkStatusInput) -> CheckSymlinkStatusResult
 */
export interface CheckSymlinkStatusInput {
  skillId: string;
  scope: "global" | "project";
  projectPath?: string | null;
}

export interface SkillSymlinkStatus {
  appId: string;
  isSymlink: boolean;
  isBroken: boolean;
  targetPath: string | null;
  exists: boolean;
}

export interface CheckSymlinkStatusResult {
  skillId: string;
  statuses: SkillSymlinkStatus[];
}

export async function skillCheckSymlinkStatus(
  input: CheckSymlinkStatusInput
): Promise<Result<CheckSymlinkStatusResult>> {
  return tauriInvoke<CheckSymlinkStatusResult>("skill_check_symlink_status", { input });
}

/**
 * Repair broken symlinks for a skill
 * Maps to backend: skill_repair_broken_symlinks(CheckSymlinkStatusInput) -> RepairBrokenSymlinksResult
 */
export interface RepairBrokenSymlinksResult {
  removedSymlinks: string[];
  errors: string[];
}

export async function skillRepairBrokenSymlinks(
  input: CheckSymlinkStatusInput
): Promise<Result<RepairBrokenSymlinksResult>> {
  return tauriInvoke<RepairBrokenSymlinksResult>("skill_repair_broken_symlinks", { input });
}

/**
 * Import a skill from a folder containing SKILL.md
 * Maps to backend: skill_import_from_folder(folder_path) -> LegacySkillDto
 */
export async function skillImportFromFolder(
  folderPath: string
): Promise<Result<Skill>> {
  return tauriInvoke<Skill>("skill_import_from_folder", { folderPath });
}

/**
 * Import a skill from a zip file
 * Maps to backend: skill_import_from_zip(zip_path) -> LegacySkillDto
 */
export async function skillImportFromZip(
  zipPath: string
): Promise<Result<Skill>> {
  return tauriInvoke<Skill>("skill_import_from_zip", { zipPath });
}

/**
 * Export a skill to a ZIP file
 * Maps to backend: skill_export_to_zip(skill_id, output_path) -> String
 */
export async function skillExportToZip(
  skillId: string,
  outputPath: string
): Promise<Result<string>> {
  return tauriInvoke<string>("skill_export_to_zip", { skillId, outputPath });
}

/**
 * List the contents of a skill directory
 * Maps to backend: skill_list_directory(SkillDirectoryInput) -> SkillDirectoryListing
 */
export async function skillListDirectory(
  input: import("../types").SkillDirectoryInput
): Promise<Result<import("../types").SkillDirectoryListing>> {
  return tauriInvoke<import("../types").SkillDirectoryListing>("skill_list_directory", { input });
}

/**
 * Read the content of a file in a skill directory
 * Maps to backend: skill_read_file(SkillFileInput) -> SkillFileContent
 */
export async function skillReadFile(
  input: import("../types").SkillFileInput
): Promise<Result<import("../types").SkillFileContent>> {
  return tauriInvoke<import("../types").SkillFileContent>("skill_read_file", { input });
}

/**
 * Show a path in the system file manager (Finder on macOS)
 * Maps to backend: show_in_finder(path) -> ()
 */
export async function showInFinder(path: string): Promise<Result<void>> {
  return tauriInvoke<void>("show_in_finder", { path });
}

/**
 * Scan skills from an external app directory (e.g., ~/.claude/skills/)
 * Maps to backend: scan_external_skills(app_id) -> Vec<ExternalSkillDto>
 */
export async function scanExternalSkills(
  appId: string
): Promise<Result<import("../types").ExternalSkill[]>> {
  return tauriInvoke<import("../types").ExternalSkill[]>("scan_external_skills", { appId });
}
