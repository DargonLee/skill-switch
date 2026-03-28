import { tauriInvoke } from "./tauri";
import type { Result, MarketplaceFeedPage, MarketplaceFeedInput, MarketplaceSkillFeedItem, ImportMarketSkillInput, Skill } from "../types";

export const MARKET_SOURCE_ID = "built-in-market";

/** Default page size for marketplace queries */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Load marketplace feed with pagination and optional search
 */
export async function marketplaceLoadFeed(
  input: MarketplaceFeedInput = {}
): Promise<Result<MarketplaceFeedPage>> {
  return tauriInvoke("marketplace_load_feed", { input });
}

export async function skillImportFromMarket(
  input: ImportMarketSkillInput
): Promise<Result<Skill>> {
  return tauriInvoke("skill_import_from_market", { input });
}

/**
 * Parse GitHub URL like:
 * https://github.com/owner/repo/tree/branch/path/to/skill
 */
function parseGitHubTreeUrl(url: string): { owner: string; repo: string; branch: string; skillPath: string } | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    // Expected: ['owner', 'repo', 'tree', 'branch', ...pathParts]
    if (pathParts.length < 5 || pathParts[2] !== 'tree') {
      return null;
    }

    const owner = pathParts[0];
    const repo = pathParts[1];
    const branch = pathParts[3];
    const skillPath = pathParts.slice(4).join('/');

    return { owner, repo, branch, skillPath };
  } catch {
    return null;
  }
}

/**
 * Infer tags from skill name and description
 */
function inferTagsFromSkill(name: string, description: string): string[] {
  const tags: string[] = [];
  const lowerName = name.toLowerCase();
  const lowerDesc = description.toLowerCase();

  if (lowerName.includes('git') || lowerDesc.includes('git') || lowerDesc.includes('pr') || lowerDesc.includes('pull request')) {
    tags.push('git');
  }
  if (lowerName.includes('ci') || lowerDesc.includes('ci') || lowerDesc.includes('deploy')) {
    tags.push('ci');
  }
  if (lowerName.includes('debug') || lowerDesc.includes('debug') || lowerDesc.includes('investigate')) {
    tags.push('debug');
  }
  if (lowerName.includes('security') || lowerDesc.includes('security') || lowerDesc.includes('auth')) {
    tags.push('security');
  }
  if (lowerName.includes('database') || lowerDesc.includes('database') || lowerDesc.includes('sql') || lowerDesc.includes('db')) {
    tags.push('database');
  }
  if (lowerName.includes('test') || lowerDesc.includes('test')) {
    tags.push('test');
  }
  if (lowerName.includes('api') || lowerDesc.includes('api')) {
    tags.push('api');
  }
  if (tags.length === 0) {
    tags.push('ai');
  }

  return tags;
}

/**
 * Transform a marketplace skill feed item into a RemoteSkill-like structure
 * for display in RepoBrowsePage
 */
export function transformMarketItemToRemoteSkill(
  item: MarketplaceSkillFeedItem
): {
  id: string;
  repoId: string;
  repoLabel: string;
  repoUrl: string;
  name: string;
  description: string;
  content: string;
  tags: string[];
  path: string;
  rawUrl: string;
  githubUrl: string;
  branch: string;
  skillPath: string;
  stars: number;
  author: string;
} {
  // Parse the GitHub URL to extract components
  const parsed = parseGitHubTreeUrl(item.githubUrl);
  const owner = parsed?.owner ?? item.author;
  const repo = parsed?.repo ?? '';
  const branch = parsed?.branch ?? item.branch ?? 'main';
  const skillPath = parsed?.skillPath ?? '';

  // Infer tags from name and description
  const tags = inferTagsFromSkill(item.name, item.description);

  // Build raw URL for the SKILL.md file
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillPath}/${item.path}`;

  return {
    id: `${MARKET_SOURCE_ID}::${item.id}`,
    repoId: MARKET_SOURCE_ID,
    repoLabel: "技能市场",
    repoUrl: item.githubUrl,
    name: item.name,
    description: item.descriptionCn || item.description,
    content: "", // Content is not loaded until installation
    tags,
    path: skillPath,
    rawUrl,
    githubUrl: item.githubUrl,
    branch,
    skillPath,
    stars: item.stars,
    author: item.author,
  };
}