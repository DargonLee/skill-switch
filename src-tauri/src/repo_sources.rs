use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::domain::{RemoteSkill, ThirdPartyRepo};
use crate::git;
use crate::store;

const REPO_SOURCES_DIR: &str = "repo-sources";

fn repo_sources_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join(REPO_SOURCES_DIR))
}

fn repo_local_path(app: &tauri::AppHandle, repo_id: &str) -> Result<PathBuf, String> {
    repo_sources_dir(app).map(|path| path.join(repo_id))
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

pub fn normalize_repo(
    app: &tauri::AppHandle,
    repo: &ThirdPartyRepo,
) -> Result<ThirdPartyRepo, String> {
    let local_path = match repo.local_path.as_deref() {
        Some(path) if !path.trim().is_empty() => path.to_string(),
        _ => repo_local_path(app, &repo.id)?
            .to_string_lossy()
            .into_owned(),
    };

    Ok(ThirdPartyRepo {
        id: repo.id.clone(),
        url: repo.url.clone(),
        label: repo.label.clone(),
        enabled: true,
        added_at: repo.added_at,
        local_path: Some(local_path),
        last_synced_at: repo.last_synced_at,
    })
}

pub fn default_repos(app: &tauri::AppHandle) -> Result<Vec<ThirdPartyRepo>, String> {
    let defaults = vec![
        (
            "anthropics-skills",
            "https://github.com/anthropics/skills",
            "anthropics/skills",
        ),
        (
            "composio-awesome",
            "https://github.com/ComposioHQ/awesome-claude-skills",
            "ComposioHQ/awesome-claude-skills",
        ),
        (
            "openai-skills",
            "https://github.com/openai/skills",
            "openai/skills",
        ),
    ];

    defaults
        .into_iter()
        .map(|(id, url, label)| {
            normalize_repo(
                app,
                &ThirdPartyRepo {
                    id: id.to_string(),
                    url: url.to_string(),
                    label: label.to_string(),
                    enabled: true,
                    added_at: 0,
                    local_path: None,
                    last_synced_at: None,
                },
            )
        })
        .collect()
}

pub fn normalize_repo_list(
    app: &tauri::AppHandle,
    repos: &[ThirdPartyRepo],
) -> Result<Vec<ThirdPartyRepo>, String> {
    repos.iter().map(|repo| normalize_repo(app, repo)).collect()
}

pub fn sync_repo_source(
    app: &tauri::AppHandle,
    repo: &ThirdPartyRepo,
) -> Result<ThirdPartyRepo, String> {
    let mut normalized = normalize_repo(app, repo)?;
    let local_path = PathBuf::from(
        normalized
            .local_path
            .clone()
            .ok_or_else(|| "repo local path missing".to_string())?,
    );

    if local_path.exists() {
        if git::is_git_repo(&local_path) {
            git::pull(&local_path)?;
        } else {
            remove_path(&local_path)?;
            if let Some(parent) = local_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            git::clone_repository(&normalized.url, &local_path, None)?;
        }
    } else {
        if let Some(parent) = local_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        git::clone_repository(&normalized.url, &local_path, None)?;
    }

    normalized.last_synced_at = Some(store::now_ms());
    Ok(normalized)
}

pub fn delete_repo_source(app: &tauri::AppHandle, repo: &ThirdPartyRepo) -> Result<(), String> {
    let normalized = normalize_repo(app, repo)?;
    let local_path = PathBuf::from(
        normalized
            .local_path
            .ok_or_else(|| "repo local path missing".to_string())?,
    );
    remove_path(&local_path)
}

fn parse_front_matter(content: &str) -> (Option<String>, Option<String>, Vec<String>, String) {
    let Some(rest) = content.strip_prefix("---\n") else {
        return (None, None, vec![], content.to_string());
    };

    let Some((front_matter, body)) = rest.split_once("\n---\n") else {
        return (None, None, vec![], content.to_string());
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

    (name, description, tags, body.to_string())
}

fn extract_first_paragraph(markdown: &str) -> String {
    let mut current = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        if trimmed.is_empty() {
            if !current.is_empty() {
                break;
            }
            continue;
        }
        current.push(trimmed);
    }

    current.join(" ").chars().take(150).collect()
}

fn infer_tags(name: &str) -> Vec<String> {
    let lower = name.to_lowercase();
    let mut tags = Vec::new();

    if lower.contains("git") || lower.contains("ci") || lower.contains("deploy") {
        tags.push("git".to_string());
    }
    if lower.contains("debug") || lower.contains("investigate") {
        tags.push("debug".to_string());
    }
    if lower.contains("security") || lower.contains("auth") {
        tags.push("security".to_string());
    }
    if lower.contains("db") || lower.contains("database") || lower.contains("sql") {
        tags.push("database".to_string());
    }
    if lower.contains("ai") || lower.contains("llm") || lower.contains("prompt") {
        tags.push("ai".to_string());
    }

    tags
}

fn parse_github_repo(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim().trim_end_matches('/');
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() < 2 {
        return None;
    }

    let repo = parts.last()?.to_string();
    let owner = parts.get(parts.len().saturating_sub(2))?.to_string();
    Some((owner, repo))
}

fn build_raw_url(url: &str, branch: &str, path: &str) -> String {
    if let Some((owner, repo)) = parse_github_repo(url) {
        return format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}");
    }

    url.to_string()
}

