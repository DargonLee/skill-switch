use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use uuid::Uuid;

use crate::domain::{
    AppSettings, BackupSourceConfig, BackupSourceStatus, CheckSymlinkStatusInput,
    CheckSymlinkStatusResult, CreateProjectInput, CreateSkillInput, InstallRecord,
    InstallSkillGlobalInput, InstallSkillGlobalResult, InstallSkillToProjectInput,
    InstallSkillToProjectResult, InstallStatus, InstallTarget, InstallTargetKind, LegacyProjectDto,
    LegacySkillDto, LocalProjectBinding, LocalState, PreviewDecisionAction, PreviewPlan,
    PreviewPlanKind, ProjectFileEntry, ProjectFileStatus, ProjectPreviewInput, ProjectProfile,
    ProjectScanResult, ProjectScanSummary, RecoveryEntry, RecoveryScanResult,
    RemoveProjectCliInput, RemoveProjectCliResult, RepairBrokenSymlinksResult, RepoConfig,
    RepoLibrary, RepoStatus, Resource, ResourceKind, ResourceListFilter, ResourceOrigin,
    ResourceScope, SkillSymlinkStatus, SourceStatus, UpdateItem, UpdateProjectInput,
    UpdateSkillInput,
};
use crate::git;
use crate::legacy;

const LOCAL_STATE_FILE: &str = "local-state.json";
const LEGACY_STORE_FILE: &str = "skills.json";
const LIBRARY_DIR: &str = ".skill-switch";
const LIBRARY_FILE: &str = "library.json";
const BACKUP_SOURCE_DIR: &str = "backup-source";
const SKILL_SOURCES_DIR: &str = "skill-sources";
const DEFAULT_LIBRARY_REPO_DIR: &str = "library-repo";
const SOURCE_ARCHIVES_DIR: &str = "source-archives";
const STANDARD_SKILL_DIRECTORIES: &[&str] = &["scripts", "references", "assets"];

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;

    for ch in value.chars() {
        let mapped = match ch {
            'a'..='z' | '0'..='9' => Some(ch),
            'A'..='Z' => Some(ch.to_ascii_lowercase()),
            _ => Some('-'),
        };

        if let Some(mapped) = mapped {
            if mapped == '-' {
                if !slug.is_empty() && !prev_dash {
                    slug.push(mapped);
                    prev_dash = true;
                }
            } else {
                slug.push(mapped);
                prev_dash = false;
            }
        }
    }

    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("resource-{}", now_ms())
    } else {
        trimmed
    }
}

pub fn compute_revision(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{:02x}", byte)).collect()
}

pub fn normalize_user_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if candidate.exists() {
        return candidate.canonicalize().map_err(|error| error.to_string());
    }

    if candidate.is_absolute() {
        Ok(candidate)
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())
            .map(|cwd| cwd.join(candidate))
    }
}

fn app_cli_dir_aliases(app_id: &str) -> Option<&'static [&'static str]> {
    match app_id {
        "claude" => Some(&[".claude"]),
        "codex" => Some(&[".codex"]),
        "cursor" => Some(&[".cursor"]),
        _ => None,
    }
}

fn app_cli_dirs(base_path: &Path, app_id: &str) -> Result<Vec<PathBuf>, String> {
    let aliases =
        app_cli_dir_aliases(app_id).ok_or_else(|| format!("未知的应用: {}", app_id))?;
    Ok(aliases.iter().map(|alias| base_path.join(alias)).collect())
}

fn preferred_app_cli_dir(base_path: &Path, app_id: &str) -> Result<PathBuf, String> {
    let dirs = app_cli_dirs(base_path, app_id)?;
    dirs.into_iter()
        .next()
        .ok_or_else(|| format!("未知的应用: {}", app_id))
}

fn app_skill_dirs(base_path: &Path, app_id: &str) -> Result<Vec<PathBuf>, String> {
    Ok(app_cli_dirs(base_path, app_id)?
        .into_iter()
        .map(|dir| dir.join("skills"))
        .collect())
}

fn preferred_app_skill_path(base_path: &Path, app_id: &str, slug: &str) -> Result<PathBuf, String> {
    Ok(preferred_app_cli_dir(base_path, app_id)?
        .join("skills")
        .join(slug))
}

fn app_skill_paths(base_path: &Path, app_id: &str, slug: &str) -> Result<Vec<PathBuf>, String> {
    Ok(app_skill_dirs(base_path, app_id)?
        .into_iter()
        .map(|dir| dir.join(slug))
        .collect())
}

fn local_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(LOCAL_STATE_FILE))
}

pub fn legacy_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(LEGACY_STORE_FILE))
}

pub fn repo_manifest_path(repo_root: &Path) -> PathBuf {
    repo_root.join(LIBRARY_DIR).join(LIBRARY_FILE)
}

