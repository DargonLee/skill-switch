use reqwest::blocking::Client;
use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::domain::{
    RegistryInstallInput, RegistryInstallResult, RegistrySearchResult, RegistrySkillContent,
};

const SKILLS_SH_API: &str = "https://skills.sh/api";
const GITHUB_API: &str = "https://api.github.com";
const USER_AGENT: &str = "SkillSwitch/1.0";

/// Search skills from skills.sh registry
pub fn search_registry(query: &str, limit: u32) -> Result<RegistrySearchResult, String> {
    if query.len() < 2 {
        return Ok(RegistrySearchResult {
            skills: vec![],
            count: 0,
        });
    }

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let url = format!(
        "{}/search?q={}&limit={}",
        SKILLS_SH_API,
        urlencoding::encode(query),
        limit
    );

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Search request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Search failed with status: {}", response.status()));
    }

    response
        .json::<RegistrySearchResult>()
        .map_err(|e| format!("Failed to parse search result: {}", e))
}

/// Fetch SKILL.md content from a registry skill
pub fn fetch_registry_content(
    source: &str,
    skill_id: &str,
) -> Result<RegistrySkillContent, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // 1. Get default branch from GitHub API
    let branch = get_default_branch(&client, source)?;

    // 2. Get file tree to find SKILL.md paths
    let skill_paths = get_skill_paths(&client, source, &branch)?;

    // 3. Download SKILL.md and match by frontmatter name
    for path in skill_paths {
        let raw_url = format!(
            "https://raw.githubusercontent.com/{}/{}/{}",
            source, branch, path
        );

        if let Ok(response) = client.get(&raw_url).send() {
            if response.status().is_success() {
                if let Ok(content) = response.text() {
                    // Check frontmatter name matches
                    if let Some(frontmatter_name) = parse_frontmatter_name(&content) {
                        if frontmatter_name == skill_id
                            || frontmatter_name == sanitize_skill_name(skill_id)
                        {
                            let skill_path =
                                path.strip_suffix("SKILL.md").unwrap_or(&path).to_string();
                            return Ok(RegistrySkillContent {
                                content,
                                branch,
                                skill_path,
                            });
                        }
                    }
                }
            }
        }
    }

    Err("Skill content not found in repository".to_string())
}

/// Install a registry skill to specified apps
pub fn install_registry_skill(
    input: &RegistryInstallInput,
) -> Result<RegistryInstallResult, String> {
    let sanitized = sanitize_skill_name(&input.skill_name);

    if sanitized.is_empty() {
        return Err("Invalid skill name".to_string());
    }

    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;

    // Canonical location — matches the official skills CLI behavior
    let canonical_dir = home.join(".agents").join("skills").join(&sanitized);
    let canonical_file = canonical_dir.join("SKILL.md");
    let canonical_exists = canonical_file.exists();

    // Write real file to canonical location if not already there
    if !canonical_exists {
        fs::create_dir_all(&canonical_dir)
            .map_err(|e| format!("Failed to create skill directory: {}", e))?;
        fs::write(&canonical_file, &input.content)
            .map_err(|e| format!("Failed to write skill file: {}", e))?;
    }

    // Symlink from each agent's skills dir to the canonical location
    let mut installed_apps = Vec::new();
    let mut failed_apps = Vec::new();

    for app in &input.apps {
        let app_skills_dir = get_app_skills_dir(&home, app);
        let agent_dir = app_skills_dir.join(&sanitized);

        // Skip if already installed (real file or symlink)
        if agent_dir.exists() {
            installed_apps.push(app.clone());
            continue;
        }

        // Create parent dir if needed
        if let Err(e) = fs::create_dir_all(&app_skills_dir) {
            failed_apps.push(format!("{}: {}", app, e));
            continue;
        }

        // Create symlink to canonical dir
        #[cfg(unix)]
        {
            if let Err(e) = std::os::unix::fs::symlink(&canonical_dir, &agent_dir) {
                failed_apps.push(format!("{}: {}", app, e));
                continue;
            }
        }
        #[cfg(windows)]
        {
            if let Err(e) = std::os::windows::fs::symlink_dir(&canonical_dir, &agent_dir) {
                failed_apps.push(format!("{}: {}", app, e));
                continue;
            }
        }

        installed_apps.push(app.clone());
    }

    if installed_apps.is_empty() && canonical_exists {
        return Err("Skill is already installed for all selected agents".to_string());
    }

    Ok(RegistryInstallResult {
        installed_apps,
        failed_apps,
    })
}

// ─── Helper functions ──────────────────────────────────────────────────────────

fn get_default_branch(client: &Client, source: &str) -> Result<String, String> {
    let url = format!("{}/repos/{}", GITHUB_API, source);

    #[derive(Deserialize)]
    struct RepoResponse {
        default_branch: String,
    }

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to fetch repo info: {}", e))?;

    if !response.status().is_success() {
        // Fall back to "main" if we can't determine default branch
        return Ok("main".to_string());
    }

    let repo: RepoResponse = response
        .json()
        .map_err(|e| format!("Failed to parse repo response: {}", e))?;

    Ok(repo.default_branch)
}

fn get_skill_paths(client: &Client, source: &str, branch: &str) -> Result<Vec<String>, String> {
    let url = format!(
        "{}/repos/{}/git/trees/{}?recursive=1",
        GITHUB_API, source, branch
    );

    #[derive(Deserialize)]
    struct TreeEntry {
        path: String,
        #[serde(rename = "type")]
        entry_type: String,
    }

    #[derive(Deserialize)]
    struct TreeResponse {
        tree: Vec<TreeEntry>,
    }

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to fetch repo tree: {}", e))?;

    if response.status() == 403 {
        return Err("GitHub API rate limit reached — try again in a few minutes".to_string());
    }

    if !response.status().is_success() {
        return Err(format!("Failed to fetch repo tree: {}", response.status()));
    }

    let tree: TreeResponse = response
        .json()
        .map_err(|e| format!("Failed to parse tree response: {}", e))?;

    let skill_paths: Vec<String> = tree
        .tree
        .into_iter()
        .filter(|e| e.entry_type == "blob" && e.path.ends_with("SKILL.md"))
        .map(|e| e.path)
        .collect();

    Ok(skill_paths)
}

fn parse_frontmatter_name(content: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();

    if lines.first()?.trim() != "---" {
        return None;
    }

    for line in lines.iter().skip(1) {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if trimmed.starts_with("name:") {
            return Some(
                trimmed
                    .strip_prefix("name:")?
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            );
        }
    }

    None
}

fn sanitize_skill_name(name: &str) -> String {
    name.to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '.' || *c == '_')
        .collect::<String>()
        .trim_matches(|c| c == '.' || c == '-')
        .to_string()
}

fn get_app_skills_dir(home: &Path, app: &str) -> std::path::PathBuf {
    match app {
        "claude" => home.join(".claude").join("skills"),
        "codex" => home.join(".codex").join("skills"),
        "cursor" => home.join(".cursor").join("skills"),
        "windsurf" => home.join(".windsurf").join("skills"),
        "aider" => home.join(".aider").join("skills"),
        "opencode" => home.join(".agents").join("skills"),
        _ => home.join(format!(".{}", app)).join("skills"),
    }
}
