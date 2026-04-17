use std::path::Path;

use tauri::Manager;

use crate::domain::{
    CreateProjectInput, CreateSkillInput, ImportMarketSkillInput, InstallRecordIdInput,
    InstallSkillGlobalInput, InstallSkillToProjectInput, MarketplaceFeedInput, ProjectPathInput,
    ProjectPreviewInput, RemoveProjectCliInput, RepoConnectInput, RepoPreflightInput,
    RepoPreflightResult, ResourceIdInput, ResourceListFilter, SkillDirectoryInput, SkillFileInput,
    ThirdPartyRepo, UpdateProjectInput, UpdateSkillInput,
};
use crate::{git, store};

async fn run_blocking_command<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn repo_preflight(
    app: tauri::AppHandle,
    input: RepoPreflightInput,
) -> Result<RepoPreflightResult, String> {
    let path = input
        .local_path
        .clone()
        .or(input.path.clone())
        .ok_or_else(|| "repo path is required".to_string())?;
    let normalized = store::normalize_user_path(&path)?;
    let path_exists = normalized.exists();
    let path_is_directory = path_exists && normalized.is_dir();
    let manifest_exists = path_is_directory && store::repo_manifest_path(&normalized).exists();
    let legacy_store_exists = store::legacy_store_path(&app)?.exists();
    let codex_home = app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".codex")
        .to_string_lossy()
        .into_owned();

    Ok(RepoPreflightResult {
        normalized_path: normalized.to_string_lossy().into_owned(),
        path_exists,
        path_is_directory,
        git_available: git::git_available(),
        is_git_repo: path_is_directory && git::is_git_repo(&normalized),
        manifest_exists,
        legacy_store_exists,
        codex_home: Some(codex_home),
    })
}

#[tauri::command]
pub fn repo_connect(
    app: tauri::AppHandle,
    input: RepoConnectInput,
) -> Result<crate::domain::RepoStatus, String> {
    let path = input
        .local_path
        .clone()
        .or(input.path.clone())
        .ok_or_else(|| "repo path is required".to_string())?;
    let initialize_if_missing = input
        .initialize_if_missing
        .unwrap_or_else(|| input.mode.as_deref() == Some("clone"));

    store::ensure_repo_connection(
        &app,
        &path,
        input.remote_url.as_deref(),
        input.branch.as_deref(),
        initialize_if_missing,
    )
}

#[tauri::command]
pub fn repo_status(app: tauri::AppHandle) -> Result<crate::domain::RepoStatus, String> {
    store::build_repo_status(&app)
}

#[tauri::command]
pub fn repo_pull(app: tauri::AppHandle) -> Result<crate::domain::RepoStatus, String> {
    store::repo_pull(&app)
}

#[tauri::command]
pub fn repo_push(app: tauri::AppHandle) -> Result<crate::domain::RepoStatus, String> {
    store::repo_push(&app)
}

#[tauri::command]
pub fn repo_sync(app: tauri::AppHandle) -> Result<crate::domain::RepoStatus, String> {
    store::repo_sync(&app)
}

#[tauri::command]
pub fn backup_source_status(
    app: tauri::AppHandle,
) -> Result<crate::domain::BackupSourceStatus, String> {
    store::backup_source_status(&app)
}

#[tauri::command]
pub fn backup_source_connect(
    app: tauri::AppHandle,
) -> Result<crate::domain::BackupSourceStatus, String> {
    store::backup_source_connect(&app)
}

#[tauri::command]
pub fn backup_source_pull(
    app: tauri::AppHandle,
) -> Result<crate::domain::BackupSourceStatus, String> {
    store::backup_source_pull(&app)
}

#[tauri::command]
pub fn backup_source_push(
    app: tauri::AppHandle,
) -> Result<crate::domain::BackupSourceStatus, String> {
    store::backup_source_push(&app)
}

#[tauri::command]
pub fn resource_list(
    app: tauri::AppHandle,
    filter: Option<ResourceListFilter>,
) -> Result<Vec<crate::domain::Resource>, String> {
    store::list_resources(&app, filter)
}