pub fn load_local_state(app: &tauri::AppHandle) -> Result<LocalState, String> {
    let path = local_state_path(app)?;
    if !path.exists() {
        return Ok(LocalState {
            version: "2".into(),
            ..Default::default()
        });
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

pub fn save_local_state(app: &tauri::AppHandle, state: &LocalState) -> Result<(), String> {
    let path = local_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let raw = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

pub fn load_repo_library(repo_root: &Path) -> Result<RepoLibrary, String> {
    let path = repo_manifest_path(repo_root);
    if !path.exists() {
        return Ok(RepoLibrary {
            version: "2".into(),
            ..Default::default()
        });
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

pub fn save_repo_library(repo_root: &Path, library: &RepoLibrary) -> Result<(), String> {
    let path = repo_manifest_path(repo_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let raw = serde_json::to_string_pretty(library).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

pub fn connected_repo_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut state = load_local_state(app)?;
    ensure_local_library_repo_root(app, &mut state)
}

pub fn ensure_repo_connection(
    app: &tauri::AppHandle,
    path: &str,
    remote_url: Option<&str>,
    branch: Option<&str>,
    initialize_if_missing: bool,
) -> Result<RepoStatus, String> {
    let normalized = normalize_user_path(path)?;

    if !normalized.exists() {
        if let Some(remote_url) = remote_url {
            if !git::git_available() {
                return Err("git is not available on this machine".into());
            }
            if let Some(parent) = normalized.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            git::clone_repository(remote_url, &normalized, branch)?;
        } else if !initialize_if_missing {
            return Err(format!(
                "repo path does not exist: {}",
                normalized.display()
            ));
        } else {
            fs::create_dir_all(&normalized).map_err(|error| error.to_string())?;
        }
    }

    if !normalized.is_dir() {
        return Err(format!(
            "repo path is not a directory: {}",
            normalized.display()
        ));
    }

    let mut local_state = load_local_state(app)?;
    local_state.repo = Some(RepoConfig {
        path: normalized.to_string_lossy().into_owned(),
        connected_at: now_ms(),
    });

    let mut library = load_repo_library(&normalized)?;
    let mut migration = None;

    if !local_state.migrated_legacy_store {
        if let Some(legacy_store) = legacy::read_legacy_store(&legacy_store_path(app)?)? {
            let report = legacy::migrate_legacy_store(
                legacy_store,
                &mut library,
                &mut local_state.project_bindings,
            );
            if report.migrated {
                local_state.migrated_legacy_store = true;
                migration = Some(report);
            }
        }
    }

    save_repo_library(&normalized, &library)?;
    save_local_state(app, &local_state)?;

    build_repo_status_from_state(&normalized, &library, migration)
}

pub fn build_repo_status(app: &tauri::AppHandle) -> Result<RepoStatus, String> {
    let mut local_state = load_local_state(app)?;
    let repo_root = ensure_local_library_repo_root(app, &mut local_state)?;
    let library = load_repo_library(&repo_root)?;
    build_repo_status_from_state(&repo_root, &library, None)
}

fn build_repo_status_from_state(
    repo_root: &Path,
    library: &RepoLibrary,
    migration: Option<crate::domain::MigrationReport>,
) -> Result<RepoStatus, String> {
    let (ahead, behind) = git::ahead_behind(repo_root);
    Ok(RepoStatus {
        connected: true,
        path: Some(repo_root.to_string_lossy().into_owned()),
        manifest_exists: repo_manifest_path(repo_root).exists(),
        git_available: git::git_available(),
        is_git_repo: git::is_git_repo(repo_root),
        branch: git::branch(repo_root),
        head: git::head(repo_root),
        ahead,
        behind,
        dirty: git::dirty(repo_root),
        resources_count: library.resources.len(),
        project_profiles_count: library.project_profiles.len(),
        migration,
    })
}

pub fn list_resources(
    app: &tauri::AppHandle,
    filter: Option<ResourceListFilter>,
) -> Result<Vec<Resource>, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let filtered = library
        .resources
        .into_iter()
        .filter(|resource| {
            filter
                .as_ref()
                .and_then(|filter| filter.kind)
                .map(|kind| resource.kind == kind)
                .unwrap_or(true)
                && filter
                    .as_ref()
                    .and_then(|filter| filter.scope)
                    .map(|scope| resource.scope == scope)
                    .unwrap_or(true)
                && filter
                    .as_ref()
                    .and_then(|filter| filter.project_id.as_ref())
                    .map(|project_id| resource.project_id.as_deref() == Some(project_id.as_str()))
                    .unwrap_or(true)
        })
        .collect();

    Ok(filtered)
}

pub fn list_project_profiles(app: &tauri::AppHandle) -> Result<Vec<ProjectProfile>, String> {
    let repo_root = connected_repo_root(app)?;
    Ok(load_repo_library(&repo_root)?.project_profiles)
}

pub fn list_project_bindings(app: &tauri::AppHandle) -> Result<Vec<LocalProjectBinding>, String> {
    Ok(load_local_state(app)?.project_bindings)
}

pub fn scan_project_state(
    app: &tauri::AppHandle,
    project_path: &str,
) -> Result<ProjectScanResult, String> {
    let normalized = normalize_user_path(project_path)?;
    if !normalized.exists() || !normalized.is_dir() {
        return Err(format!("project path is invalid: {}", normalized.display()));
    }

    let local_state = load_local_state(app)?;
    let library = match connected_repo_root(app) {
        Ok(repo_root) => load_repo_library(&repo_root)?,
        Err(_) => RepoLibrary {
            version: "2".into(),
            ..Default::default()
        },
    };

    let binding = local_state
        .project_bindings
        .iter()
        .find(|binding| normalize_user_path(&binding.path).ok().as_ref() == Some(&normalized))
        .cloned();

    let profile = binding
        .as_ref()
        .and_then(|binding| {
            library
                .project_profiles
                .iter()
                .find(|profile| profile.id == binding.project_id)
        })
        .cloned();

    let items = scan_files(&normalized, &local_state.install_records)?;
    Ok(ProjectScanResult {
        project_path: normalized.to_string_lossy().into_owned(),
        repo_root: git::git_root(&normalized).map(|path| path.to_string_lossy().into_owned()),
        is_git_repo: git::is_git_repo(&normalized),
        profile,
        binding,
        summary: summarize_items(&items),
        items,
    })
}

pub fn preview_project_apply(
    app: &tauri::AppHandle,
    input: &ProjectPreviewInput,
) -> Result<crate::domain::PreviewPlan, String> {
    let normalized = normalize_user_path(&input.path)?;
    let local_state = load_local_state(app)?;
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;

    let profile = library
        .project_profiles
        .iter()
        .find(|profile| profile.id == input.project_id)
        .cloned()
        .ok_or_else(|| format!("project profile {} not found", input.project_id))?;

    let resources = expected_project_resources(&library, &profile);
    let mut items = Vec::new();
    for resource in resources {
        if let Some(item) = build_apply_item(&normalized, &resource, &local_state.install_records)?
        {
            items.push(item);
        }
    }

    Ok(crate::domain::PreviewPlan {
        kind: crate::domain::PreviewPlanKind::Apply,
        project_id: profile.id,
        project_path: normalized.to_string_lossy().into_owned(),
        summary: summarize_items(&items),
        items,
    })
}

pub fn preview_capture_project_changes(
    app: &tauri::AppHandle,
    input: &ProjectPreviewInput,
) -> Result<crate::domain::PreviewPlan, String> {
    let normalized = normalize_user_path(&input.path)?;
    let local_state = load_local_state(app)?;
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;

    let profile = library
        .project_profiles
        .iter()
        .find(|profile| profile.id == input.project_id)
        .cloned()
        .ok_or_else(|| format!("project profile {} not found", input.project_id))?;

    let mut items = scan_files(&normalized, &local_state.install_records)?;

    let expected_resources = expected_project_resources(&library, &profile);
    for resource in expected_resources {
        let (absolute_path, relative_path) = project_target_path(&normalized, &resource);
        if absolute_path.exists() {
            continue;
        }

        items.push(ProjectFileEntry {
            relative_path,
            absolute_path: absolute_path.to_string_lossy().into_owned(),
            status: ProjectFileStatus::Missing,
            resource_id: Some(resource.id),
            install_record_id: local_state
                .install_records
                .iter()
                .find(|record| record.target.path == absolute_path.to_string_lossy())
                .map(|record| record.id.clone()),
            tracked: false,
            current_revision: None,
            expected_revision: Some(resource.revision),
            note: Some("expected by project profile but missing in project".into()),
        });
    }

    Ok(crate::domain::PreviewPlan {
        kind: crate::domain::PreviewPlanKind::Capture,
        project_id: profile.id,
        project_path: normalized.to_string_lossy().into_owned(),
        summary: summarize_items(&items),
        items,
    })
}

pub fn list_legacy_skills(app: &tauri::AppHandle) -> Result<Vec<LegacySkillDto>, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library_for_legacy_skills(app, &repo_root)?;
    Ok(library
        .resources
        .iter()
        .filter(|resource| resource.kind == ResourceKind::Skill)
        .map(|resource| resource_to_legacy_skill(resource, &library))
        .collect())
}

pub fn get_legacy_skill(
    app: &tauri::AppHandle,
    id: &str,
) -> Result<Option<LegacySkillDto>, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library_for_legacy_skills(app, &repo_root)?;
    Ok(library
        .resources
        .iter()
        .find(|resource| resource.kind == ResourceKind::Skill && resource.id == id)
        .map(|resource| resource_to_legacy_skill(resource, &library)))
}

fn is_managed_skill_resource(resource: &Resource) -> bool {
    resource.kind == ResourceKind::Skill
        && resource.scope == ResourceScope::Global
        && resource.project_id.is_none()
}

fn skill_has_remote_tag(resource: &Resource) -> bool {
    resource.tags.iter().any(|tag| tag.starts_with("_remote:"))
}

fn public_skill_tag_count(resource: &Resource) -> usize {
    resource
        .tags
        .iter()
        .filter(|tag| !tag.starts_with('_'))
        .count()
}

fn should_prefer_skill_resource(candidate: &Resource, current: &Resource) -> bool {
    let candidate_remote = skill_has_remote_tag(candidate);
    let current_remote = skill_has_remote_tag(current);
    if candidate_remote != current_remote {
        return !candidate_remote;
    }

    let candidate_public_tags = public_skill_tag_count(candidate);
    let current_public_tags = public_skill_tag_count(current);
    if candidate_public_tags != current_public_tags {
        return candidate_public_tags > current_public_tags;
    }

    if candidate.updated_at != current.updated_at {
        return candidate.updated_at > current.updated_at;
    }

    if candidate.created_at != current.created_at {
        return candidate.created_at > current.created_at;
    }

    candidate.id > current.id
}

fn merge_skill_resource_metadata(canonical: &mut Resource, duplicate: &Resource) {
    let keep_remote_tags = skill_has_remote_tag(canonical);
    let mut seen = canonical.tags.iter().cloned().collect::<HashSet<_>>();

    for tag in &duplicate.tags {
        if tag.starts_with("_remote:") && !keep_remote_tags {
            continue;
        }

        if seen.insert(tag.clone()) {
            canonical.tags.push(tag.clone());
        }
    }

    if canonical.description.is_none() && duplicate.description.is_some() {
        canonical.description = duplicate.description.clone();
    }
}

fn dedupe_managed_skill_resources(library: &mut RepoLibrary) -> HashMap<String, String> {
    let mut grouped_indexes: HashMap<String, Vec<usize>> = HashMap::new();

    for (index, resource) in library.resources.iter().enumerate() {
        if is_managed_skill_resource(resource) {
            grouped_indexes
                .entry(resource.slug.clone())
                .or_default()
                .push(index);
        }
    }

    let mut replaced_ids = HashMap::new();
    let mut removed_ids = HashSet::new();

    for indexes in grouped_indexes.values().filter(|indexes| indexes.len() > 1) {
        let mut canonical_index = indexes[0];
        for &index in indexes.iter().skip(1) {
            if should_prefer_skill_resource(&library.resources[index], &library.resources[canonical_index]) {
                canonical_index = index;
            }
        }

        let duplicates = indexes
            .iter()
            .copied()
            .filter(|index| *index != canonical_index)
            .map(|index| library.resources[index].clone())
            .collect::<Vec<_>>();

        {
            let canonical = &mut library.resources[canonical_index];
            for duplicate in &duplicates {
                merge_skill_resource_metadata(canonical, duplicate);
            }
        }

        let canonical_id = library.resources[canonical_index].id.clone();
        for duplicate in duplicates {
            removed_ids.insert(duplicate.id.clone());
            replaced_ids.insert(duplicate.id, canonical_id.clone());
        }
    }

    if replaced_ids.is_empty() {
        return replaced_ids;
    }

    for profile in &mut library.project_profiles {
        if let Some(mapped) = profile
            .agents_resource_id
            .as_ref()
            .and_then(|resource_id| replaced_ids.get(resource_id))
        {
            profile.agents_resource_id = Some(mapped.clone());
        }

        let mut seen = HashSet::new();
        let mut next_ids = Vec::with_capacity(profile.attached_resource_ids.len());
        for resource_id in &profile.attached_resource_ids {
            let mapped = replaced_ids
                .get(resource_id)
                .cloned()
                .unwrap_or_else(|| resource_id.clone());
            if seen.insert(mapped.clone()) {
                next_ids.push(mapped);
            }
        }
        profile.attached_resource_ids = next_ids;
    }

    library
        .resources
        .retain(|resource| !removed_ids.contains(&resource.id));

    replaced_ids
}

fn remap_install_record_resource_ids(
    install_records: &mut [InstallRecord],
    replaced_ids: &HashMap<String, String>,
) -> bool {
    let mut changed = false;

    for record in install_records {
        if let Some(replacement) = replaced_ids.get(&record.resource_id) {
            if record.resource_id != *replacement {
                record.resource_id = replacement.clone();
                changed = true;
            }
        }
    }

    changed
}

fn load_repo_library_for_legacy_skills(
    app: &tauri::AppHandle,
    repo_root: &Path,
) -> Result<RepoLibrary, String> {
    let mut library = load_repo_library(repo_root)?;
    let replaced_ids = dedupe_managed_skill_resources(&mut library);

    if replaced_ids.is_empty() {
        return Ok(library);
    }

    save_repo_library(repo_root, &library)?;

    let mut state = load_local_state(app)?;
    if remap_install_record_resource_ids(&mut state.install_records, &replaced_ids) {
        save_local_state(app, &state)?;
    }

    Ok(library)
}

fn is_backup_eligible_skill_resource(resource: &Resource) -> bool {
    is_managed_skill_resource(resource)
        && !resource
            .tags
            .iter()
            .any(|tag| tag.starts_with("_remote:"))
}

fn parse_skill_front_matter(content: &str) -> (Option<String>, Option<String>, Vec<String>) {
    let Some(rest) = content.strip_prefix("---\n") else {
        return (None, None, vec![]);
    };

    let Some((front_matter, _)) = rest.split_once("\n---\n") else {
        return (None, None, vec![]);
    };

    let mut name = None;
    let mut description = None;
    let mut tags = Vec::new();

    for line in front_matter.lines() {
        if let Some(value) = line.strip_prefix("name:") {
            name = Some(value.trim().trim_matches('"').to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("description:") {
            description = Some(value.trim().trim_matches('"').to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("tags:") {
            let trimmed = value.trim().trim_start_matches('[').trim_end_matches(']');
            if !trimmed.is_empty() {
                tags = trimmed
                    .split(',')
                    .map(|tag| tag.trim().trim_matches('"').trim_matches('\''))
                    .filter(|tag| !tag.is_empty())
                    .map(|tag| tag.to_string())
                    .collect();
            }
        }
    }

    (name, description, tags)
}

fn derive_skill_source_metadata(
    slug: &str,
    content: &str,
    existing_tags: Option<&[String]>,
) -> (String, Option<String>, Vec<String>) {
    let (front_name, front_description, front_tags) = parse_skill_front_matter(content);
    let (parsed_name, parsed_description) = parse_skill_metadata(content);

    let name = front_name
        .or_else(|| (!parsed_name.is_empty()).then_some(parsed_name))
        .unwrap_or_else(|| slug.to_string());
    let description = front_description.or(parsed_description);
    let tags = if front_tags.is_empty() {
        existing_tags.map(|tags| tags.to_vec()).unwrap_or_default()
    } else {
        front_tags
    };

    (name, description, tags)
}

fn ensure_managed_skills_materialized(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(repo_root) = connected_repo_root_if_available(app)? else {
        return Ok(());
    };

    let library = load_repo_library(&repo_root)?;
    for resource in library
        .resources
        .iter()
        .filter(|resource| is_managed_skill_resource(resource))
    {
        ensure_skill_source(app, &resource.slug, &resource.content)?;
    }

    Ok(())
}

fn default_library_repo_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(DEFAULT_LIBRARY_REPO_DIR))
}

fn prune_skill_dirs_in_root(root: &Path, allowed_slugs: &HashSet<String>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let slug = entry.file_name().to_string_lossy().into_owned();
        if slug.starts_with('.') || !path.is_dir() {
            continue;
        }

        if !path.join("SKILL.md").exists() {
            continue;
        }

        if !allowed_slugs.contains(&slug) {
            remove_path(&path)?;
        }
    }

    let embedded_library_dir = root.join(LIBRARY_DIR);
    if embedded_library_dir.exists() {
        remove_path(&embedded_library_dir)?;
    }

    Ok(())
}

fn ensure_local_library_repo_root(
    app: &tauri::AppHandle,
    local_state: &mut LocalState,
) -> Result<PathBuf, String> {
    let default_root = default_library_repo_root(app)?;
    let backup_root = skill_sources_dir(app)?;

    if let Some(repo) = local_state.repo.as_ref() {
        let normalized = normalize_user_path(&repo.path)?;
        if normalized != backup_root {
            return Ok(normalized);
        }

        let library = load_repo_library(&normalized)?;
        save_repo_library(&default_root, &library)?;
        local_state.repo = Some(RepoConfig {
            path: default_root.to_string_lossy().into_owned(),
            connected_at: now_ms(),
        });
        save_local_state(app, local_state)?;
        let embedded_library_dir = backup_root.join(LIBRARY_DIR);
        if embedded_library_dir.exists() {
            remove_path(&embedded_library_dir)?;
        }
        let git_dir = backup_root.join(".git");
        if git_dir.exists() {
            remove_path(&git_dir)?;
        }
        return Ok(default_root);
    }

    let library = load_repo_library(&default_root)?;
    save_repo_library(&default_root, &library)?;
    local_state.repo = Some(RepoConfig {
        path: default_root.to_string_lossy().into_owned(),
        connected_at: now_ms(),
    });
    save_local_state(app, local_state)?;
    Ok(default_root)
}

fn materialize_backup_eligible_skills_to_backup_repo(
    app: &tauri::AppHandle,
    backup_root: &Path,
) -> Result<(), String> {
    let Some(repo_root) = connected_repo_root_if_available(app)? else {
        return Ok(());
    };

    let library = load_repo_library(&repo_root)?;
    let mut slugs = HashSet::new();

    for resource in library
        .resources
        .iter()
        .filter(|resource| is_backup_eligible_skill_resource(resource))
    {
        ensure_skill_source_in_root(backup_root, &resource.slug, &resource.content, &[])?;
        slugs.insert(resource.slug.clone());
    }

    prune_skill_dirs_in_root(backup_root, &slugs)
}

fn sync_backup_eligible_skills_from_backup_repo(
    app: &tauri::AppHandle,
    backup_root: &Path,
) -> Result<(), String> {
    let Some(repo_root) = connected_repo_root_if_available(app)? else {
        return Ok(());
    };

    if !backup_root.exists() {
        return Ok(());
    }

    let mut library = load_repo_library(&repo_root)?;
    let embedded_backup_library = repo_manifest_path(backup_root)
        .exists()
        .then(|| load_repo_library(backup_root))
        .transpose()?;
    let embedded_allowed_slugs = embedded_backup_library.as_ref().map(|embedded| {
        embedded
            .resources
            .iter()
            .filter(|resource| is_backup_eligible_skill_resource(resource))
            .map(|resource| resource.slug.clone())
            .collect::<HashSet<_>>()
    });
    let now = now_ms();
    let mut changed = false;
    let mut existing_by_slug = HashMap::new();

    for (index, resource) in library.resources.iter().enumerate() {
        if is_backup_eligible_skill_resource(resource) {
            existing_by_slug.insert(resource.slug.clone(), index);
        }
    }

    let mut seen_slugs = HashSet::new();
    for entry in fs::read_dir(backup_root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let slug = entry.file_name().to_string_lossy().into_owned();
        if slug.starts_with('.') || !path.is_dir() {
            continue;
        }

        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }

        // Always mark as "seen" to prevent removal - ALL valid skills in backup_root
        // are protected from removal, regardless of embedded_allowed_slugs filter
        seen_slugs.insert(slug.clone());

        // Skip update/add if embedded_allowed_slugs is set and doesn't contain this slug
        if let Some(allowed_slugs) = embedded_allowed_slugs.as_ref() {
            if !allowed_slugs.contains(&slug) {
                continue;
            }
        }

        let content = fs::read_to_string(&skill_file).map_err(|error| error.to_string())?;
        let existing_tags = existing_by_slug
            .get(&slug)
            .and_then(|index| library.resources.get(*index))
            .map(|resource| resource.tags.as_slice());
        let (name, description, tags) =
            derive_skill_source_metadata(&slug, &content, existing_tags);
        let revision = compute_revision(&content);

        if let Some(index) = existing_by_slug.get(&slug).copied() {
            if let Some(resource) = library.resources.get_mut(index) {
                let mut resource_changed = false;

                if resource.title != name {
                    resource.title = name.clone();
                    resource_changed = true;
                }
                if resource.description != description {
                    resource.description = description.clone();
                    resource_changed = true;
                }
                if resource.tags != tags {
                    resource.tags = tags.clone();
                    resource_changed = true;
                }
                if resource.content != content {
                    resource.content = content.clone();
                    resource_changed = true;
                }
                if resource.revision != revision {
                    resource.revision = revision.clone();
                    resource_changed = true;
                }

                if resource_changed {
                    resource.updated_at = now;
                    changed = true;
                }
            }
        } else {
            library.resources.push(Resource {
                id: Uuid::new_v4().to_string(),
                slug: slug.clone(),
                title: name,
                description,
                kind: ResourceKind::Skill,
                scope: ResourceScope::Global,
                origin: ResourceOrigin::Private,
                source_status: SourceStatus::LocalOnly,
                project_id: None,
                tags,
                content,
                revision,
                source_url: None,
                source_ref: None,
                source_path: None,
                upstream_revision: None,
                forked_from: None,
                created_at: now,
                updated_at: now,
            });
            changed = true;
        }
    }

    let removed_ids = library
        .resources
        .iter()
        .filter(|resource| {
            is_backup_eligible_skill_resource(resource) && !seen_slugs.contains(&resource.slug)
        })
        .map(|resource| resource.id.clone())
        .collect::<HashSet<_>>();

    if !removed_ids.is_empty() {
        library.resources.retain(|resource| !removed_ids.contains(&resource.id));
        for resource_id in &removed_ids {
            detach_resource_from_all_profiles(&mut library.project_profiles, resource_id);
        }
        changed = true;
    }

    if changed {
        save_repo_library(&repo_root, &library)?;
    }

    for resource in library
        .resources
        .iter()
        .filter(|resource| is_backup_eligible_skill_resource(resource))
    {
        ensure_skill_source(app, &resource.slug, &resource.content)?;
    }

    Ok(())
}

fn detach_backup_git_metadata_from_live_skill_sources(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let source_root = skill_sources_dir(app)?;
    if !source_root.exists() {
        return Ok(Vec::new());
    }

    let mut notices = Vec::new();
    let git_dir = source_root.join(".git");
    if git_dir.exists() {
        remove_path(&git_dir)?;
        notices.push("已将备份源 Git 元数据从 skill-sources 拆分到独立目录".into());
    }

    let embedded_library_dir = source_root.join(LIBRARY_DIR);
    if embedded_library_dir.exists() {
        remove_path(&embedded_library_dir)?;
        notices.push("已从 skill-sources 清理嵌入的本地库索引".into());
    }

    Ok(notices)
}

pub fn create_legacy_skill(
    app: &tauri::AppHandle,
    input: &CreateSkillInput,
) -> Result<LegacySkillDto, String> {
    let repo_root = connected_repo_root(app)?;
    let mut library = load_repo_library_for_legacy_skills(app, &repo_root)?;
    let now = now_ms();
    let slug = slugify(&input.name);

    if library
        .resources
        .iter()
        .any(|resource| is_managed_skill_resource(resource) && resource.slug == slug)
    {
        return Err(format!("已存在同名 Skill：{}", slug));
    }

    let resource = Resource {
        id: Uuid::new_v4().to_string(),
        slug,
        title: input.name.clone(),
        description: input.description.clone(),
        kind: ResourceKind::Skill,
        scope: ResourceScope::Global,
        origin: ResourceOrigin::Private,
        source_status: SourceStatus::LocalOnly,
        project_id: None,
        tags: input.tags.clone(),
        content: input.content.clone(),
        revision: compute_revision(&input.content),
        source_url: None,
        source_ref: None,
        source_path: None,
        upstream_revision: None,
        forked_from: None,
        created_at: now,
        updated_at: now,
    };

    let resource_id = resource.id.clone();
    library.resources.push(resource.clone());
    attach_resource_to_profiles(
        &mut library.project_profiles,
        &resource_id,
        &input.project_ids,
    );
    save_repo_library(&repo_root, &library)?;
    ensure_skill_source_with_directories(
        app,
        &resource.slug,
        &resource.content,
        &input.directories,
    )?;

    // Sync to backup source if configured
    let _ = backup_source_push(app);

    Ok(resource_to_legacy_skill(&resource, &library))
}

pub fn update_legacy_skill(
    app: &tauri::AppHandle,
    input: &UpdateSkillInput,
) -> Result<LegacySkillDto, String> {
    let repo_root = connected_repo_root(app)?;
    let mut library = load_repo_library_for_legacy_skills(app, &repo_root)?;
    let parsed_front_matter = input.content.as_ref().map(|content| {
        let (name, description, _) = parse_skill_front_matter(content);
        (name, description)
    });

    {
        let resource = library
            .resources
            .iter_mut()
            .find(|resource| resource.kind == ResourceKind::Skill && resource.id == input.id)
            .ok_or_else(|| format!("skill {} not found", input.id))?;

        if let Some(name) = &input.name {
            resource.title = name.clone();
        }
        if let Some(description) = &input.description {
            resource.description = description.clone();
        }
        if let Some(content) = &input.content {
            resource.content = content.clone();
            resource.revision = compute_revision(content);

            if input.name.is_none() {
                if let Some(front_name) = parsed_front_matter
                    .as_ref()
                    .and_then(|(name, _)| name.clone())
                    .map(|name| name.trim().to_string())
                    .filter(|name| !name.is_empty())
                {
                    resource.title = front_name;
                }
            }

            if input.description.is_none() {
                if let Some(front_description) = parsed_front_matter
                    .as_ref()
                    .and_then(|(_, description)| description.clone())
                {
                    let trimmed = front_description.trim().to_string();
                    resource.description = if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    };
                }
            }
        }
        if let Some(tags) = &input.tags {
            resource.tags = tags.clone();
        }
        resource.updated_at = now_ms();
    }

    if let Some(project_ids) = &input.project_ids {
        detach_resource_from_all_profiles(&mut library.project_profiles, &input.id);
        attach_resource_to_profiles(&mut library.project_profiles, &input.id, project_ids);
    }

    let resource = library
        .resources
        .iter()
        .find(|resource| resource.kind == ResourceKind::Skill && resource.id == input.id)
        .ok_or_else(|| format!("skill {} not found", input.id))?;
    let result = resource_to_legacy_skill(resource, &library);
    save_repo_library(&repo_root, &library)?;
    ensure_skill_source(app, &resource.slug, &resource.content)?;
    Ok(result)
}

pub fn delete_legacy_skill(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let repo_root = connected_repo_root(app)?;
    let mut library = load_repo_library_for_legacy_skills(app, &repo_root)?;
    let removed_slug = library
        .resources
        .iter()
        .find(|resource| resource.id == id)
        .map(|resource| resource.slug.clone())
        .ok_or_else(|| format!("skill {} not found", id))?;
    let before = library.resources.len();
    library.resources.retain(|resource| resource.id != id);
    debug_assert!(before > library.resources.len());
    detach_resource_from_all_profiles(&mut library.project_profiles, id);
    save_repo_library(&repo_root, &library)?;

    let source_dir = skill_source_dir(app, &removed_slug)?;
    if source_dir.exists() {
        remove_path(&source_dir)?;
    }

    Ok(())
}

pub fn search_legacy_skills(
    app: &tauri::AppHandle,
    query: &str,
) -> Result<Vec<LegacySkillDto>, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library_for_legacy_skills(app, &repo_root)?;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return list_legacy_skills(app);
    }

    Ok(library
        .resources
        .iter()
        .filter(|resource| resource.kind == ResourceKind::Skill)
        .filter(|resource| {
            resource.title.to_lowercase().contains(&needle)
                || resource
                    .description
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&needle)
                || resource.content.to_lowercase().contains(&needle)
                || resource
                    .tags
                    .iter()
                    .any(|tag| tag.to_lowercase().contains(&needle))
        })
        .map(|resource| resource_to_legacy_skill(resource, &library))
        .collect())
}

