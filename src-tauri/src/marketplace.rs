use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::Manager;

use crate::domain::{
    ImportMarketSkillInput, LegacySkillDto, MarketplaceFeedInput, MarketplaceFeedPage,
    MarketplaceSkillFeedItem,
};

/// Cached marketplace data
static MARKETPLACE_CACHE: OnceLock<Vec<MarketplaceSkillFeedItem>> = OnceLock::new();

/// Load the marketplace data from file (cached)
fn load_marketplace_data(
    app: &tauri::AppHandle,
) -> Result<&'static Vec<MarketplaceSkillFeedItem>, String> {
    if let Some(cached) = MARKETPLACE_CACHE.get() {
        return Ok(cached);
    }

    // Try multiple paths to find the marketplace.json
    let paths_to_try = vec![
        // Development: try the public directory relative to the project
        {
            let manifest_dir =
                std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(manifest_dir)
                .parent()
                .map(|p| p.join("public").join("data").join("marketplace.json"))
        },
        // Production: try the resource directory
        app.path()
            .resource_dir()
            .ok()
            .map(|resource_path| resource_path.join("data").join("marketplace.json")),
        // Fallback: try app data directory
        app.path()
            .app_data_dir()
            .ok()
            .map(|app_data| app_data.join("data").join("marketplace.json")),
    ];

    for path in paths_to_try.into_iter().flatten() {
        if path.exists() {
            let content = fs::read_to_string(&path).map_err(|e| {
                format!(
                    "Failed to read marketplace feed at {}: {}",
                    path.display(),
                    e
                )
            })?;

            let items: Vec<MarketplaceSkillFeedItem> = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse marketplace feed: {}", e))?;

            // Filter out deleted items and sort by stars
            let mut filtered: Vec<MarketplaceSkillFeedItem> = items
                .into_iter()
                .filter(|item| !item.deleted.unwrap_or(false))
                .collect();
            filtered.sort_by(|a, b| b.stars.cmp(&a.stars));

            // Cache the result
            let _ = MARKETPLACE_CACHE.set(filtered);
            return Ok(MARKETPLACE_CACHE.get().unwrap());
        }
    }

    Err(
        "Marketplace feed not found. Please ensure public/data/marketplace.json exists."
            .to_string(),
    )
}

/// Load marketplace feed with pagination and optional search
pub fn load_marketplace_feed(
    app: &tauri::AppHandle,
    input: MarketplaceFeedInput,
) -> Result<MarketplaceFeedPage, String> {
    let all_items = load_marketplace_data(app)?;

    let page = input.page.unwrap_or(1).max(1);
    let page_size = input.page_size.unwrap_or(50).clamp(10, 100);

    // Filter by search query if provided
    let filtered_items: Vec<&MarketplaceSkillFeedItem> = if let Some(ref search) = input.search {
        let search_lower = search.to_lowercase();
        all_items
            .iter()
            .filter(|item| {
                item.name.to_lowercase().contains(&search_lower)
                    || item.description.to_lowercase().contains(&search_lower)
                    || item.author.to_lowercase().contains(&search_lower)
                    || item
                        .description_cn
                        .as_ref()
                        .is_some_and(|d| d.to_lowercase().contains(&search_lower))
            })
            .collect()
    } else {
        all_items.iter().collect()
    };

    let total = filtered_items.len();
    let total_pages = total.div_ceil(page_size);
    let start = (page - 1) * page_size;

    let page_items: Vec<MarketplaceSkillFeedItem> = filtered_items
        .into_iter()
        .skip(start)
        .take(page_size)
        .cloned()
        .collect();

    Ok(MarketplaceFeedPage {
        items: page_items,
        total,
        page,
        page_size,
        total_pages,
    })
}

/// Parse GitHub tree URL to extract owner, repo, branch, and path
/// Example: https://github.com/owner/repo/tree/branch/path/to/skill
fn parse_github_tree_url(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let url = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))?;

    let parts: Vec<&str> = url.split('/').collect();
    if parts.len() < 2 {
        return None;
    }

    let owner = parts.first()?.to_string();
    let repo = parts.get(1)?.to_string();

    Some((owner, repo))
}

