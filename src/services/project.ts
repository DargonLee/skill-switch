import { tauriInvoke, type Result } from "./tauri";
import type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
} from "../types";

/**
 * List all projects
 * Maps to backend: project_list -> Vec<LegacyProjectDto>
 */
export async function projectList(): Promise<Result<Project[]>> {
  return tauriInvoke<Project[]>("project_list");
}

/**
 * Create a new project
 * Maps to backend: project_create(CreateProjectInput) -> LegacyProjectDto
 */
export async function projectCreate(input: CreateProjectInput): Promise<Result<Project>> {
  return tauriInvoke<Project>("project_create", { input });
}

/**
 * Update an existing project
 * Maps to backend: project_update(UpdateProjectInput) -> LegacyProjectDto
 */
export async function projectUpdate(input: UpdateProjectInput): Promise<Result<Project>> {
  return tauriInvoke<Project>("project_update", { input });
}

/**
 * Delete a project by ID
 * Maps to backend: project_delete(id) -> ()
 */
export async function projectDelete(id: string): Promise<Result<void>> {
  return tauriInvoke<void>("project_delete", { id });
}