pub fn list_legacy_projects(app: &tauri::AppHandle) -> Result<Vec<LegacyProjectDto>, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let state = load_local_state(app)?;
    let binding_map = state
        .project_bindings
        .iter()
        .map(|binding| (binding.project_id.clone(), binding.path.clone()))
        .collect::<std::collections::HashMap<_, _>>();

    Ok(library
        .project_profiles
        .iter()
        .map(|profile| LegacyProjectDto {
            id: profile.id.clone(),
            name: profile.name.clone(),
            path: binding_map.get(&profile.id).cloned(),
            color: profile.color.clone(),
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        })
        .collect())
}

pub fn create_legacy_project(
    app: &tauri::AppHandle,
    input: &CreateProjectInput,
) -> Result<LegacyProjectDto, String> {
    let repo_root = connected_repo_root(app)?;
    let mut library = load_repo_library(&repo_root)?;
    let mut state = load_local_state(app)?;
    let now = now_ms();
    let profile = ProjectProfile {
        id: Uuid::new_v4().to_string(),
        slug: slugify(&input.name),
        name: input.name.clone(),
        description: None,
        color: input.color.clone(),
        agents_resource_id: None,
        attached_resource_ids: Vec::new(),
        created_at: now,
        updated_at: now,
    };
    if let Some(path) = &input.path {
        upsert_project_binding(&mut state.project_bindings, &profile.id, path);
    }
    let result = LegacyProjectDto {
        id: profile.id.clone(),
        name: profile.name.clone(),
        path: input.path.clone(),
        color: profile.color.clone(),
        created_at: profile.created_at,
        updated_at: profile.updated_at,
    };
    library.project_profiles.push(profile);
    save_repo_library(&repo_root, &library)?;
    save_local_state(app, &state)?;
    Ok(result)
}

pub fn update_legacy_project(
    app: &tauri::AppHandle,
    input: &UpdateProjectInput,
) -> Result<LegacyProjectDto, String> {
    let repo_root = connected_repo_root(app)?;
    let mut library = load_repo_library(&repo_root)?;
    let mut state = load_local_state(app)?;
    let profile = library
        .project_profiles
        .iter_mut()
        .find(|profile| profile.id == input.id)
        .ok_or_else(|| format!("project {} not found", input.id))?;

    if let Some(name) = &input.name {
        profile.name = name.clone();
        profile.slug = slugify(name);
    }
    if let Some(color) = &input.color {
        profile.color = color.clone();
    }
    profile.updated_at = now_ms();

    if let Some(path) = &input.path {
        match path {
            Some(path) => upsert_project_binding(&mut state.project_bindings, &profile.id, path),
            None => state
                .project_bindings
                .retain(|binding| binding.project_id != profile.id),
        }
    }

    let result = LegacyProjectDto {
        id: profile.id.clone(),
        name: profile.name.clone(),
        path: state
            .project_bindings
            .iter()
            .find(|binding| binding.project_id == profile.id)
            .map(|binding| binding.path.clone()),
        color: profile.color.clone(),
        created_at: profile.created_at,
        updated_at: profile.updated_at,
    };
    save_repo_library(&repo_root, &library)?;
    save_local_state(app, &state)?;
    Ok(result)
}

pub fn delete_legacy_project(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let repo_root = connected_repo_root(app)?;
    let mut library = load_repo_library(&repo_root)?;
    let mut state = load_local_state(app)?;
    let before = library.project_profiles.len();
    let mut scoped_resource_ids = HashSet::new();
    for resource in &library.resources {
        if resource.project_id.as_deref() == Some(id) {
            scoped_resource_ids.insert(resource.id.clone());
        }
    }

    library.project_profiles.retain(|profile| profile.id != id);
    if before == library.project_profiles.len() {
        return Err(format!("project {} not found", id));
    }

    library.resources.retain(|resource| {
        resource.project_id.as_deref() != Some(id) && !scoped_resource_ids.contains(&resource.id)
    });
    state
        .project_bindings
        .retain(|binding| binding.project_id != id);
    state
        .install_records
        .retain(|record| record.target.project_id.as_deref() != Some(id));
    save_repo_library(&repo_root, &library)?;
    save_local_state(app, &state)
}

fn expected_project_resources(library: &RepoLibrary, profile: &ProjectProfile) -> Vec<Resource> {
    let mut resources = Vec::new();
    let mut seen = HashSet::new();

    if let Some(agents_resource_id) = &profile.agents_resource_id {
        if let Some(resource) = library
            .resources
            .iter()
            .find(|resource| resource.id == *agents_resource_id)
        {
            seen.insert(resource.id.clone());
            resources.push(resource.clone());
        }
    }

    for resource in &library.resources {
        let attached = profile
            .attached_resource_ids
            .iter()
            .any(|id| id == &resource.id);
        let project_scoped = resource.project_id.as_deref() == Some(profile.id.as_str());
        if (attached || project_scoped) && seen.insert(resource.id.clone()) {
            resources.push(resource.clone());
        }
    }

    resources
}

fn project_target_path(project_root: &Path, resource: &Resource) -> (PathBuf, String) {
    match resource.kind {
        ResourceKind::Agents => {
            let relative = "AGENTS.md".to_string();
            (project_root.join(&relative), relative)
        }
        ResourceKind::Skill => {
            let relative = format!(".codex/skills/{}/SKILL.md", resource.slug);
            (project_root.join(&relative), relative)
        }
        ResourceKind::Prompt => {
            let relative = format!(".codex/prompts/{}.md", resource.slug);
            (project_root.join(&relative), relative)
        }
    }
}

fn build_apply_item(
    project_root: &Path,
    resource: &Resource,
    install_records: &[InstallRecord],
) -> Result<Option<ProjectFileEntry>, String> {
    let (absolute_path, relative_path) = project_target_path(project_root, resource);
    let install_record = install_records
        .iter()
        .find(|record| record.target.path == absolute_path.to_string_lossy());

    let tracked = git::tracked(project_root, &absolute_path);
    if tracked {
        return Ok(Some(ProjectFileEntry {
            relative_path,
            absolute_path: absolute_path.to_string_lossy().into_owned(),
            status: ProjectFileStatus::TrackedConflict,
            resource_id: Some(resource.id.clone()),
            install_record_id: install_record.map(|record| record.id.clone()),
            tracked: true,
            current_revision: read_revision(&absolute_path)?,
            expected_revision: Some(resource.revision.clone()),
            note: Some("target file is already tracked by git".into()),
        }));
    }

    if !absolute_path.exists() {
        return Ok(Some(ProjectFileEntry {
            relative_path,
            absolute_path: absolute_path.to_string_lossy().into_owned(),
            status: ProjectFileStatus::New,
            resource_id: Some(resource.id.clone()),
            install_record_id: install_record.map(|record| record.id.clone()),
            tracked: false,
            current_revision: None,
            expected_revision: Some(resource.revision.clone()),
            note: Some("file will be created".into()),
        }));
    }

    let current_revision = read_revision(&absolute_path)?;
    let status = if current_revision.as_deref() == Some(resource.revision.as_str()) {
        ProjectFileStatus::Unchanged
    } else if install_record
        .map(|record| record.revision != current_revision.clone().unwrap_or_default())
        .unwrap_or(false)
    {
        ProjectFileStatus::Diverged
    } else {
        ProjectFileStatus::Modified
    };

    if status == ProjectFileStatus::Unchanged {
        return Ok(None);
    }

    Ok(Some(ProjectFileEntry {
        relative_path,
        absolute_path: absolute_path.to_string_lossy().into_owned(),
        status,
        resource_id: Some(resource.id.clone()),
        install_record_id: install_record.map(|record| record.id.clone()),
        tracked: false,
        current_revision,
        expected_revision: Some(resource.revision.clone()),
        note: Some("file exists and would change during apply".into()),
    }))
}

fn scan_files(
    project_root: &Path,
    install_records: &[InstallRecord],
) -> Result<Vec<ProjectFileEntry>, String> {
    let mut items = Vec::new();
    let agents_path = project_root.join("AGENTS.md");

    if agents_path.exists() {
        items.push(classify_existing_file(
            project_root,
            &agents_path,
            install_records,
        )?);
    }

    for skills_root in app_skill_dirs(project_root, "codex")? {
        if skills_root.exists() {
            for entry in fs::read_dir(skills_root).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                let skill_file = entry.path().join("SKILL.md");
                if skill_file.exists() {
                    items.push(classify_existing_file(
                        project_root,
                        &skill_file,
                        install_records,
                    )?);
                }
            }
        }
    }

    for record in install_records {
        let target_path = Path::new(&record.target.path);
        if record.target.project_id.is_some()
            && target_path.starts_with(project_root)
            && !target_path.exists()
        {
            items.push(ProjectFileEntry {
                relative_path: record.target.relative_path.clone(),
                absolute_path: record.target.path.clone(),
                status: ProjectFileStatus::Missing,
                resource_id: Some(record.resource_id.clone()),
                install_record_id: Some(record.id.clone()),
                tracked: false,
                current_revision: None,
                expected_revision: Some(record.revision.clone()),
                note: Some("install record exists but file is missing".into()),
            });
        }
    }

    Ok(items)
}