#[tauri::command]
pub fn project_profile_list(
    app: tauri::AppHandle,
) -> Result<Vec<crate::domain::ProjectProfile>, String> {
    store::list_project_profiles(&app)
}

#[tauri::command]
pub fn project_binding_list(
    app: tauri::AppHandle,
) -> Result<Vec<crate::domain::LocalProjectBinding>, String> {
    store::list_project_bindings(&app)
}

#[tauri::command]
pub fn scan_project_state(
    app: tauri::AppHandle,
    input: ProjectPathInput,
) -> Result<crate::domain::ProjectScanResult, String> {
    store::scan_project_state(&app, &input.path)
}

#[tauri::command]
pub fn preview_project_apply(
    app: tauri::AppHandle,
    input: ProjectPreviewInput,
) -> Result<crate::domain::PreviewPlan, String> {
    store::preview_project_apply(&app, &input)
}

#[tauri::command]
pub fn apply_project_profile(
    app: tauri::AppHandle,
    input: ProjectPreviewInput,
) -> Result<(), String> {
    store::apply_project_profile(&app, &input)
}

#[tauri::command]
pub fn preview_capture_project_changes(
    app: tauri::AppHandle,
    input: ProjectPreviewInput,
) -> Result<crate::domain::PreviewPlan, String> {
    if !Path::new(&input.path).exists() {
        return Err(format!("project path does not exist: {}", input.path));
    }

    store::preview_capture_project_changes(&app, &input)
}

#[tauri::command]
pub fn capture_project_changes(
    app: tauri::AppHandle,
    input: ProjectPreviewInput,
) -> Result<(), String> {
    store::capture_project_changes(&app, &input)
}

#[tauri::command]
pub fn apply_install_refresh(
    app: tauri::AppHandle,
    input: InstallRecordIdInput,
) -> Result<(), String> {
    store::apply_install_refresh(&app, &input.record_id)
}

#[tauri::command]
pub fn scan_global_environment(
    app: tauri::AppHandle,
) -> Result<crate::domain::RecoveryScanResult, String> {
    store::scan_global_environment(&app)
}

#[tauri::command]
pub fn preview_environment_restore(
    app: tauri::AppHandle,
) -> Result<crate::domain::PreviewPlan, String> {
    store::preview_environment_restore(&app)
}

#[tauri::command]
pub fn apply_environment_restore(app: tauri::AppHandle) -> Result<(), String> {
    store::apply_environment_restore(&app)
}

#[tauri::command]
pub fn check_source_updates(
    app: tauri::AppHandle,
) -> Result<Vec<crate::domain::UpdateItem>, String> {
    store::check_source_updates(&app)
}

#[tauri::command]
pub fn check_install_updates(
    app: tauri::AppHandle,
) -> Result<Vec<crate::domain::UpdateItem>, String> {
    store::check_install_updates(&app)
}

#[tauri::command]
pub fn preview_source_update(
    app: tauri::AppHandle,
    input: ResourceIdInput,
) -> Result<crate::domain::PreviewPlan, String> {
    store::preview_source_update(&app, &input.resource_id)
}

#[tauri::command]
pub fn apply_source_update(
    app: tauri::AppHandle,
    input: ResourceIdInput,
) -> Result<crate::domain::UpdateItem, String> {
    store::apply_source_update(&app, &input.resource_id)
}

#[tauri::command]
pub fn skill_list(app: tauri::AppHandle) -> Result<Vec<crate::domain::LegacySkillDto>, String> {
    store::list_legacy_skills(&app)
}

#[tauri::command]
pub fn skill_get(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<crate::domain::LegacySkillDto>, String> {
    store::get_legacy_skill(&app, &id)
}

#[tauri::command]
pub fn skill_create(
    app: tauri::AppHandle,
    input: CreateSkillInput,
) -> Result<crate::domain::CreateLegacySkillResult, String> {
    store::create_legacy_skill(&app, &input)
}

#[tauri::command]
pub fn skill_update(
    app: tauri::AppHandle,
    input: UpdateSkillInput,
) -> Result<crate::domain::LegacySkillDto, String> {
    store::update_legacy_skill(&app, &input)
}

#[tauri::command]
pub fn skill_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    store::delete_legacy_skill(&app, &id)
}