/// Download a skill directory from GitHub and import it into the skill library
pub fn import_skill_from_market(
    app: &tauri::AppHandle,
    input: &ImportMarketSkillInput,
) -> Result<LegacySkillDto, String> {
    // Parse owner and repo from githubUrl
    let (owner, repo) = parse_github_tree_url(&input.github_url)
        .ok_or_else(|| format!("Invalid GitHub URL: {}", input.github_url))?;

    // Build the GitHub API URL to get the tree
    // skillPath is the directory containing the skill, e.g., ".claude/skills/create-pr"
    let tree_url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}:{}?recursive=1",
        owner, repo, input.branch, input.skill_path
    );

    // Create reqwest client with proper headers
    let client = reqwest::blocking::Client::builder()
        .user_agent("SkillSwitch/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Fetch the tree from GitHub API
    let response = client
        .get(&tree_url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .map_err(|e| format!("Failed to fetch GitHub tree: {}", e))?;

    let tree_response: serde_json::Value = response
        .json()
        .map_err(|e| format!("Failed to parse GitHub tree response: {}", e))?;

    let tree = tree_response
        .get("tree")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "No tree found in GitHub response".to_string())?;

    // Create a temporary directory to download the skill
    let temp_dir = std::env::temp_dir().join(format!(
        "skill-switch-market-{}",
        chrono::Utc::now().timestamp_millis()
    ));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // Track if we found a SKILL.md file
    let mut found_skill_md = false;

    // Download all files in the skill directory
    for item in tree {
        let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let item_path = item.get("path").and_then(|v| v.as_str()).unwrap_or("");

        if item_type != "blob" {
            continue;
        }

        // The item_path is relative to the repo root, but we only want files within skill_path
        // Extract the relative path within the skill directory
        let relative_path = item_path
            .strip_prefix(&input.skill_path)
            .unwrap_or(item_path);
        if relative_path.is_empty() || relative_path.starts_with('/') {
            continue;
        }

        // Get the raw URL for downloading
        let raw_url = format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}",
            owner, repo, input.branch, item_path
        );

        // Download the file
        let file_response = client
            .get(&raw_url)
            .send()
            .map_err(|e| format!("Failed to download file {}: {}", item_path, e))?;

        let file_content = file_response
            .text()
            .map_err(|e| format!("Failed to read file content: {}", e))?;

        // Check if this is SKILL.md
        let relative_path_buf = PathBuf::from(relative_path);
        let file_name = relative_path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        if file_name == "SKILL.md" {
            found_skill_md = true;
        }

        // Create the directory structure and save the file
        let local_path = temp_dir.join(relative_path);
        if let Some(parent) = local_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        fs::write(&local_path, file_content).map_err(|e| format!("Failed to write file: {}", e))?;
    }

    if !found_skill_md {
        // Clean up temp directory
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("No SKILL.md found in the skill directory".to_string());
    }

    // Import the skill from the temp directory
    let result = crate::store::import_skill_from_folder(app, &temp_dir);

    // Clean up temp directory
    let _ = fs::remove_dir_all(&temp_dir);

    // Update provenance to Marketplace
    let mut skill = result?;
    skill.provenance = crate::domain::Provenance {
        kind: crate::domain::ProvenanceKind::Marketplace,
        label: "市场安装".to_string(),
        source_url: Some(input.github_url.clone()),
        source_name: Some(input.skill_name.clone()),
        source_path: Some(input.skill_path.clone()),
        ..Default::default()
    };

    // Persist provenance in library
    if let Ok(repo_root) = crate::store::connected_repo_root(app) {
        if let Ok(mut library) = crate::store::load_repo_library(&repo_root) {
            if let Some(resource) = library.resources.iter_mut().find(|r| r.id == skill.id) {
                resource.provenance = skill.provenance.clone();
            }
            let _ = crate::store::save_repo_library(&repo_root, &library);
        }
    }

    Ok(skill)
}