fn classify_existing_file(
    project_root: &Path,
    absolute_path: &Path,
    install_records: &[InstallRecord],
) -> Result<ProjectFileEntry, String> {
    let relative_path = absolute_path
        .strip_prefix(project_root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .into_owned();
    let install_record = install_records
        .iter()
        .find(|record| record.target.path == absolute_path.to_string_lossy());
    let current_revision = read_revision(absolute_path)?;
    let tracked = git::tracked(project_root, absolute_path);

    let status = if tracked {
        ProjectFileStatus::TrackedConflict
    } else if let Some(record) = install_record {
        if current_revision.as_deref() == Some(record.revision.as_str()) {
            ProjectFileStatus::Unchanged
        } else {
            ProjectFileStatus::Diverged
        }
    } else {
        ProjectFileStatus::New
    };

    Ok(ProjectFileEntry {
        relative_path,
        absolute_path: absolute_path.to_string_lossy().into_owned(),
        status,
        resource_id: install_record.map(|record| record.resource_id.clone()),
        install_record_id: install_record.map(|record| record.id.clone()),
        tracked,
        current_revision,
        expected_revision: install_record.map(|record| record.revision.clone()),
        note: None,
    })
}

fn read_revision(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(Some(compute_revision(&content)))
}

fn summarize_items(items: &[ProjectFileEntry]) -> ProjectScanSummary {
    ProjectScanSummary {
        total_items: items.len(),
        tracked_conflicts: items
            .iter()
            .filter(|item| item.status == ProjectFileStatus::TrackedConflict)
            .count(),
        divergent_items: items
            .iter()
            .filter(|item| item.status == ProjectFileStatus::Diverged)
            .count(),
    }
}

fn item_is_ignored(input: &ProjectPreviewInput, item: &ProjectFileEntry) -> bool {
    input
        .decisions
        .iter()
        .find(|decision| decision.path == item.absolute_path || decision.path == item.relative_path)
        .map(|decision| decision.action == PreviewDecisionAction::Ignore)
        .unwrap_or(false)
}

pub fn repo_pull(app: &tauri::AppHandle) -> Result<RepoStatus, String> {
    let repo_root = connected_repo_root(app)?;
    git::pull(&repo_root)?;
    let library = load_repo_library(&repo_root)?;
    build_repo_status_from_state(&repo_root, &library, None)
}

pub fn repo_push(app: &tauri::AppHandle) -> Result<RepoStatus, String> {
    let repo_root = connected_repo_root(app)?;
    git::push(&repo_root)?;
    let library = load_repo_library(&repo_root)?;
    build_repo_status_from_state(&repo_root, &library, None)
}

pub fn repo_sync(app: &tauri::AppHandle) -> Result<RepoStatus, String> {
    let repo_root = connected_repo_root(app)?;
    git::pull(&repo_root)?;
    let library = load_repo_library(&repo_root)?;
    build_repo_status_from_state(&repo_root, &library, None)
}

pub fn backup_source_status(app: &tauri::AppHandle) -> Result<BackupSourceStatus, String> {
    match backup_source_settings(app)? {
        Some(config) => backup_source_status_from_config(&config, None),
        None => Ok(BackupSourceStatus {
            enabled: false,
            repo: String::new(),
            label: String::new(),
            remote_url: String::new(),
            branch: "main".to_string(),
            local_path: None,
            last_synced_at: None,
            connected: false,
            git_available: git::git_available(),
            is_git_repo: false,
            head: None,
            ahead: 0,
            behind: 0,
            dirty: false,
            notice: None,
        }),
    }
}

pub fn backup_source_connect(app: &tauri::AppHandle) -> Result<BackupSourceStatus, String> {
    let mut settings = load_settings(app)?;
    let source = settings
        .backup_source
        .clone()
        .ok_or_else(|| "backup source is not configured".to_string())?;
    let normalized = normalize_backup_source(app, &source)?;

    if !normalized.enabled {
        return Err("backup source is disabled".into());
    }
    if !git::git_available() {
        return Err("git is not available on this machine".into());
    }

    let notice = prepare_backup_source_worktree(app, &source, &normalized)?;
    let backup_root = PathBuf::from(
        normalized
            .local_path
            .clone()
            .ok_or_else(|| "backup source local path missing".to_string())?,
    );
    sync_backup_eligible_skills_from_backup_repo(app, &backup_root)?;

    let updated = BackupSourceConfig {
        local_path: normalized.local_path.clone(),
        ..normalized
    };

    settings.backup_source = Some(updated.clone());
    save_settings(app, &settings)?;
    backup_source_status_from_config(&updated, notice)
}

pub fn backup_source_pull(app: &tauri::AppHandle) -> Result<BackupSourceStatus, String> {
    let mut settings = load_settings(app)?;
    let source = settings
        .backup_source
        .clone()
        .ok_or_else(|| "backup source is not configured".to_string())?;
    let normalized = normalize_backup_source(app, &source)?;

    if !normalized.enabled {
        return Err("backup source is disabled".into());
    }

    let local_path = PathBuf::from(
        normalized
            .local_path
            .clone()
            .ok_or_else(|| "backup source local path missing".to_string())?,
    );
    if !local_path.exists() || !git::is_git_repo(&local_path) {
        return Err("backup source is not connected locally yet".into());
    }

    let mut notices = Vec::new();
    if !git::remote_branch_exists(&normalized.remote_url, &normalized.branch)? {
        return backup_source_status_from_config(&normalized, None);
    }

    git::checkout_branch(&local_path, &normalized.branch)?;
    git::pull(&local_path)?;
    sync_backup_eligible_skills_from_backup_repo(app, &local_path)?;
    cleanup_legacy_backup_source_paths(app, &source, &normalized, &local_path)?;
    if !source
        .local_path
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
        && source.local_path != normalized.local_path
    {
        notices.push("已清理旧的 backup-source 目录，当前已切换为独立备份工作树".into());
    }

    let mut next_source = normalized.clone();
    next_source.last_synced_at = Some(now_ms());
    settings.backup_source = Some(next_source.clone());
    save_settings(app, &settings)?;
    backup_source_status_from_config(&next_source, build_backup_source_notice(notices))
}

pub fn backup_source_push(app: &tauri::AppHandle) -> Result<BackupSourceStatus, String> {
    let mut settings = load_settings(app)?;
    let source = settings
        .backup_source
        .clone()
        .ok_or_else(|| "backup source is not configured".to_string())?;
    let normalized = normalize_backup_source(app, &source)?;

    if !normalized.enabled {
        return Err("backup source is disabled".into());
    }

    let local_path = PathBuf::from(
        normalized
            .local_path
            .clone()
            .ok_or_else(|| "backup source local path missing".to_string())?,
    );
    if !local_path.exists() || !git::is_git_repo(&local_path) {
        return Err("backup source is not connected locally yet".into());
    }

    materialize_backup_eligible_skills_to_backup_repo(app, &local_path)?;
    git::configure_identity(&local_path)?;
    ensure_backup_source_origin(&local_path, &normalized.remote_url)?;
    git::checkout_branch(&local_path, &normalized.branch)?;
    git::add_all(&local_path)?;
    let commit_message = format!(
        "Backup skill sources {}",
        chrono::Utc::now().format("%Y-%m-%d %H:%M")
    );
    let _ = git::commit(&local_path, &commit_message)?;
    git::push_branch(&local_path, "origin", &normalized.branch)?;

    let mut next_source = normalized.clone();
    next_source.last_synced_at = Some(now_ms());
    settings.backup_source = Some(next_source.clone());
    save_settings(app, &settings)?;
    backup_source_status_from_config(&next_source, None)
}

pub fn apply_project_profile(
    app: &tauri::AppHandle,
    input: &ProjectPreviewInput,
) -> Result<(), String> {
    let preview = preview_project_apply(app, input)?;
    let selected_items = preview
        .items
        .iter()
        .filter(|item| !item_is_ignored(input, item))
        .collect::<Vec<_>>();

    if selected_items
        .iter()
        .any(|item| item.status == ProjectFileStatus::TrackedConflict)
    {
        return Err("Cannot apply while target files are tracked by git.".into());
    }
    if selected_items
        .iter()
        .any(|item| item.status == ProjectFileStatus::Diverged)
    {
        return Err(
            "Cannot apply while project files have diverged from installed revisions.".into(),
        );
    }

    let selected_paths = selected_items
        .iter()
        .map(|item| item.absolute_path.clone())
        .collect::<HashSet<_>>();

    let normalized = normalize_user_path(&input.path)?;
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let mut state = load_local_state(app)?;
    let profile = library
        .project_profiles
        .iter()
        .find(|profile| profile.id == input.project_id)
        .cloned()
        .ok_or_else(|| format!("project profile {} not found", input.project_id))?;

    let resources = expected_project_resources(&library, &profile);
    for resource in resources {
        let (absolute_path, relative_path) = project_target_path(&normalized, &resource);
        let absolute_path_string = absolute_path.to_string_lossy().into_owned();
        if !input.decisions.is_empty() && !selected_paths.contains(&absolute_path_string) {
            continue;
        }
        write_resource_to_path(&absolute_path, &resource.content)?;
        ensure_git_exclude(&normalized)?;
        upsert_install_record(
            &mut state.install_records,
            &resource,
            InstallTarget {
                kind: target_kind_for_resource(&resource),
                project_id: Some(profile.id.clone()),
                path: absolute_path_string,
                relative_path,
            },
        );
    }

    upsert_project_binding(
        &mut state.project_bindings,
        &profile.id,
        &normalized.to_string_lossy(),
    );
    state.last_active_project_id = Some(profile.id.clone());
    remember_recent_project(&mut state.recent_project_ids, &profile.id);
    save_local_state(app, &state)
}

pub fn capture_project_changes(
    app: &tauri::AppHandle,
    input: &ProjectPreviewInput,
) -> Result<(), String> {
    let preview = preview_capture_project_changes(app, input)?;
    let selected_items = preview
        .items
        .iter()
        .filter(|item| !item_is_ignored(input, item))
        .collect::<Vec<_>>();
    let selected_paths = selected_items
        .iter()
        .map(|item| item.absolute_path.clone())
        .collect::<HashSet<_>>();
    let selected_resource_ids = selected_items
        .iter()
        .filter_map(|item| item.resource_id.clone())
        .collect::<HashSet<_>>();

    let normalized = normalize_user_path(&input.path)?;
    let repo_root = connected_repo_root(app)?;
    let mut library = load_repo_library(&repo_root)?;
    let mut state = load_local_state(app)?;
    let profile_index = library
        .project_profiles
        .iter()
        .position(|profile| profile.id == input.project_id)
        .ok_or_else(|| format!("project profile {} not found", input.project_id))?;
    let project_id = library.project_profiles[profile_index].id.clone();
    let project_name = library.project_profiles[profile_index].name.clone();

    let agents_path = normalized.join("AGENTS.md");
    let agents_path_string = agents_path.to_string_lossy().into_owned();
    let agents_selected =
        input.decisions.is_empty() || selected_paths.contains(&agents_path_string);

    if agents_selected && agents_path.exists() {
        let content = fs::read_to_string(&agents_path).map_err(|error| error.to_string())?;
        let resource_id = upsert_project_resource(
            &mut library.resources,
            Some(project_id.clone()),
            ResourceKind::Agents,
            &format!("{} agents", project_name),
            "agents",
            content,
        );
        library.project_profiles[profile_index].agents_resource_id = Some(resource_id);
    } else if agents_selected {
        if let Some(agents_resource_id) = library.project_profiles[profile_index]
            .agents_resource_id
            .clone()
        {
            library
                .resources
                .retain(|resource| resource.id != agents_resource_id);
        }
        library.project_profiles[profile_index].agents_resource_id = None;
    }

    let mut seen_skill_resource_ids = HashSet::new();
    for skills_root in app_skill_dirs(&normalized, "codex")? {
        if skills_root.exists() {
            for entry in fs::read_dir(&skills_root).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                let folder_path = entry.path();
                let skill_file = folder_path.join("SKILL.md");
                if !skill_file.exists() {
                    continue;
                }
                let skill_path_string = skill_file.to_string_lossy().into_owned();
                if !input.decisions.is_empty() && !selected_paths.contains(&skill_path_string) {
                    continue;
                }
                let slug = entry.file_name().to_string_lossy().into_owned();
                let content = fs::read_to_string(&skill_file).map_err(|error| error.to_string())?;
                let resource_id = upsert_project_resource(
                    &mut library.resources,
                    Some(project_id.clone()),
                    ResourceKind::Skill,
                    &slug,
                    &slug,
                    content,
                );
                seen_skill_resource_ids.insert(resource_id.clone());
                if !library.project_profiles[profile_index]
                    .attached_resource_ids
                    .contains(&resource_id)
                {
                    library.project_profiles[profile_index]
                        .attached_resource_ids
                        .push(resource_id);
                }
            }
        }
    }

    library.project_profiles[profile_index]
        .attached_resource_ids
        .retain(|resource_id| {
            library
                .resources
                .iter()
                .find(|resource| resource.id == *resource_id)
                .map(|resource| {
                    if resource.project_id.as_deref() != Some(project_id.as_str()) {
                        return true;
                    }
                    if resource.kind != ResourceKind::Skill {
                        return true;
                    }
                    if input.decisions.is_empty() || selected_resource_ids.contains(resource_id) {
                        seen_skill_resource_ids.contains(resource_id)
                    } else {
                        true
                    }
                })
                .unwrap_or(false)
        });

    let current_agents_resource_id = library.project_profiles[profile_index]
        .agents_resource_id
        .clone();
    library.resources.retain(|resource| {
        if resource.project_id.as_deref() != Some(project_id.as_str()) {
            return true;
        }
        if resource.kind == ResourceKind::Agents {
            return !agents_selected
                || current_agents_resource_id.as_deref() == Some(resource.id.as_str());
        }
        if input.decisions.is_empty() || selected_resource_ids.contains(&resource.id) {
            return seen_skill_resource_ids.contains(&resource.id);
        }
        true
    });

    upsert_project_binding(
        &mut state.project_bindings,
        &project_id,
        &normalized.to_string_lossy(),
    );
    state.last_active_project_id = Some(project_id.clone());
    remember_recent_project(&mut state.recent_project_ids, &project_id);
    save_repo_library(&repo_root, &library)?;
    save_local_state(app, &state)
}

pub fn apply_install_refresh(app: &tauri::AppHandle, record_id: &str) -> Result<(), String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let mut state = load_local_state(app)?;
    let record = state
        .install_records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("install record {} not found", record_id))?;
    let resource = library
        .resources
        .iter()
        .find(|resource| resource.id == record.resource_id)
        .cloned()
        .ok_or_else(|| format!("resource {} not found", record.resource_id))?;

    write_resource_to_path(Path::new(&record.target.path), &resource.content)?;
    if let Some(project_id) = &record.target.project_id {
        if let Some(binding) = state
            .project_bindings
            .iter()
            .find(|binding| binding.project_id == *project_id)
        {
            ensure_git_exclude(Path::new(&binding.path))?;
        }
    }

    record.revision = resource.revision;
    record.status = InstallStatus::InSync;
    record.last_scanned_at = Some(now_ms());
    record.updated_at = now_ms();
    save_local_state(app, &state)
}

pub fn scan_global_environment(app: &tauri::AppHandle) -> Result<RecoveryScanResult, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;
    let codex_home = preferred_app_cli_dir(&home_dir, "codex")?;

    let mut global_items = Vec::new();
    let mut known_paths = HashSet::new();

    for resource in library
        .resources
        .iter()
        .filter(|resource| resource.scope == ResourceScope::Global)
        .filter(|resource| {
            resource.kind == ResourceKind::Skill || resource.kind == ResourceKind::Prompt
        })
    {
        let path = global_target_path(&codex_home, resource);
        known_paths.insert(path.clone());
        let local_revision = read_revision(&path)?;
        let status = match local_revision.as_deref() {
            None => "repo-only",
            Some(revision) if revision == resource.revision => "same",
            Some(_) => "different",
        };
        global_items.push(RecoveryEntry {
            id: resource.id.clone(),
            kind: match resource.kind {
                ResourceKind::Skill => "skill",
                ResourceKind::Prompt => "prompt",
                ResourceKind::Agents => "agents",
            }
            .into(),
            name: resource.title.clone(),
            path: path.to_string_lossy().into_owned(),
            status: status.into(),
            repo_revision: Some(resource.revision.clone()),
            local_revision,
        });
    }

    for local_path in discover_local_codex_files(&codex_home)? {
        if known_paths.contains(&local_path) {
            continue;
        }
        global_items.push(RecoveryEntry {
            id: local_path.to_string_lossy().into_owned(),
            kind: if local_path
                .components()
                .any(|component| component.as_os_str() == "skills")
            {
                "skill".into()
            } else {
                "prompt".into()
            },
            name: local_path
                .file_stem()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "local item".into()),
            path: local_path.to_string_lossy().into_owned(),
            status: "local-only".into(),
            repo_revision: None,
            local_revision: read_revision(&local_path)?,
        });
    }

    let project_items = library
        .project_profiles
        .iter()
        .map(|profile| RecoveryEntry {
            id: profile.id.clone(),
            kind: "project".into(),
            name: profile.name.clone(),
            path: profile.slug.clone(),
            status: "repo-only".into(),
            repo_revision: None,
            local_revision: None,
        })
        .collect::<Vec<_>>();

    Ok(RecoveryScanResult {
        summary: format!(
            "{} global item(s) and {} project profile(s) detected",
            global_items.len(),
            project_items.len()
        ),
        global_items,
        project_items,
    })
}

pub fn preview_environment_restore(app: &tauri::AppHandle) -> Result<PreviewPlan, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;
    let codex_home = preferred_app_cli_dir(&home_dir, "codex")?;

    let mut items = Vec::new();
    for resource in library
        .resources
        .iter()
        .filter(|resource| resource.scope == ResourceScope::Global)
        .filter(|resource| {
            resource.kind == ResourceKind::Skill || resource.kind == ResourceKind::Prompt
        })
    {
        let target_path = global_target_path(&codex_home, resource);
        let current_revision = read_revision(&target_path)?;
        let status = match current_revision.as_deref() {
            None => ProjectFileStatus::New,
            Some(revision) if revision == resource.revision => ProjectFileStatus::Unchanged,
            Some(_) => ProjectFileStatus::Modified,
        };

        if status == ProjectFileStatus::Unchanged {
            continue;
        }

        let relative_path = target_path
            .strip_prefix(&home_dir)
            .unwrap_or(&target_path)
            .to_string_lossy()
            .into_owned();
        items.push(ProjectFileEntry {
            relative_path,
            absolute_path: target_path.to_string_lossy().into_owned(),
            status,
            resource_id: Some(resource.id.clone()),
            install_record_id: None,
            tracked: false,
            current_revision,
            expected_revision: Some(resource.revision.clone()),
            note: Some("global Codex item will be restored from the library repo".into()),
        });
    }

    Ok(PreviewPlan {
        kind: PreviewPlanKind::Apply,
        project_id: "global-environment".into(),
        project_path: codex_home.to_string_lossy().into_owned(),
        summary: summarize_items(&items),
        items,
    })
}

pub fn apply_environment_restore(app: &tauri::AppHandle) -> Result<(), String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;
    let codex_home = preferred_app_cli_dir(&home_dir, "codex")?;
    let mut state = load_local_state(app)?;

    for resource in library
        .resources
        .iter()
        .filter(|resource| resource.scope == ResourceScope::Global)
        .filter(|resource| {
            resource.kind == ResourceKind::Skill || resource.kind == ResourceKind::Prompt
        })
    {
        let target_path = global_target_path(&codex_home, resource);
        write_resource_to_path(&target_path, &resource.content)?;
        let relative_path = target_path
            .strip_prefix(&home_dir)
            .unwrap_or(&target_path)
            .to_string_lossy()
            .into_owned();
        upsert_install_record(
            &mut state.install_records,
            resource,
            InstallTarget {
                kind: target_kind_for_resource(resource),
                project_id: None,
                path: target_path.to_string_lossy().into_owned(),
                relative_path,
            },
        );
    }

    save_local_state(app, &state)
}

pub fn check_install_updates(app: &tauri::AppHandle) -> Result<Vec<UpdateItem>, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let state = load_local_state(app)?;

    let mut updates = Vec::new();
    for record in &state.install_records {
        let Some(resource) = library
            .resources
            .iter()
            .find(|resource| resource.id == record.resource_id)
        else {
            continue;
        };

        let path = Path::new(&record.target.path);
        let current_revision = read_revision(path)?;
        let install_status = if current_revision.is_none() {
            InstallStatus::Missing
        } else if current_revision.as_deref() != Some(record.revision.as_str()) {
            InstallStatus::Diverged
        } else if record.revision != resource.revision {
            InstallStatus::Stale
        } else {
            InstallStatus::InSync
        };

        if install_status == InstallStatus::InSync {
            continue;
        }

        updates.push(UpdateItem {
            id: record.id.clone(),
            resource_id: resource.id.clone(),
            resource_name: resource.title.clone(),
            project_id: record.target.project_id.clone(),
            project_name: library
                .project_profiles
                .iter()
                .find(|profile| Some(profile.id.as_str()) == record.target.project_id.as_deref())
                .map(|profile| profile.name.clone()),
            target_path: Some(record.target.path.clone()),
            origin: resource.origin,
            source_status: resource.source_status,
            install_status,
            current_revision,
            next_revision: Some(resource.revision.clone()),
            summary: "Installed file is out of sync with the library source.".into(),
        });
    }

    Ok(updates)
}

pub fn check_source_updates(app: &tauri::AppHandle) -> Result<Vec<UpdateItem>, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;

    let mut updates = Vec::new();
    for resource in &library.resources {
        if !matches!(
            resource.origin,
            ResourceOrigin::Vendor | ResourceOrigin::ForkedVendor
        ) {
            continue;
        }
        let Some(source_url) = resource.source_url.as_deref() else {
            continue;
        };
        let upstream_head = match git::ls_remote_head(source_url, resource.source_ref.as_deref()) {
            Ok(head) => head,
            Err(_) => continue,
        };

        if resource.upstream_revision.as_deref() == Some(upstream_head.as_str()) {
            continue;
        }

        updates.push(UpdateItem {
            id: resource.id.clone(),
            resource_id: resource.id.clone(),
            resource_name: resource.title.clone(),
            project_id: resource.project_id.clone(),
            project_name: None,
            target_path: None,
            origin: resource.origin,
            source_status: if resource.source_status == SourceStatus::MergeBlocked {
                SourceStatus::MergeBlocked
            } else {
                SourceStatus::UpstreamAvailable
            },
            install_status: InstallStatus::NotInstalled,
            current_revision: resource.upstream_revision.clone(),
            next_revision: Some(upstream_head),
            summary: "Upstream source has a newer revision available.".into(),
        });
    }

    Ok(updates)
}