#[tauri::command]
pub fn skill_search(
    app: tauri::AppHandle,
    query: String,
) -> Result<Vec<crate::domain::LegacySkillDto>, String> {
    store::search_legacy_skills(&app, &query)
}

#[tauri::command]
pub fn project_list(app: tauri::AppHandle) -> Result<Vec<crate::domain::LegacyProjectDto>, String> {
    store::list_legacy_projects(&app)
}

#[tauri::command]
pub fn project_create(
    app: tauri::AppHandle,
    input: CreateProjectInput,
) -> Result<crate::domain::LegacyProjectDto, String> {
    store::create_legacy_project(&app, &input)
}

#[tauri::command]
pub fn project_update(
    app: tauri::AppHandle,
    input: UpdateProjectInput,
) -> Result<crate::domain::LegacyProjectDto, String> {
    store::update_legacy_project(&app, &input)
}

#[tauri::command]
pub fn project_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    store::delete_legacy_project(&app, &id)
}

#[tauri::command]
pub fn show_in_finder(path: String) -> Result<(), String> {
    let target_path = Path::new(&path);
    if !target_path.exists() {
        return Err(format!("path does not exist: {}", path));
    }

    // Use system `open -R` command which is more stable than showfile crate
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(target_path)
            .spawn()
            .map_err(|e| format!("failed to open finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(target_path)
            .spawn()
            .map_err(|e| format!("failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = target_path.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("failed to open file manager: {}", e))?;
        }
    }

    Ok(())
}

// ─── Settings commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn settings_get(app: tauri::AppHandle) -> Result<crate::domain::AppSettings, String> {
    store::get_settings(&app)
}

#[tauri::command]
pub fn settings_set(
    app: tauri::AppHandle,
    settings: crate::domain::AppSettings,
) -> Result<(), String> {
    store::set_settings(&app, &settings)?;
    store::apply_theme_preference(&app, settings.theme.as_str());
    Ok(())
}

#[tauri::command]
pub async fn repo_source_sync(
    app: tauri::AppHandle,
    repo: ThirdPartyRepo,
) -> Result<crate::domain::ThirdPartyRepo, String> {
    run_blocking_command(move || crate::repo_sources::sync_repo_source(&app, &repo)).await
}

#[tauri::command]
pub async fn repo_source_delete(app: tauri::AppHandle, repo: ThirdPartyRepo) -> Result<(), String> {
    run_blocking_command(move || crate::repo_sources::delete_repo_source(&app, &repo)).await
}

#[tauri::command]
pub async fn repo_source_list_skills(
    app: tauri::AppHandle,
    repo: ThirdPartyRepo,
) -> Result<Vec<crate::domain::RemoteSkill>, String> {
    run_blocking_command(move || crate::repo_sources::list_repo_source_skills(&app, &repo)).await
}

// ─── Project skill install commands ─────────────────────────────────────────────

#[tauri::command]
pub fn skill_install_to_project(
    app: tauri::AppHandle,
    input: InstallSkillToProjectInput,
) -> Result<crate::domain::InstallSkillToProjectResult, String> {
    store::install_skill_to_project(&app, &input)
}

#[tauri::command]
pub fn skill_uninstall_from_project(
    app: tauri::AppHandle,
    input: InstallSkillToProjectInput,
) -> Result<crate::domain::InstallSkillToProjectResult, String> {
    store::uninstall_skill_from_project(&app, &input)
}

#[tauri::command]
pub fn project_remove_cli_folders(
    input: RemoveProjectCliInput,
) -> Result<crate::domain::RemoveProjectCliResult, String> {
    store::remove_project_cli_folders(&input)
}

// ─── Global skill install commands ─────────────────────────────────────────────

#[tauri::command]
pub fn skill_install_global(
    app: tauri::AppHandle,
    input: InstallSkillGlobalInput,
) -> Result<crate::domain::InstallSkillGlobalResult, String> {
    store::install_skill_global(&app, &input)
}

#[tauri::command]
pub fn skill_uninstall_global(
    app: tauri::AppHandle,
    input: InstallSkillGlobalInput,
) -> Result<crate::domain::InstallSkillGlobalResult, String> {
    store::uninstall_skill_global(&app, &input)
}

// ─── Symlink status commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn skill_check_symlink_status(
    app: tauri::AppHandle,
    input: crate::domain::CheckSymlinkStatusInput,
) -> Result<crate::domain::CheckSymlinkStatusResult, String> {
    store::check_symlink_status(&app, &input)
}

