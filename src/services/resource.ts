import { tauriInvoke, type Result } from "./tauri";
import type { Resource, ResourceKind, ResourceScope } from "../types";

interface ResourceListFilter {
  kind?: ResourceKind;
  scope?: ResourceScope;
  projectId?: string;
}

/**
 * List resources with optional filtering
 * Maps to backend: resource_list(Option<ResourceListFilter>) -> Vec<Resource>
 */
export async function resourceList(filter?: ResourceListFilter): Promise<Result<Resource[]>> {
  return tauriInvoke<Resource[]>("resource_list", { filter });
}

/**
 * Check for source updates
 * Maps to backend: check_source_updates() -> Vec<UpdateItem>
 */
export async function checkSourceUpdates(): Promise<Result<unknown[]>> {
  return tauriInvoke<unknown[]>("check_source_updates");
}

/**
 * Check for install updates
 * Maps to backend: check_install_updates() -> Vec<UpdateItem>
 */
export async function checkInstallUpdates(): Promise<Result<unknown[]>> {
  return tauriInvoke<unknown[]>("check_install_updates");
}

/**
 * Apply source update from upstream
 * Maps to backend: apply_source_update(ResourceIdInput) -> UpdateItem
 */
export async function applySourceUpdate(resourceId: string): Promise<Result<unknown>> {
  return tauriInvoke<unknown>("apply_source_update", { input: { resourceId } });
}

/**
 * Refresh an installed resource
 * Maps to backend: apply_install_refresh(InstallRecordIdInput) -> ()
 */
export async function applyInstallRefresh(recordId: string): Promise<Result<void>> {
  return tauriInvoke<void>("apply_install_refresh", { input: { recordId } });
}