pub fn preview_source_update(
    app: &tauri::AppHandle,
    resource_id: &str,
) -> Result<PreviewPlan, String> {
    let repo_root = connected_repo_root(app)?;
    let library = load_repo_library(&repo_root)?;
    let resource = library
        .resources
        .iter()
        .find(|resource| resource.id == resource_id)
        .cloned()
        .ok_or_else(|| format!("resource {} not found", resource_id))?;
    let source_url = resource
        .source_url
        .clone()
        .ok_or_else(|| "resource does not have an upstream source".to_string())?;
    let next_revision = git::ls_remote_head(&source_url, resource.source_ref.as_deref())?;

    Ok(PreviewPlan {
        kind: PreviewPlanKind::Apply,
        project_id: resource.id.clone(),
        project_path: source_url.clone(),
        summary: ProjectScanSummary {
            total_items: 1,
            tracked_conflicts: 0,
            divergent_items: 0,
        },
        items: vec![ProjectFileEntry {
            relative_path: resource
                .source_path
                .clone()
                .unwrap_or_else(|| default_source_path_for_resource(&resource)),
            absolute_path: source_url,
            status: ProjectFileStatus::Modified,
            resource_id: Some(resource.id),
            install_record_id: None,
            tracked: false,
            current_revision: resource.upstream_revision.clone(),
            expected_revision: Some(next_revision),
            note: Some("Previewing upstream source update.".into()),
        }],
    })
}

pub fn apply_source_update(
    app: &tauri::AppHandle,
    resource_id: &str,
) -> Result<UpdateItem, String> {
    let repo_root = connected_repo_root(app)?;
    let mut library = load_repo_library(&repo_root)?;
    let resource_index = library
        .resources
        .iter()
        .position(|resource| resource.id == resource_id)
        .ok_or_else(|| format!("resource {} not found", resource_id))?;
    let resource_snapshot = library.resources[resource_index].clone();
    let source_url = resource_snapshot
        .source_url
        .clone()
        .ok_or_else(|| "resource does not have an upstream source".to_string())?;
    let source_path = resource_snapshot
        .source_path
        .clone()
        .unwrap_or_else(|| default_source_path_for_resource(&resource_snapshot));

    let temp_dir = std::env::temp_dir().join(format!("skill-switch-source-{}", Uuid::new_v4()));
    git::clone_repository(
        &source_url,
        &temp_dir,
        resource_snapshot.source_ref.as_deref(),
    )?;
    let next_revision =
        git::head(&temp_dir).ok_or_else(|| "failed to read upstream HEAD".to_string())?;
    let upstream_file = temp_dir.join(&source_path);
    let upstream_content = fs::read_to_string(&upstream_file).map_err(|error| error.to_string())?;

    let source_status = SourceStatus::Current;
    if resource_snapshot.origin == ResourceOrigin::ForkedVendor {
        if let Some(base_revision) = resource_snapshot.upstream_revision.clone() {
            let base_content = git::read_file_at_revision(&temp_dir, &base_revision, &source_path)?;
            let merge_dir =
                std::env::temp_dir().join(format!("skill-switch-merge-{}", Uuid::new_v4()));
            fs::create_dir_all(&merge_dir).map_err(|error| error.to_string())?;
            let base_path = merge_dir.join("base.txt");
            let local_path = merge_dir.join("local.txt");
            let remote_path = merge_dir.join("remote.txt");
            fs::write(&base_path, base_content).map_err(|error| error.to_string())?;
            fs::write(&local_path, &resource_snapshot.content)
                .map_err(|error| error.to_string())?;
            fs::write(&remote_path, &upstream_content).map_err(|error| error.to_string())?;
            let (merged, clean) = git::merge_file(&base_path, &local_path, &remote_path)?;
            if clean {
                let resource = &mut library.resources[resource_index];
                resource.content = merged;
            } else {
                let blocked_resource = &mut library.resources[resource_index];
                blocked_resource.source_status = SourceStatus::MergeBlocked;
                let response = UpdateItem {
                    id: blocked_resource.id.clone(),
                    resource_id: blocked_resource.id.clone(),
                    resource_name: blocked_resource.title.clone(),
                    project_id: blocked_resource.project_id.clone(),
                    project_name: None,
                    target_path: None,
                    origin: blocked_resource.origin,
                    source_status: SourceStatus::MergeBlocked,
                    install_status: InstallStatus::NotInstalled,
                    current_revision: blocked_resource.upstream_revision.clone(),
                    next_revision: Some(next_revision),
                    summary: "Automatic upstream merge produced conflicts.".into(),
                };
                save_repo_library(&repo_root, &library)?;
                return Ok(response);
            }
            let _ = fs::remove_dir_all(&merge_dir);
        } else {
            let resource = &mut library.resources[resource_index];
            resource.content = upstream_content;
        }
    } else {
        let resource = &mut library.resources[resource_index];
        resource.content = upstream_content;
    }

    let response = {
        let resource = &mut library.resources[resource_index];
        resource.source_path = Some(source_path);
        resource.upstream_revision = Some(next_revision.clone());
        resource.source_status = source_status;
        resource.revision = compute_revision(&resource.content);
        resource.updated_at = now_ms();

        UpdateItem {
            id: resource.id.clone(),
            resource_id: resource.id.clone(),
            resource_name: resource.title.clone(),
            project_id: resource.project_id.clone(),
            project_name: None,
            target_path: None,
            origin: resource.origin,
            source_status,
            install_status: InstallStatus::NotInstalled,
            current_revision: resource.upstream_revision.clone(),
            next_revision: Some(next_revision.clone()),
            summary: "Library source updated from upstream.".into(),
        }
    };

    save_repo_library(&repo_root, &library)?;
    let _ = fs::remove_dir_all(&temp_dir);
    Ok(response)
}

fn resource_to_legacy_skill(resource: &Resource, library: &RepoLibrary) -> LegacySkillDto {
    let mut project_ids = library
        .project_profiles
        .iter()
        .filter(|profile| profile.attached_resource_ids.contains(&resource.id))
        .map(|profile| profile.id.clone())
        .collect::<Vec<_>>();
    if let Some(project_id) = &resource.project_id {
        if !project_ids.contains(project_id) {
            project_ids.push(project_id.clone());
        }
    }

    LegacySkillDto {
        id: resource.id.clone(),
        slug: resource.slug.clone(),
        name: resource.title.clone(),
        description: resource.description.clone(),
        content: resource.content.clone(),
        tags: resource.tags.clone(),
        project_ids,
        created_at: resource.created_at,
        updated_at: resource.updated_at,
    }
}

fn attach_resource_to_profiles(
    profiles: &mut [ProjectProfile],
    resource_id: &str,
    project_ids: &[String],
) {
    for profile in profiles {
        if project_ids.contains(&profile.id)
            && !profile
                .attached_resource_ids
                .contains(&resource_id.to_string())
        {
            profile.attached_resource_ids.push(resource_id.to_string());
        }
    }
}

fn detach_resource_from_all_profiles(profiles: &mut [ProjectProfile], resource_id: &str) {
    for profile in profiles {
        profile.attached_resource_ids.retain(|id| id != resource_id);
        if profile.agents_resource_id.as_deref() == Some(resource_id) {
            profile.agents_resource_id = None;
        }
    }
}

fn upsert_project_binding(bindings: &mut Vec<LocalProjectBinding>, project_id: &str, path: &str) {
    if let Some(binding) = bindings
        .iter_mut()
        .find(|binding| binding.project_id == project_id)
    {
        binding.path = path.to_string();
        binding.updated_at = now_ms();
    } else {
        bindings.push(LocalProjectBinding {
            project_id: project_id.to_string(),
            path: path.to_string(),
            detected_repo_root: git::git_root(Path::new(path))
                .map(|root| root.to_string_lossy().into_owned()),
            updated_at: now_ms(),
        });
    }
}

fn upsert_install_record(
    install_records: &mut Vec<InstallRecord>,
    resource: &Resource,
    target: InstallTarget,
) {
    if let Some(record) = install_records
        .iter_mut()
        .find(|record| record.target.path == target.path)
    {
        record.resource_id = resource.id.clone();
        record.target = target;
        record.revision = resource.revision.clone();
        record.status = InstallStatus::InSync;
        record.last_scanned_at = Some(now_ms());
        record.updated_at = now_ms();
    } else {
        install_records.push(InstallRecord {
            id: Uuid::new_v4().to_string(),
            resource_id: resource.id.clone(),
            target,
            revision: resource.revision.clone(),
            status: InstallStatus::InSync,
            last_scanned_at: Some(now_ms()),
            updated_at: now_ms(),
        });
    }
}

fn target_kind_for_resource(resource: &Resource) -> InstallTargetKind {
    match resource.kind {
        ResourceKind::Agents => InstallTargetKind::ProjectAgents,
        ResourceKind::Prompt => InstallTargetKind::GlobalCodexPrompt,
        ResourceKind::Skill => {
            if resource.scope == ResourceScope::Project {
                InstallTargetKind::ProjectCodexSkill
            } else {
                InstallTargetKind::GlobalCodexSkill
            }
        }
    }
}

fn write_resource_to_path(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn ensure_git_exclude(project_root: &Path) -> Result<(), String> {
    let Some(repo_root) = git::git_root(project_root) else {
        return Ok(());
    };
    let relative_root = project_root
        .strip_prefix(&repo_root)
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    let prefix = if relative_root.is_empty() {
        String::new()
    } else {
        format!("{relative_root}/")
    };
    let exclude_path = repo_root.join(".git").join("info").join("exclude");
    if let Some(parent) = exclude_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let existing = if exclude_path.exists() {
        fs::read_to_string(&exclude_path).map_err(|error| error.to_string())?
    } else {
        String::new()
    };
    let mut next = existing;
    for pattern in [format!("{prefix}AGENTS.md"), format!("{prefix}.codex/")] {
        if !next.lines().any(|line| line.trim() == pattern) {
            if !next.ends_with('\n') && !next.is_empty() {
                next.push('\n');
            }
            next.push_str(&pattern);
            next.push('\n');
        }
    }
    fs::write(exclude_path, next).map_err(|error| error.to_string())
}

fn upsert_project_resource(
    resources: &mut Vec<Resource>,
    project_id: Option<String>,
    kind: ResourceKind,
    title: &str,
    slug: &str,
    content: String,
) -> String {
    if let Some(resource) = resources.iter_mut().find(|resource| {
        resource.project_id == project_id && resource.kind == kind && resource.slug == slug
    }) {
        resource.title = title.to_string();
        resource.content = content;
        resource.revision = compute_revision(&resource.content);
        resource.updated_at = now_ms();
        return resource.id.clone();
    }

    let resource = Resource {
        id: Uuid::new_v4().to_string(),
        slug: slugify(slug),
        title: title.to_string(),
        description: None,
        kind,
        scope: ResourceScope::Project,
        origin: ResourceOrigin::Private,
        source_status: SourceStatus::LocalOnly,
        project_id,
        tags: Vec::new(),
        revision: compute_revision(&content),
        content,
        source_url: None,
        source_ref: None,
        source_path: None,
        upstream_revision: None,
        forked_from: None,
        created_at: now_ms(),
        updated_at: now_ms(),
    };
    let id = resource.id.clone();
    resources.push(resource);
    id
}

fn global_target_path(codex_home: &Path, resource: &Resource) -> PathBuf {
    match resource.kind {
        ResourceKind::Skill => codex_home
            .join("skills")
            .join(&resource.slug)
            .join("SKILL.md"),
        ResourceKind::Prompt => codex_home
            .join("prompts")
            .join(format!("{}.md", resource.slug)),
        ResourceKind::Agents => codex_home.join("AGENTS.md"),
    }
}

fn discover_local_codex_files(codex_home: &Path) -> Result<Vec<PathBuf>, String> {
    let mut items = Vec::new();
    let skills_root = codex_home.join("skills");
    if skills_root.exists() {
        for entry in fs::read_dir(&skills_root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let file = entry.path().join("SKILL.md");
            if file.exists() {
                items.push(file);
            }
        }
    }

    let prompts_root = codex_home.join("prompts");
    if prompts_root.exists() {
        for entry in fs::read_dir(&prompts_root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let file = entry.path();
            if file.extension().and_then(|extension| extension.to_str()) == Some("md") {
                items.push(file);
            }
        }
    }

    Ok(items)
}

fn remember_recent_project(recent_project_ids: &mut Vec<String>, project_id: &str) {
    recent_project_ids.retain(|id| id != project_id);
    recent_project_ids.insert(0, project_id.to_string());
    recent_project_ids.truncate(5);
}

fn default_source_path_for_resource(resource: &Resource) -> String {
    match resource.kind {
        ResourceKind::Skill => "SKILL.md".into(),
        ResourceKind::Prompt => format!("{}.md", resource.slug),
        ResourceKind::Agents => "AGENTS.md".into(),
    }
}

// ─── Backup functions ──────────────────────────────────────────────────────────

const BACKUPS_DIR: &str = "backups";
const SETTINGS_FILE: &str = "settings.json";

fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(BACKUPS_DIR))
}

fn resolved_backup_path(app: &tauri::AppHandle) -> Result<String, String> {
    backups_dir(app).map(|path| path.to_string_lossy().into_owned())
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(SETTINGS_FILE))
}

fn remove_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn backup_source_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(BACKUP_SOURCE_DIR))
}

fn backup_source_repo_dir(app: &tauri::AppHandle, repo: &str) -> Result<PathBuf, String> {
    let repo_slug = slugify(repo);
    backup_source_dir(app).map(|path| path.join(repo_slug))
}

fn backup_source_remote_url(repo: &str) -> String {
    format!("git@github.com:{repo}.git")
}

fn parse_repo_from_remote_url(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim().trim_end_matches('/');
    if let Some(repo) = trimmed.strip_prefix("git@github.com:") {
        return Some(repo.trim_end_matches(".git").to_string());
    }

    if let Some(repo) = trimmed.strip_prefix("https://github.com/") {
        let mut parts = repo.split('/');
        let owner = parts.next()?;
        let repo = parts.next()?;
        return Some(
            format!("{owner}/{repo}")
                .trim_end_matches(".git")
                .to_string(),
        );
    }

    None
}

fn normalize_backup_source(
    app: &tauri::AppHandle,
    source: &BackupSourceConfig,
) -> Result<BackupSourceConfig, String> {
    let repo = {
        let trimmed = source.repo.trim();
        if !trimmed.is_empty() {
            trimmed.trim_end_matches(".git").to_string()
        } else if let Some(repo) = parse_repo_from_remote_url(&source.remote_url) {
            repo
        } else {
            return Err("backup source repo is required".into());
        }
    };

    let label = {
        let trimmed = source.label.trim();
        if trimmed.is_empty() {
            repo.clone()
        } else {
            trimmed.to_string()
        }
    };

    let remote_url = {
        let trimmed = source.remote_url.trim();
        if trimmed.is_empty() {
            backup_source_remote_url(&repo)
        } else {
            trimmed.to_string()
        }
    };

    let branch = {
        let trimmed = source.branch.trim();
        if trimmed.is_empty() {
            "main".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let local_path = Some(
        backup_source_repo_dir(app, &repo)?
            .to_string_lossy()
            .into_owned(),
    );

    Ok(BackupSourceConfig {
        enabled: source.enabled,
        repo,
        label,
        remote_url,
        branch,
        local_path,
        last_synced_at: source.last_synced_at,
    })
}

fn source_archives_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(SOURCE_ARCHIVES_DIR))
}

fn directory_is_effectively_empty(root: &Path) -> Result<bool, String> {
    if !root.exists() {
        return Ok(true);
    }

    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name != ".git" {
            return Ok(false);
        }
    }

    Ok(true)
}

fn comparable_directory_entries(
    root: &Path,
    ignore_git: bool,
) -> Result<HashMap<String, PathBuf>, String> {
    let mut entries = HashMap::new();
    if !root.exists() {
        return Ok(entries);
    }

    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if ignore_git && name == ".git" {
            continue;
        }
        entries.insert(name, entry.path());
    }

    Ok(entries)
}

fn directories_match(left: &Path, right: &Path, ignore_git: bool) -> Result<bool, String> {
    if !left.exists() || !right.exists() {
        return Ok(false);
    }

    let left_entries = comparable_directory_entries(left, ignore_git)?;
    let right_entries = comparable_directory_entries(right, ignore_git)?;
    if left_entries.len() != right_entries.len() {
        return Ok(false);
    }

    for (name, left_path) in left_entries {
        let Some(right_path) = right_entries.get(&name) else {
            return Ok(false);
        };

        let left_meta = fs::symlink_metadata(&left_path).map_err(|error| error.to_string())?;
        let right_meta = fs::symlink_metadata(right_path).map_err(|error| error.to_string())?;
        let left_is_dir = left_meta.file_type().is_dir();
        let right_is_dir = right_meta.file_type().is_dir();

        if left_is_dir != right_is_dir {
            return Ok(false);
        }

        if left_is_dir {
            if !directories_match(&left_path, right_path, ignore_git)? {
                return Ok(false);
            }
            continue;
        }

        if fs::read(&left_path).map_err(|error| error.to_string())?
            != fs::read(right_path).map_err(|error| error.to_string())?
        {
            return Ok(false);
        }
    }

    Ok(true)
}