#[tauri::command]
pub fn skill_repair_broken_symlinks(
    app: tauri::AppHandle,
    input: crate::domain::CheckSymlinkStatusInput,
) -> Result<crate::domain::RepairBrokenSymlinksResult, String> {
    store::repair_broken_symlinks(&app, &input)
}

#[tauri::command]
pub fn skill_migrate_to_symlinks(app: tauri::AppHandle) -> Result<store::MigrationResult, String> {
    store::migrate_copied_skills_to_symlinks(&app)
}

// ─── Import skill commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn skill_import_from_folder(
    app: tauri::AppHandle,
    folder_path: String,
) -> Result<crate::domain::LegacySkillDto, String> {
    let path = Path::new(&folder_path);
    store::import_skill_from_folder(&app, path)
}

#[tauri::command]
pub fn skill_import_from_zip(
    app: tauri::AppHandle,
    zip_path: String,
) -> Result<crate::domain::LegacySkillDto, String> {
    let path = Path::new(&zip_path);
    store::import_skill_from_zip(&app, path)
}

#[tauri::command]
pub fn skill_export_to_zip(
    app: tauri::AppHandle,
    skill_id: String,
    output_path: String,
) -> Result<String, String> {
    let path = Path::new(&output_path);
    store::export_skill_to_zip(&app, &skill_id, path)
}

// ─── Skill directory browsing commands ─────────────────────────────────────────

#[tauri::command]
pub fn skill_list_directory(
    app: tauri::AppHandle,
    input: SkillDirectoryInput,
) -> Result<crate::domain::SkillDirectoryListing, String> {
    store::list_skill_directory(&app, &input)
}

#[tauri::command]
pub fn skill_read_file(
    app: tauri::AppHandle,
    input: SkillFileInput,
) -> Result<crate::domain::SkillFileContent, String> {
    store::read_skill_file(&app, &input)
}

// ─── External app skills scanning commands ─────────────────────────────────────

#[tauri::command]
pub fn scan_external_skills(
    app: tauri::AppHandle,
    app_id: String,
) -> Result<Vec<crate::domain::ExternalSkillDto>, String> {
    store::scan_external_app_skills(&app, &app_id)
}

// ─── Marketplace commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn marketplace_load_feed(
    app: tauri::AppHandle,
    input: MarketplaceFeedInput,
) -> Result<crate::domain::MarketplaceFeedPage, String> {
    crate::marketplace::load_marketplace_feed(&app, input)
}

#[tauri::command]
pub fn skill_import_from_market(
    app: tauri::AppHandle,
    input: ImportMarketSkillInput,
) -> Result<crate::domain::LegacySkillDto, String> {
    crate::marketplace::import_skill_from_market(&app, &input)
}

// ─── Registry commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn registry_search(
    query: String,
    limit: Option<u32>,
) -> Result<crate::domain::RegistrySearchResult, String> {
    let limit = limit.unwrap_or(30);
    crate::registry::search_registry(&query, limit)
}

#[tauri::command]
pub fn registry_fetch_content(
    source: String,
    skill_id: String,
) -> Result<crate::domain::RegistrySkillContent, String> {
    crate::registry::fetch_registry_content(&source, &skill_id)
}

#[tauri::command]
pub fn registry_install(
    input: crate::domain::RegistryInstallInput,
) -> Result<crate::domain::RegistryInstallResult, String> {
    crate::registry::install_registry_skill(&input)
}