fn collect_directory_names(path: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();

    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }

    Ok(names)
}

fn detect_skill_roots(repo_root: &Path) -> Result<Vec<PathBuf>, String> {
    let skills_dir = repo_root.join("skills");
    if !skills_dir.exists() || !skills_dir.is_dir() {
        return Ok(vec![repo_root.to_path_buf()]);
    }

    let sub_dirs = collect_directory_names(&skills_dir)?;
    let hidden_dirs: Vec<String> = sub_dirs
        .iter()
        .filter(|name| name.starts_with('.') && !name.starts_with(".git"))
        .cloned()
        .collect();
    let visible_dirs: Vec<String> = sub_dirs
        .iter()
        .filter(|name| !name.starts_with('.'))
        .cloned()
        .collect();

    if !hidden_dirs.is_empty() && visible_dirs.is_empty() {
        let curated = hidden_dirs
            .iter()
            .find(|name| name.as_str() == ".curated")
            .cloned()
            .unwrap_or_else(|| hidden_dirs[0].clone());
        return Ok(vec![skills_dir.join(curated)]);
    }

    Ok(vec![skills_dir])
}

pub fn list_repo_source_skills(
    app: &tauri::AppHandle,
    repo: &ThirdPartyRepo,
) -> Result<Vec<RemoteSkill>, String> {
    let normalized = normalize_repo(app, repo)?;
    let local_path = PathBuf::from(
        normalized
            .local_path
            .clone()
            .ok_or_else(|| "repo local path missing".to_string())?,
    );

    if !local_path.exists() {
        return Err("source repo has not been synced locally yet".to_string());
    }

    if !git::is_git_repo(&local_path) {
        return Err("local source repo is missing git metadata, please sync again".to_string());
    }

    let branch = git::branch(&local_path).unwrap_or_else(|| "main".to_string());
    let skill_roots = detect_skill_roots(&local_path)?;
    let mut skills = Vec::new();

    for root in skill_roots {
        for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }

            let dir_name = entry.file_name().to_string_lossy().into_owned();
            if dir_name.starts_with(".git") {
                continue;
            }

            let skill_file = entry_path.join("SKILL.md");
            if !skill_file.exists() {
                continue;
            }

            let content = fs::read_to_string(&skill_file).map_err(|error| error.to_string())?;
            let relative_path = skill_file
                .strip_prefix(&local_path)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");

            let (front_name, front_description, front_tags, body) = parse_front_matter(&content);
            let name = front_name.unwrap_or_else(|| dir_name.clone());
            let description = front_description.unwrap_or_else(|| extract_first_paragraph(&body));
            let tags = if front_tags.is_empty() {
                infer_tags(&dir_name)
            } else {
                front_tags
            };

            skills.push(RemoteSkill {
                id: format!("{}::{}", normalized.id, dir_name),
                repo_id: normalized.id.clone(),
                repo_label: normalized.label.clone(),
                repo_url: normalized.url.clone(),
                name,
                description,
                content,
                tags,
                path: relative_path.clone(),
                raw_url: build_raw_url(&normalized.url, &branch, &relative_path),
            });
        }
    }

    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}