fn build_backup_source_notice(notices: Vec<String>) -> Option<String> {
    let joined = notices
        .into_iter()
        .map(|notice| notice.trim().to_string())
        .filter(|notice| !notice.is_empty())
        .collect::<Vec<_>>()
        .join("；");
    (!joined.is_empty()).then_some(joined)
}

fn legacy_backup_source_paths(
    app: &tauri::AppHandle,
    source: &BackupSourceConfig,
    repo: &str,
    canonical_path: &Path,
) -> Result<Vec<PathBuf>, String> {
    let mut candidates = Vec::new();
    let live_skill_sources = skill_sources_dir(app)?;

    if let Some(path) = source
        .local_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let normalized = normalize_user_path(path)?;
        if normalized != canonical_path && normalized != live_skill_sources {
            candidates.push(normalized);
        }
    }

    let legacy_path = backup_source_repo_dir(app, repo)?;
    if legacy_path != canonical_path && !candidates.contains(&legacy_path) {
        candidates.push(legacy_path);
    }

    Ok(candidates)
}

fn adopt_legacy_backup_source_repo(
    app: &tauri::AppHandle,
    source: &BackupSourceConfig,
    normalized: &BackupSourceConfig,
    canonical_path: &Path,
) -> Result<Option<String>, String> {
    for legacy_path in legacy_backup_source_paths(app, source, &normalized.repo, canonical_path)? {
        if !legacy_path.exists() || !legacy_path.is_dir() || !git::is_git_repo(&legacy_path) {
            continue;
        }

        let can_adopt = !canonical_path.exists()
            || directory_is_effectively_empty(canonical_path)?
            || directories_match(&legacy_path, canonical_path, true)?;
        if !can_adopt {
            continue;
        }

        if canonical_path.exists() {
            remove_path(canonical_path)?;
        }
        if let Some(parent) = canonical_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        fs::rename(&legacy_path, canonical_path).map_err(|error| error.to_string())?;
        return Ok(Some(
            "已将旧 backup-source 工作树收敛到 skill-sources".into(),
        ));
    }

    Ok(None)
}

fn cleanup_legacy_backup_source_paths(
    app: &tauri::AppHandle,
    source: &BackupSourceConfig,
    normalized: &BackupSourceConfig,
    canonical_path: &Path,
) -> Result<(), String> {
    for legacy_path in legacy_backup_source_paths(app, source, &normalized.repo, canonical_path)? {
        if legacy_path.exists() {
            remove_path(&legacy_path)?;
        }
    }
    Ok(())
}

fn temp_backup_source_clone_dir(app: &tauri::AppHandle, repo: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(format!(".tmp-backup-source-{}-{}", slugify(repo), now_ms())))
}

fn archive_skill_sources_dir(
    app: &tauri::AppHandle,
    root: &Path,
) -> Result<Option<PathBuf>, String> {
    if !root.exists() {
        return Ok(None);
    }

    let archive_root = source_archives_dir(app)?;
    fs::create_dir_all(&archive_root).map_err(|error| error.to_string())?;
    let archive_path = archive_root.join(format!("skill-sources-{}", now_ms()));
    fs::rename(root, &archive_path).map_err(|error| error.to_string())?;
    Ok(Some(archive_path))
}

fn ensure_backup_source_origin(path: &Path, remote_url: &str) -> Result<(), String> {
    match git::remote_url(path, "origin")? {
        Some(existing) if existing == remote_url => Ok(()),
        Some(_) => git::set_remote_url(path, "origin", remote_url),
        None => git::add_remote(path, "origin", remote_url),
    }
}

fn initialize_backup_source_repo(
    path: &Path,
    normalized: &BackupSourceConfig,
) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    if !git::is_git_repo(path) {
        git::init_repository(path)?;
    }
    ensure_backup_source_origin(path, &normalized.remote_url)?;
    git::configure_identity(path)?;
    git::checkout_branch(path, &normalized.branch)?;
    Ok(())
}

fn attach_clone_git_metadata(target: &Path, cloned_repo: &Path) -> Result<(), String> {
    let cloned_git_dir = cloned_repo.join(".git");
    let target_git_dir = target.join(".git");
    if target_git_dir.exists() {
        remove_path(&target_git_dir)?;
    }
    fs::rename(&cloned_git_dir, &target_git_dir).map_err(|error| error.to_string())?;
    remove_path(cloned_repo)?;
    Ok(())
}

fn connected_repo_root_if_available(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let mut state = load_local_state(app)?;
    ensure_local_library_repo_root(app, &mut state).map(Some)
}

fn prepare_backup_source_worktree(
    app: &tauri::AppHandle,
    raw_source: &BackupSourceConfig,
    normalized: &BackupSourceConfig,
) -> Result<Option<String>, String> {
    let worktree = PathBuf::from(
        normalized
            .local_path
            .clone()
            .ok_or_else(|| "backup source local path missing".to_string())?,
    );
    let mut notices = Vec::new();

    if worktree.exists() && !worktree.is_dir() {
        remove_path(&worktree)?;
    }

    if let Some(notice) = adopt_legacy_backup_source_repo(app, raw_source, normalized, &worktree)? {
        notices.push(notice);
    }

    if worktree.exists() && git::is_git_repo(&worktree) {
        ensure_backup_source_origin(&worktree, &normalized.remote_url)?;
        git::configure_identity(&worktree)?;
        cleanup_legacy_backup_source_paths(app, raw_source, normalized, &worktree)?;
        notices.extend(detach_backup_git_metadata_from_live_skill_sources(app)?);
        return Ok(build_backup_source_notice(notices));
    }

    let remote_has_branch = git::remote_branch_exists(&normalized.remote_url, &normalized.branch)?;
    if !worktree.exists() || directory_is_effectively_empty(&worktree)? {
        if worktree.exists() {
            remove_path(&worktree)?;
        }

        if remote_has_branch {
            git::clone_repository(&normalized.remote_url, &worktree, Some(&normalized.branch))?;
        } else {
            ensure_managed_skills_materialized(app)?;
            initialize_backup_source_repo(&worktree, normalized)?;
        }

        ensure_backup_source_origin(&worktree, &normalized.remote_url)?;
        git::configure_identity(&worktree)?;
        cleanup_legacy_backup_source_paths(app, raw_source, normalized, &worktree)?;
        notices.extend(detach_backup_git_metadata_from_live_skill_sources(app)?);
        return Ok(build_backup_source_notice(notices));
    }

    ensure_managed_skills_materialized(app)?;
    if remote_has_branch {
        let temp_clone_dir = temp_backup_source_clone_dir(app, &normalized.repo)?;
        if temp_clone_dir.exists() {
            remove_path(&temp_clone_dir)?;
        }

        git::clone_repository(
            &normalized.remote_url,
            &temp_clone_dir,
            Some(&normalized.branch),
        )?;

        if directories_match(&worktree, &temp_clone_dir, true)? {
            attach_clone_git_metadata(&worktree, &temp_clone_dir)?;
            notices.push("已把远端 Git 元数据接入备份源独立工作树".into());
        } else {
            let archived_path = archive_skill_sources_dir(app, &worktree)?
                .ok_or_else(|| "failed to archive local skill sources".to_string())?;
            fs::rename(&temp_clone_dir, &worktree).map_err(|error| error.to_string())?;
            notices.push(format!(
                "本地旧的备份源工作树已归档到 {}，当前已切换为远端工作树",
                archived_path.display()
            ));
        }
    } else {
        initialize_backup_source_repo(&worktree, normalized)?;
    }

    ensure_backup_source_origin(&worktree, &normalized.remote_url)?;
    git::configure_identity(&worktree)?;
    cleanup_legacy_backup_source_paths(app, raw_source, normalized, &worktree)?;
    notices.extend(detach_backup_git_metadata_from_live_skill_sources(app)?);
    Ok(build_backup_source_notice(notices))
}

fn backup_source_status_from_config(
    config: &BackupSourceConfig,
    notice: Option<String>,
) -> Result<BackupSourceStatus, String> {
    let local_path = config
        .local_path
        .as_ref()
        .map(|path| normalize_user_path(path))
        .transpose()?;

    let connected = local_path
        .as_ref()
        .map(|path| path.exists() && path.is_dir())
        .unwrap_or(false);
    let git_available = git::git_available();
    let is_git_repo = local_path
        .as_ref()
        .map(|path| path.is_dir() && git::is_git_repo(path))
        .unwrap_or(false);
    let head = local_path.as_ref().and_then(|path| git::head(path));
    let (ahead, behind) = local_path
        .as_ref()
        .filter(|path| path.is_dir() && git::is_git_repo(path))
        .map(|path| git::ahead_behind(path))
        .unwrap_or((0, 0));
    let dirty = local_path
        .as_ref()
        .map(|path| path.is_dir() && git::dirty(path))
        .unwrap_or(false);

    Ok(BackupSourceStatus {
        enabled: config.enabled,
        repo: config.repo.clone(),
        label: config.label.clone(),
        remote_url: config.remote_url.clone(),
        branch: config.branch.clone(),
        local_path: local_path.map(|path| path.to_string_lossy().into_owned()),
        last_synced_at: config.last_synced_at,
        connected,
        git_available,
        is_git_repo,
        head,
        ahead,
        behind,
        dirty,
        notice,
    })
}

fn backup_source_settings(app: &tauri::AppHandle) -> Result<Option<BackupSourceConfig>, String> {
    let settings = load_settings(app)?;
    settings
        .backup_source
        .as_ref()
        .map(|source| normalize_backup_source(app, source))
        .transpose()
}

fn load_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings {
            backup_path: Some(resolved_backup_path(app)?),
            backup_source: None,
            third_party_repos: crate::repo_sources::default_repos(app)?,
            ..Default::default()
        });
    }

    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut settings: AppSettings =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    if settings.third_party_repos.is_empty() {
        settings.third_party_repos = crate::repo_sources::default_repos(app)?;
    } else {
        settings.third_party_repos =
            crate::repo_sources::normalize_repo_list(app, &settings.third_party_repos)?;
    }
    settings.backup_path = Some(resolved_backup_path(app)?);
    Ok(settings)
}

fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut next_settings = settings.clone();
    next_settings.backup_path = Some(resolved_backup_path(app)?);
    next_settings.backup_source = next_settings
        .backup_source
        .as_ref()
        .map(|source| normalize_backup_source(app, source))
        .transpose()?;
    next_settings.third_party_repos =
        crate::repo_sources::normalize_repo_list(app, &next_settings.third_party_repos)?;

    let content =
        serde_json::to_string_pretty(&next_settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

// ─── Settings functions ────────────────────────────────────────────────────────

pub fn get_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let mut settings = load_settings(app)?;
    settings.backup_source = settings
        .backup_source
        .as_ref()
        .map(|source| normalize_backup_source(app, source))
        .transpose()?;
    Ok(settings)
}

pub fn apply_theme_preference(app: &tauri::AppHandle, theme: &str) {
    let theme = match theme {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };

    app.set_theme(theme);
}

pub fn set_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    save_settings(app, settings)
}

// ─── Project skill install functions ────────────────────────────────────────────

/// Install a skill to a project for specified CLI apps using symbolic links
/// Each CLI has its own directory structure:
/// - Claude Code: .claude/skills/{slug} -> {app_data}/skill-sources/{slug}/
/// - Codex CLI: .codex/skills/{slug} -> {app_data}/skill-sources/{slug}/
/// - Cursor: .cursor/skills/{slug} -> {app_data}/skill-sources/{slug}/
pub fn install_skill_to_project(
    app: &tauri::AppHandle,
    input: &InstallSkillToProjectInput,
) -> Result<InstallSkillToProjectResult, String> {
    // Get the skill
    let skill = get_legacy_skill(app, &input.skill_id)?
        .ok_or_else(|| format!("skill {} not found", input.skill_id))?;

    // Normalize project path
    let project_path = normalize_user_path(&input.project_path)?;
    if !project_path.exists() {
        return Err(format!(
            "project path does not exist: {}",
            input.project_path
        ));
    }

    let slug = &skill.slug;
    let source_dir = ensure_skill_source_for_skill(app, &skill)?;

    let mut installed_apps = Vec::new();
    let mut failed_apps = Vec::new();

    for app_id in &input.apps {
        let result = preferred_app_skill_path(&project_path, app_id, slug)
            .and_then(|link_path| create_skill_symlink(&link_path, &source_dir));

        if result.is_ok() {
            installed_apps.push(app_id.clone());
        } else {
            failed_apps.push(app_id.clone());
        }
    }

    Ok(InstallSkillToProjectResult {
        installed_apps,
        failed_apps,
    })
}

/// Uninstall a skill from a project for specified CLI apps
/// Handles both symlinks and legacy copied directories
pub fn uninstall_skill_from_project(
    app: &tauri::AppHandle,
    input: &InstallSkillToProjectInput,
) -> Result<InstallSkillToProjectResult, String> {
    // Get the skill
    let skill = get_legacy_skill(app, &input.skill_id)?
        .ok_or_else(|| format!("skill {} not found", input.skill_id))?;

    // Normalize project path
    let project_path = normalize_user_path(&input.project_path)?;
    if !project_path.exists() {
        return Err(format!(
            "project path does not exist: {}",
            input.project_path
        ));
    }

    let slug = &skill.slug;

    let mut uninstalled_apps = Vec::new();
    let mut failed_apps = Vec::new();

    for app_id in &input.apps {
        let result = app_skill_paths(&project_path, app_id, slug).and_then(|paths| {
            for path in paths {
                remove_symlink(&path)?;
            }
            Ok(())
        });

        if result.is_ok() {
            uninstalled_apps.push(app_id.clone());
        } else {
            failed_apps.push(app_id.clone());
        }
    }

    Ok(InstallSkillToProjectResult {
        installed_apps: uninstalled_apps,
        failed_apps,
    })
}

// =============================================================================
// Symlink Utilities
// =============================================================================

/// Check if a path is a symbolic link
pub fn is_symlink(path: &Path) -> bool {
    path.symlink_metadata()
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

/// Create a symbolic link from target to source (directory symlink)
/// On Unix: uses std::os::unix::fs::symlink
/// On Windows: uses std::os::windows::fs::symlink_dir (requires Developer Mode or admin)
pub fn create_skill_symlink(link_path: &Path, source_path: &Path) -> Result<(), String> {
    // Remove existing symlink or directory if it exists
    if link_path.exists() || is_symlink(link_path) {
        if is_symlink(link_path) {
            // Remove symlink
            #[cfg(unix)]
            fs::remove_file(link_path)
                .map_err(|e| format!("Failed to remove existing symlink: {}", e))?;
            #[cfg(windows)]
            fs::remove_dir(link_path)
                .map_err(|e| format!("Failed to remove existing symlink: {}", e))?;
        } else {
            // Remove directory with content
            fs::remove_dir_all(link_path)
                .map_err(|e| format!("Failed to remove existing directory: {}", e))?;
        }
    }

    // Create parent directory if it doesn't exist
    if let Some(parent) = link_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    // Create the symlink
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source_path, link_path)
            .map_err(|e| format!("Failed to create symlink: {}", e))?;
    }

    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(source_path, link_path)
            .map_err(|e| {
                if e.to_string().contains("privilege") || e.to_string().contains("1314") {
                    format!(
                        "Failed to create symlink: Windows requires Developer Mode or Administrator privileges. \
                         Enable Developer Mode in Settings > Update & Security > For developers, or run as Administrator. \
                         Error: {}", e
                    )
                } else {
                    format!("Failed to create symlink: {}", e)
                }
            })?;
    }

    Ok(())
}

/// Remove a symbolic link without affecting the source
pub fn remove_symlink(link_path: &Path) -> Result<(), String> {
    if is_symlink(link_path) {
        #[cfg(unix)]
        fs::remove_file(link_path).map_err(|e| format!("Failed to remove symlink: {}", e))?;

        #[cfg(windows)]
        fs::remove_dir(link_path).map_err(|e| format!("Failed to remove symlink: {}", e))?;

        Ok(())
    } else if link_path.exists() {
        // It's a directory, not a symlink - remove it
        fs::remove_dir_all(link_path).map_err(|e| format!("Failed to remove directory: {}", e))
    } else {
        // Doesn't exist, nothing to do
        Ok(())
    }
}

// =============================================================================
// Skill Source Directory Management
// =============================================================================

/// Get the directory where skill source files are stored
fn skill_sources_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(SKILL_SOURCES_DIR))
}

/// Get the source directory for a specific skill
fn skill_source_dir(app: &tauri::AppHandle, slug: &str) -> Result<PathBuf, String> {
    skill_sources_dir(app).map(|dir| dir.join(slug))
}

fn validate_standard_skill_directories(directories: &[String]) -> Result<Vec<String>, String> {
    let mut validated = Vec::new();
    let mut seen = HashSet::new();

    for directory in directories {
        let trimmed = directory.trim();
        let normalized = trimmed.trim_matches(|ch| ch == '/' || ch == '\\');

        if normalized.is_empty() {
            return Err("标准 Skill 目录不能为空".to_string());
        }

        if !STANDARD_SKILL_DIRECTORIES.contains(&normalized) {
            return Err(format!("不支持的标准 Skill 目录：{}", directory));
        }

        if seen.insert(normalized.to_string()) {
            validated.push(normalized.to_string());
        }
    }

    Ok(validated)
}

/// Ensure the skill source file exists in the app data directory
/// Returns the path to the skill source directory
fn ensure_skill_source(
    app: &tauri::AppHandle,
    slug: &str,
    content: &str,
) -> Result<PathBuf, String> {
    ensure_skill_source_with_directories(app, slug, content, &[])
}

fn ensure_skill_source_with_directories(
    app: &tauri::AppHandle,
    slug: &str,
    content: &str,
    directories: &[String],
) -> Result<PathBuf, String> {
    let sources_root = skill_sources_dir(app)?;
    ensure_skill_source_in_root(&sources_root, slug, content, directories)
}

fn ensure_skill_source_for_skill(
    app: &tauri::AppHandle,
    skill: &LegacySkillDto,
) -> Result<PathBuf, String> {
    ensure_skill_source(app, &skill.slug, &skill.content)
}

fn ensure_skill_source_in_root(
    root: &Path,
    slug: &str,
    content: &str,
    directories: &[String],
) -> Result<PathBuf, String> {
    let directories = validate_standard_skill_directories(directories)?;
    let source_dir = root.join(slug);
    let skill_file = source_dir.join("SKILL.md");

    fs::create_dir_all(&source_dir)
        .map_err(|e| format!("Failed to create skill source directory: {}", e))?;

    let should_write = if skill_file.exists() {
        let existing = fs::read_to_string(&skill_file).unwrap_or_default();
        existing != content
    } else {
        true
    };

    if should_write {
        fs::write(&skill_file, content)
            .map_err(|e| format!("Failed to write skill source file: {}", e))?;
    }

    for directory in directories {
        fs::create_dir_all(source_dir.join(directory))
            .map_err(|e| format!("Failed to create skill source directory: {}", e))?;
    }

    Ok(source_dir)
}

fn write_directory_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    root: &Path,
    current: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    use std::io::Write;

    for entry in fs::read_dir(current).map_err(|e| format!("读取目录失败：{}", e))? {
        let entry = entry.map_err(|e| format!("读取目录条目失败：{}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .map_err(|e| format!("计算相对路径失败：{}", e))?
            .to_string_lossy()
            .replace('\\', "/");
        let zip_path = format!(
            "{}/{}",
            root.file_name().and_then(|n| n.to_str()).unwrap_or("skill"),
            relative
        );

        if path.is_dir() {
            zip.add_directory(format!("{}/", zip_path), options)
                .map_err(|e| format!("写入 ZIP 目录失败：{}", e))?;
            write_directory_to_zip(zip, root, &path, options)?;
        } else {
            zip.start_file(&zip_path, options)
                .map_err(|e| format!("写入 ZIP 失败：{}", e))?;
            let bytes = fs::read(&path).map_err(|e| format!("读取导出文件失败：{}", e))?;
            zip.write_all(&bytes)
                .map_err(|e| format!("写入 ZIP 文件失败：{}", e))?;
        }
    }

    Ok(())
}

// =============================================================================
// Symlink Status Commands
// =============================================================================

/// Check the symlink status of a skill installation
pub fn check_symlink_status(
    app: &tauri::AppHandle,
    input: &CheckSymlinkStatusInput,
) -> Result<CheckSymlinkStatusResult, String> {
    // Get the skill
    let skill = get_legacy_skill(app, &input.skill_id)?
        .ok_or_else(|| format!("skill {} not found", input.skill_id))?;

    let slug = &skill.slug;

    // Determine base path based on scope
    let base_path = if input.scope == "project" {
        let project_path = input
            .project_path
            .as_ref()
            .ok_or("project_path is required for project scope")?;
        normalize_user_path(project_path)?
    } else {
        app.path().home_dir().map_err(|e| e.to_string())?
    };

    // Check each app's installation status
    let apps = ["claude", "codex", "cursor"];
    let mut statuses = Vec::new();

    for app_id in apps {
        let install_paths = app_skill_paths(&base_path, app_id, slug)?;
        let mut has_symlink = false;
        let mut exists = false;
        let mut is_broken = false;
        let mut target_path = None;

        for install_path in install_paths {
            let path_is_symlink = is_symlink(&install_path);
            let path_exists = install_path.exists();

            if path_is_symlink {
                has_symlink = true;
                if target_path.is_none() {
                    target_path = install_path
                        .read_link()
                        .ok()
                        .map(|p| p.to_string_lossy().to_string());
                }
            }

            if path_exists {
                exists = true;
            }
            if path_is_symlink && !path_exists {
                is_broken = true;
            }
        }

        statuses.push(SkillSymlinkStatus {
            app_id: app_id.to_string(),
            is_symlink: has_symlink,
            is_broken,
            target_path,
            exists,
        });
    }

    Ok(CheckSymlinkStatusResult {
        skill_id: input.skill_id.clone(),
        statuses,
    })
}

/// Repair broken symlinks for a skill
pub fn repair_broken_symlinks(
    app: &tauri::AppHandle,
    input: &CheckSymlinkStatusInput,
) -> Result<RepairBrokenSymlinksResult, String> {
    // Get the skill
    let skill = get_legacy_skill(app, &input.skill_id)?
        .ok_or_else(|| format!("skill {} not found", input.skill_id))?;

    let slug = &skill.slug;

    // Determine base path based on scope
    let base_path = if input.scope == "project" {
        let project_path = input
            .project_path
            .as_ref()
            .ok_or("project_path is required for project scope")?;
        normalize_user_path(project_path)?
    } else {
        app.path().home_dir().map_err(|e| e.to_string())?
    };

    let mut removed_symlinks = Vec::new();
    let mut errors = Vec::new();

    let apps = ["claude", "codex", "cursor"];

    for app_id in apps {
        for install_path in app_skill_paths(&base_path, app_id, slug)? {
            if is_symlink(&install_path) && !install_path.exists() {
                match remove_symlink(&install_path) {
                    Ok(()) => {
                        removed_symlinks.push(install_path.to_string_lossy().to_string());
                    }
                    Err(e) => {
                        errors.push(format!(
                            "Failed to remove broken symlink at {}: {}",
                            install_path.display(),
                            e
                        ));
                    }
                }
            }
        }
    }

    Ok(RepairBrokenSymlinksResult {
        removed_symlinks,
        errors,
    })
}

// =============================================================================
// Migration System
// =============================================================================

/// Result of migrating copied skills to symlinks
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated_count: usize,
    pub skipped_count: usize,
    pub errors: Vec<String>,
}

/// Migrate existing copied skills to symlinks
/// Scans all CLI directories for copied skills and converts them to symlinks
pub fn migrate_copied_skills_to_symlinks(
    app: &tauri::AppHandle,
) -> Result<MigrationResult, String> {
    // Check if migration has already been done
    let state = load_local_state(app)?;
    if state.migrated_symlinks {
        return Ok(MigrationResult {
            migrated_count: 0,
            skipped_count: 0,
            errors: Vec::new(),
        });
    }

    let home_dir = app.path().home_dir().map_err(|e| e.to_string())?;
    let sources_dir = skill_sources_dir(app)?;

    let mut migrated_count = 0;
    let mut skipped_count = 0;
    let mut errors = Vec::new();

    // Apps to check
    let apps = ["claude", "codex", "cursor"];

    for app_id in apps {
        for skills_dir in app_skill_dirs(&home_dir, app_id)? {
            if !skills_dir.exists() {
                continue;
            }

            let entries = match fs::read_dir(&skills_dir) {
                Ok(e) => e,
                Err(e) => {
                    errors.push(format!("Failed to read {} skills directory: {}", app_id, e));
                    continue;
                }
            };

            for entry in entries.flatten() {
                let skill_path = entry.path();

                if is_symlink(&skill_path) || !skill_path.is_dir() {
                    continue;
                }

                let skill_file = skill_path.join("SKILL.md");
                if !skill_file.exists() {
                    continue;
                }

                let slug = match skill_path.file_name() {
                    Some(name) => name.to_string_lossy().to_string(),
                    None => continue,
                };

                let source_dir = sources_dir.join(&slug);
                if source_dir.exists() && source_dir.join("SKILL.md").exists() {
                    match fs::remove_dir_all(&skill_path) {
                        Ok(()) => match create_skill_symlink(&skill_path, &source_dir) {
                            Ok(()) => {
                                migrated_count += 1;
                            }
                            Err(e) => {
                                errors.push(format!(
                                    "Failed to create symlink for {} in {}: {}",
                                    slug, app_id, e
                                ));
                            }
                        },
                        Err(e) => {
                            errors.push(format!(
                                "Failed to remove copied skill {} in {}: {}",
                                slug, app_id, e
                            ));
                        }
                    }
                } else {
                    skipped_count += 1;
                }
            }
        }
    }

    // Mark migration as complete
    let mut state = load_local_state(app)?;
    state.migrated_symlinks = true;
    save_local_state(app, &state)?;

    Ok(MigrationResult {
        migrated_count,
        skipped_count,
        errors,
    })
}

/// Remove CLI folders from a project directory
/// This removes the entire CLI config folders, including .codex for Codex.
pub fn remove_project_cli_folders(
    input: &RemoveProjectCliInput,
) -> Result<RemoveProjectCliResult, String> {
    let project_path = normalize_user_path(&input.project_path)?;
    if !project_path.exists() {
        return Err(format!(
            "project path does not exist: {}",
            input.project_path
        ));
    }

    let mut removed_apps = Vec::new();
    let mut failed_apps = Vec::new();

    for app_id in &input.apps {
        let cli_dirs = match app_cli_dirs(&project_path, app_id) {
            Ok(dirs) => dirs,
            Err(_) => {
                failed_apps.push(app_id.clone());
                continue;
            }
        };

        let mut failed = false;
        for cli_dir in cli_dirs {
            if !cli_dir.exists() {
                continue;
            }

            match fs::remove_dir_all(&cli_dir) {
                Ok(_) => {}
                Err(e) => {
                    println!("Failed to remove {:?}: {}", cli_dir, e);
                    failed = true;
                }
            }
        }

        if failed {
            failed_apps.push(app_id.clone());
        } else {
            removed_apps.push(app_id.clone());
        }
    }

    Ok(RemoveProjectCliResult {
        removed_apps,
        failed_apps,
    })
}

/// Sync skills from skill-sources directory to library
/// Scans skill-sources for all valid skills and ensures they exist in the library
pub fn skill_sources_to_library_sync(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(repo_root) = connected_repo_root_if_available(app)? else {
        return Ok(());
    };

    let sources_root = skill_sources_dir(app)?;
    if !sources_root.exists() {
        return Ok(());
    }

    let mut library = load_repo_library(&repo_root)?;
    let now = now_ms();
    let mut changed = false;
    let mut existing_by_slug = HashMap::new();

    for (index, resource) in library.resources.iter().enumerate() {
        if is_managed_skill_resource(resource) {
            existing_by_slug.insert(resource.slug.clone(), index);
        }
    }

    // Scan skill-sources directory
    for entry in fs::read_dir(&sources_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let slug = entry.file_name().to_string_lossy().into_owned();

        if slug.starts_with('.') || !path.is_dir() {
            continue;
        }

        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }

        let content = fs::read_to_string(&skill_file).map_err(|e| e.to_string())?;
        let revision = compute_revision(&content);
        let (name, description, tags) =
            derive_skill_source_metadata(&slug, &content, None);

        if let Some(index) = existing_by_slug.get(&slug).copied() {
            // Update existing skill
            if let Some(resource) = library.resources.get_mut(index) {
                let mut resource_changed = false;

                if resource.title != name {
                    resource.title = name;
                    resource_changed = true;
                }
                if resource.description != description {
                    resource.description = description;
                    resource_changed = true;
                }
                if resource.tags != tags {
                    resource.tags = tags;
                    resource_changed = true;
                }
                if resource.content != content {
                    resource.content = content.clone();
                    resource_changed = true;
                }
                if resource.revision != revision {
                    resource.revision = revision;
                    resource_changed = true;
                }

                if resource_changed {
                    resource.updated_at = now;
                    changed = true;
                }
            }
        } else {
            // Add new skill
            library.resources.push(Resource {
                id: Uuid::new_v4().to_string(),
                slug: slug.clone(),
                title: name,
                description,
                kind: ResourceKind::Skill,
                scope: ResourceScope::Global,
                origin: ResourceOrigin::Private,
                source_status: SourceStatus::LocalOnly,
                project_id: None,
                tags,
                content,
                revision,
                source_url: None,
                source_ref: None,
                source_path: None,
                upstream_revision: None,
                forked_from: None,
                created_at: now,
                updated_at: now,
            });
            changed = true;
        }
    }

    // Remove self-created skills whose slug no longer exists in skill-sources
    let on_disk_slugs: HashSet<String> = {
        let mut slugs = HashSet::new();
        if let Ok(entries) = fs::read_dir(&sources_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                let slug = entry.file_name().to_string_lossy().into_owned();
                if !slug.starts_with('.') && path.is_dir() && path.join("SKILL.md").exists() {
                    slugs.insert(slug);
                }
            }
        }
        slugs
    };

    let before_len = library.resources.len();
    library.resources.retain(|resource| {
        if !is_managed_skill_resource(resource) {
            return true;
        }
        // Keep third-party / remote skills — they are managed by repo-source sync
        if skill_has_remote_tag(resource) {
            return true;
        }
        // Keep skills whose slug still exists on disk
        on_disk_slugs.contains(&resource.slug)
    });
    if library.resources.len() != before_len {
        changed = true;
    }

    if changed {
        save_repo_library(&repo_root, &library)?;
    }

    Ok(())
}

// ─── Global skill install functions ─────────────────────────────────────────────

/// Install a skill globally for specified CLI apps using symbolic links
/// Each CLI has its own directory structure in the home directory:
/// - Claude Code: ~/.claude/skills/{slug} -> {app_data}/skill-sources/{slug}/
/// - Codex CLI: ~/.codex/skills/{slug} -> {app_data}/skill-sources/{slug}/
/// - Cursor: ~/.cursor/skills/{slug} -> {app_data}/skill-sources/{slug}/
pub fn install_skill_global(
    app: &tauri::AppHandle,
    input: &InstallSkillGlobalInput,
) -> Result<InstallSkillGlobalResult, String> {
    // Get the skill
    let skill = get_legacy_skill(app, &input.skill_id)?
        .ok_or_else(|| format!("skill {} not found", input.skill_id))?;

    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;

    let slug = &skill.slug;
    let source_dir = ensure_skill_source_for_skill(app, &skill)?;

    let mut installed_apps = Vec::new();
    let mut failed_apps = Vec::new();

    for app_id in &input.apps {
        let result = preferred_app_skill_path(&home_dir, app_id, slug)
            .and_then(|link_path| create_skill_symlink(&link_path, &source_dir));

        if result.is_ok() {
            installed_apps.push(app_id.clone());
        } else {
            failed_apps.push(app_id.clone());
        }
    }

    Ok(InstallSkillGlobalResult {
        installed_apps,
        failed_apps,
    })
}

/// Uninstall a skill globally for specified CLI apps
/// Handles both symlinks and legacy copied directories
pub fn uninstall_skill_global(
    app: &tauri::AppHandle,
    input: &InstallSkillGlobalInput,
) -> Result<InstallSkillGlobalResult, String> {
    // Get the skill
    let skill = get_legacy_skill(app, &input.skill_id)?
        .ok_or_else(|| format!("skill {} not found", input.skill_id))?;

    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;

    let slug = &skill.slug;

    let mut uninstalled_apps = Vec::new();
    let mut failed_apps = Vec::new();

    for app_id in &input.apps {
        let result = app_skill_paths(&home_dir, app_id, slug).and_then(|paths| {
            for path in paths {
                remove_symlink(&path)?;
            }
            Ok(())
        });

        if result.is_ok() {
            uninstalled_apps.push(app_id.clone());
        } else {
            failed_apps.push(app_id.clone());
        }
    }

    Ok(InstallSkillGlobalResult {
        installed_apps: uninstalled_apps,
        failed_apps,
    })
}

// ─── Import skill functions ────────────────────────────────────────────────────

/// Recursively copy a directory and all its contents
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败：{}", e))?;

    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败：{}", e))? {
        let entry = entry.map_err(|e| format!("读取目录条目失败：{}", e))?;
        let ty = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败：{}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("复制文件失败：{}", e))?;
        }
    }
    Ok(())
}

/// Import a skill from a folder containing SKILL.md
/// Returns the imported skill on success, or an error message
pub fn import_skill_from_folder(
    app: &tauri::AppHandle,
    folder_path: &Path,
) -> Result<LegacySkillDto, String> {
    // Check if the folder exists
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("路径不存在或不是文件夹".to_string());
    }

    // Check for SKILL.md in the folder
    let skill_md_path = folder_path.join("SKILL.md");
    if !skill_md_path.exists() {
        return Err("文件夹中未找到 SKILL.md 文件，不符合 Skill 规范".to_string());
    }

    // Read SKILL.md content
    let content =
        fs::read_to_string(&skill_md_path).map_err(|e| format!("读取 SKILL.md 失败：{}", e))?;

    // Parse skill metadata from content
    let (name, description) = parse_skill_metadata(&content);

    if name.is_empty() {
        return Err("SKILL.md 中未找到有效的技能名称".to_string());
    }

    // Generate slug first
    let slug = slugify(&name);

    // Copy the entire folder to skill-sources directory
    let target_dir = skill_source_dir(app, &slug)?;
    if target_dir.exists() {
        // Remove existing directory if it exists
        fs::remove_dir_all(&target_dir).map_err(|e| format!("清理旧目录失败：{}", e))?;
    }
    copy_dir_all(folder_path, &target_dir)?;

    // Create the skill using existing create_legacy_skill function
    let input = CreateSkillInput {
        name,
        description,
        content,
        directories: vec![],
        tags: vec!["imported".to_string()],
        project_ids: vec![],
    };

    create_legacy_skill(app, &input)
}

/// Import a skill from a zip file
/// The zip must contain a folder with SKILL.md at the root level or one level deep
pub fn import_skill_from_zip(
    app: &tauri::AppHandle,
    zip_path: &Path,
) -> Result<LegacySkillDto, String> {
    use std::io::Read;
    use zip::ZipArchive;

    // Check if the file exists
    if !zip_path.exists() {
        return Err("ZIP 文件不存在".to_string());
    }

    // Open the zip file
    let file = fs::File::open(zip_path).map_err(|e| format!("打开 ZIP 文件失败：{}", e))?;

    let mut archive = ZipArchive::new(file).map_err(|e| format!("解析 ZIP 文件失败：{}", e))?;

    // Find SKILL.md in the archive and determine the root folder
    let mut skill_md_content: Option<String> = None;
    let mut root_prefix: Option<String> = None;

    for i in 0..archive.len() {
        let mut zip_file = archive
            .by_index(i)
            .map_err(|e| format!("读取 ZIP 条目失败：{}", e))?;
        let name = zip_file.name().to_string();

        // Check if this is SKILL.md
        if name.ends_with("SKILL.md") {
            // Determine the root prefix (folder containing SKILL.md)
            if let Some(pos) = name.rfind("SKILL.md") {
                root_prefix = if pos == 0 {
                    None
                } else {
                    Some(name[..pos].to_string())
                };
            }

            // Read the content
            let mut content = String::new();
            zip_file
                .read_to_string(&mut content)
                .map_err(|e| format!("读取 SKILL.md 内容失败：{}", e))?;
            skill_md_content = Some(content);
        }
    }

    let content = skill_md_content
        .ok_or_else(|| "ZIP 包中未找到 SKILL.md 文件，不符合 Skill 规范".to_string())?;

    // Parse skill metadata from content
    let (name, description) = parse_skill_metadata(&content);

    if name.is_empty() {
        return Err("SKILL.md 中未找到有效的技能名称".to_string());
    }

    // Generate slug
    let slug = slugify(&name);

    // Extract all files to skill-sources directory
    let target_dir = skill_source_dir(app, &slug)?;
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir).map_err(|e| format!("清理旧目录失败：{}", e))?;
    }
    fs::create_dir_all(&target_dir).map_err(|e| format!("创建目录失败：{}", e))?;

    // Extract all files from the archive
    for i in 0..archive.len() {
        let mut zip_file = archive
            .by_index(i)
            .map_err(|e| format!("读取 ZIP 条目失败：{}", e))?;
        let name = zip_file.name().to_string();

        // Skip the root prefix if present
        let relative_path = if let Some(ref prefix) = root_prefix {
            if name.starts_with(prefix) {
                &name[prefix.len()..]
            } else {
                &name
            }
        } else {
            &name
        };

        if relative_path.is_empty() || relative_path == "/" {
            continue;
        }

        let target_path = target_dir.join(relative_path);

        if name.ends_with('/') {
            // It's a directory
            fs::create_dir_all(&target_path).map_err(|e| format!("创建目录失败：{}", e))?;
        } else {
            // It's a file
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{}", e))?;
            }
            let mut outfile =
                fs::File::create(&target_path).map_err(|e| format!("创建文件失败：{}", e))?;
            std::io::copy(&mut zip_file, &mut outfile)
                .map_err(|e| format!("写入文件失败：{}", e))?;
        }
    }

    // Create the skill using existing create_legacy_skill function
    let input = CreateSkillInput {
        name,
        description,
        content,
        directories: vec![],
        tags: vec!["imported".to_string()],
        project_ids: vec![],
    };

    create_legacy_skill(app, &input)
}

/// Parse skill metadata (name, description) from SKILL.md content
/// Looks for the first heading as the name, and the first paragraph as description
fn parse_skill_metadata(content: &str) -> (String, Option<String>) {
    let mut name = String::new();
    let mut description: Option<String> = None;

    let lines: Vec<&str> = content.lines().collect();
    let mut found_name = false;
    let mut desc_lines: Vec<String> = Vec::new();

    for line in lines {
        let trimmed = line.trim();

        // Skip empty lines at the beginning
        if !found_name && trimmed.is_empty() {
            continue;
        }

        // First heading becomes the name
        if !found_name && trimmed.starts_with('#') {
            name = trimmed.trim_start_matches('#').trim().to_string();
            found_name = true;
            continue;
        }

        // After finding name, collect description until we hit another heading or code block
        if found_name {
            if trimmed.starts_with('#') || trimmed.starts_with("```") {
                break;
            }
            if !trimmed.is_empty() {
                desc_lines.push(trimmed.to_string());
            } else if !desc_lines.is_empty() {
                // Stop at first empty line after description
                break;
            }
        }
    }

    if !desc_lines.is_empty() {
        description = Some(desc_lines.join(" "));
        // Truncate description if too long
        if let Some(ref desc) = description {
            if desc.len() > 200 {
                description = Some(format!("{}...", &desc[..197]));
            }
        }
    }

    (name, description)
}

/// Export a skill to a ZIP file
/// Exports the full managed source directory when available
pub fn export_skill_to_zip(
    app: &tauri::AppHandle,
    skill_id: &str,
    output_path: &Path,
) -> Result<String, String> {
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    // Get the skill
    let skill =
        get_legacy_skill(app, skill_id)?.ok_or_else(|| format!("skill {} not found", skill_id))?;

    // Ensure parent directory exists
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{}", e))?;
    }

    // Create the ZIP file
    let file = fs::File::create(output_path).map_err(|e| format!("创建 ZIP 文件失败：{}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let source_dir = ensure_skill_source_for_skill(app, &skill)?;
    write_directory_to_zip(&mut zip, &source_dir, &source_dir, options)?;

    // Finish the ZIP
    zip.finish().map_err(|e| format!("完成 ZIP 失败：{}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

// =============================================================================
// Skill Directory Browsing
// =============================================================================

/// List the contents of a skill directory
/// Returns the directory listing including files and subdirectories
pub fn list_skill_directory(
    app: &tauri::AppHandle,
    input: &crate::domain::SkillDirectoryInput,
) -> Result<crate::domain::SkillDirectoryListing, String> {
    use crate::domain::{SkillDirectoryEntry, SkillDirectoryListing, SkillEntryKind};

    // Get the skill to find its slug
    let skill = get_legacy_skill(app, &input.skill_id)?
        .ok_or_else(|| format!("skill {} not found", input.skill_id))?;

    // Ensure the managed source directory exists before browsing it
    let source_dir = ensure_skill_source_for_skill(app, &skill)?;

    // Determine the target directory
    let target_dir = if let Some(sub_path) = &input.sub_path {
        // Sanitize the sub_path to prevent directory traversal
        let sanitized = sub_path
            .trim_start_matches('/')
            .trim_start_matches('\\')
            .replace("..", "");
        let full_path = source_dir.join(&sanitized);

        if !full_path.exists() || !full_path.is_dir() {
            return Err(format!("目录不存在或不是文件夹: {}", sub_path));
        }

        full_path
    } else {
        source_dir.clone()
    };

    // Calculate relative path
    let current_path = input.sub_path.clone().unwrap_or_default();
    let parent_path = if current_path.is_empty() {
        None
    } else {
        let parts: Vec<&str> = current_path.rsplitn(2, '/').collect();
        if parts.len() > 1 {
            Some(parts[1].to_string())
        } else {
            Some(String::new())
        }
    };

    // Read directory entries
    let mut entries: Vec<SkillDirectoryEntry> = Vec::new();

    if target_dir.exists() && target_dir.is_dir() {
        for entry in fs::read_dir(&target_dir).map_err(|e| format!("读取目录失败：{}", e))? {
            let entry = entry.map_err(|e| format!("读取目录条目失败：{}", e))?;
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("?")
                .to_string();

            // Skip hidden files
            if name.starts_with('.') {
                continue;
            }

            let metadata = entry.metadata().ok();
            let is_dir = path.is_dir();
            let kind = if is_dir {
                SkillEntryKind::Directory
            } else {
                SkillEntryKind::File
            };

            let entry_path = if current_path.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", current_path, name)
            };

            let extension = if is_dir {
                None
            } else {
                path.extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_lowercase())
            };

            entries.push(SkillDirectoryEntry {
                name,
                kind,
                path: entry_path,
                extension,
                size: metadata.as_ref().map(|m| m.len()),
            });
        }

        // Sort: directories first, then files, alphabetically
        entries.sort_by(|a, b| match (&a.kind, &b.kind) {
            (SkillEntryKind::Directory, SkillEntryKind::File) => std::cmp::Ordering::Less,
            (SkillEntryKind::File, SkillEntryKind::Directory) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
    }

    Ok(SkillDirectoryListing {
        skill_id: input.skill_id.clone(),
        skill_slug: skill.slug,
        root_path: source_dir.to_string_lossy().to_string(),
        current_path,
        parent_path,
        entries,
    })
}

/// Read the content of a file in a skill directory
pub fn read_skill_file(
    app: &tauri::AppHandle,
    input: &crate::domain::SkillFileInput,
) -> Result<crate::domain::SkillFileContent, String> {
    // Get the skill to find its slug
    let skill = get_legacy_skill(app, &input.skill_id)?
        .ok_or_else(|| format!("skill {} not found", input.skill_id))?;

    // Ensure the managed source directory exists before reading files
    let source_dir = ensure_skill_source_for_skill(app, &skill)?;

    // Sanitize the file path to prevent directory traversal
    let sanitized = input
        .file_path
        .trim_start_matches('/')
        .trim_start_matches('\\')
        .replace("..", "");

    let file_path = source_dir.join(&sanitized);

    if !file_path.exists() {
        return Err(format!("文件不存在: {}", input.file_path));
    }

    if !file_path.is_file() {
        return Err(format!("路径不是文件: {}", input.file_path));
    }

    // Check file size (limit to 1MB for text files)
    let metadata = fs::metadata(&file_path).map_err(|e| format!("读取文件信息失败：{}", e))?;
    let size = metadata.len();

    if size > 1024 * 1024 {
        return Err("文件太大，超过 1MB 限制".to_string());
    }

    // Read file content
    let content = fs::read_to_string(&file_path).map_err(|e| format!("读取文件失败：{}", e))?;

    Ok(crate::domain::SkillFileContent {
        skill_id: input.skill_id.clone(),
        path: input.file_path.clone(),
        content,
        size,
    })
}

// =============================================================================
// External App Skills Scanning
// =============================================================================

/// Scan skills from an external app directory (e.g., ~/.claude/skills/)
/// Returns a list of skills found, with info about whether they're managed by SkillSwitch
pub fn scan_external_app_skills(
    app: &tauri::AppHandle,
    app_id: &str,
) -> Result<Vec<crate::domain::ExternalSkillDto>, String> {
    use crate::domain::ExternalSkillDto;

    // Get the home directory
    let home_dir = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;

    let skills_dirs = app_skill_dirs(&home_dir, app_id)?;

    // Get the SkillSwitch skill-sources directory to check symlinks
    let skill_sources = skill_sources_dir(app)?;
    let _skill_sources_str = skill_sources.to_string_lossy().to_string();

    let mut skills: Vec<ExternalSkillDto> = Vec::new();
    let mut seen_slugs = HashSet::new();

    for skills_dir in skills_dirs {
        if !skills_dir.exists() {
            continue;
        }

        let entries = fs::read_dir(&skills_dir).map_err(|e| format!("读取目录失败：{}", e))?;

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let skill_file = path.join("SKILL.md");
            if !skill_file.exists() {
                continue;
            }

            let slug = match path.file_name() {
                Some(name) => name.to_string_lossy().to_string(),
                None => continue,
            };

            if !seen_slugs.insert(slug.clone()) {
                continue;
            }

            let content = match fs::read_to_string(&skill_file) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let (name, description) = parse_skill_metadata(&content);
            if name.is_empty() {
                continue;
            }

            let metadata = fs::symlink_metadata(&path);
            let is_symlink = metadata
                .as_ref()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false);

            let symlink_target = if is_symlink {
                fs::read_link(&path)
                    .ok()
                    .map(|p| p.to_string_lossy().to_string())
            } else {
                None
            };

            skills.push(ExternalSkillDto {
                slug,
                name,
                description,
                app_id: app_id.to_string(),
                path: path.to_string_lossy().to_string(),
                is_symlink,
                symlink_target: symlink_target.clone(),
            });
        }
    }

    // Sort by name
    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(skills)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipArchive, ZipWriter};

    fn make_temp_path(name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "skill-switch-{}-{}-{}",
            name,
            std::process::id(),
            timestamp
        ))
    }

    #[test]
    fn rejects_invalid_standard_skill_directory() {
        let error = validate_standard_skill_directories(&[
            "scripts".to_string(),
            "agents".to_string(),
        ])
        .expect_err("invalid directory should fail validation");

        assert!(error.contains("agents"));
    }

    #[test]
    fn creates_selected_standard_skill_directories() {
        let root = make_temp_path("skill-source");

        let result = ensure_skill_source_in_root(
            &root,
            "demo-skill",
            "# Demo",
            &[
                "scripts".to_string(),
                "references".to_string(),
                "assets".to_string(),
            ],
        );

        assert!(result.is_ok());
        assert_eq!(
            fs::read_to_string(root.join("demo-skill").join("SKILL.md"))
                .expect("skill content should exist"),
            "# Demo"
        );
        assert!(root.join("demo-skill").join("scripts").is_dir());
        assert!(root.join("demo-skill").join("references").is_dir());
        assert!(root.join("demo-skill").join("assets").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn zip_export_helper_keeps_empty_directories() {
        let root = make_temp_path("zip-export");
        let skill_root = root.join("demo-skill");
        let zip_path = root.join("demo-skill.zip");

        fs::create_dir_all(skill_root.join("scripts")).expect("scripts directory should exist");
        fs::write(skill_root.join("SKILL.md"), "# Demo").expect("skill file should exist");

        let file = fs::File::create(&zip_path).expect("zip file should be created");
        let mut zip = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        write_directory_to_zip(&mut zip, &skill_root, &skill_root, options)
            .expect("zip helper should succeed");
        zip.finish().expect("zip should finish");

        let file = fs::File::open(&zip_path).expect("zip file should open");
        let archive = ZipArchive::new(file).expect("zip archive should open");
        let names: Vec<String> = archive.file_names().map(str::to_string).collect();

        assert!(names.contains(&"demo-skill/SKILL.md".to_string()));
        assert!(names.contains(&"demo-skill/scripts/".to_string()));

        let _ = fs::remove_dir_all(root);
    }
}
