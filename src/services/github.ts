/**
 * GitHub third-party repo fetcher
 *
 * Supports multiple repo layouts:
 *   Layout A (root):         <root>/<skill-name>/SKILL.md          (ComposioHQ)
 *   Layout B (subdir):       <root>/skills/<skill-name>/SKILL.md   (anthropics)
 *   Layout C (nested):       <root>/skills/.curated/<name>/SKILL.md (openai)
 *
 * Auto-detects the correct layout by probing known paths.
 */

import type { RemoteSkill, ThirdPartyRepo } from "../types";

export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

function apiContentsUrl(owner: string, repo: string, path = "") {
  const p = path ? `/${path}` : "";
  return `https://api.github.com/repos/${owner}/${repo}/contents${p}`;
}

function rawUrl(owner: string, repo: string, branch: string, path: string) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

/** Fetch the default branch name from the GitHub API */
async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return "main";
    const data = await res.json() as { default_branch?: string };
    return data.default_branch ?? "main";
  } catch {
    return "main";
  }
}

interface GithubItem {
  name: string;
  path: string;
  type: "file" | "dir";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

/**
 * Auto-detect which subdirectory contains skill folders.
 * Returns an array of "skill root" paths to scan (each is a dir containing skill subdirs).
 *
 * Priority:
 *  1. If root has a `skills/` dir → look inside for actual skill dirs
 *     a. If `skills/` contains dirs with SKILL.md → use `skills/` (anthropics layout)
 *     b. If `skills/` contains hidden dirs (e.g. `.curated`) → scan those (openai layout)
 *  2. Otherwise, scan the root itself (ComposioHQ layout)
 */
async function detectSkillRoots(
  owner: string,
  repo: string,
  _branch: string
): Promise<string[]> {
  const rootItems = await fetchJson<GithubItem[]>(apiContentsUrl(owner, repo));
  const skillsDir = rootItems.find((i) => i.type === "dir" && i.name === "skills");

  if (!skillsDir) {
    // Layout A: root contains skill dirs directly
    return [""];
  }

  // Peek inside `skills/`
  const skillsDirItems = await fetchJson<GithubItem[]>(
    apiContentsUrl(owner, repo, "skills")
  );
  const subDirs = skillsDirItems.filter((i) => i.type === "dir");

  if (subDirs.length === 0) return ["skills"];

  // Check if any subdir starts with "." (openai layout: .curated, .system, etc.)
  const hiddenDirs = subDirs.filter((d) => d.name.startsWith(".") && !d.name.startsWith(".git"));
  const visibleDirs = subDirs.filter((d) => !d.name.startsWith("."));

  if (hiddenDirs.length > 0 && visibleDirs.length === 0) {
    // openai layout: only hidden dirs → curated is the real one
    const curated = hiddenDirs.find((d) => d.name === ".curated") ?? hiddenDirs[0];
    return [`skills/${curated.name}`];
  }

  // anthropics layout: skills/ contains visible skill dirs
  return ["skills"];
}

function parseFrontMatter(content: string): {
  name?: string; description?: string; tags?: string[]; body: string;
} {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!fmMatch) return { body: content };
  const fm = fmMatch[1];
  const body = fmMatch[2];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  const tagsMatch = fm.match(/^tags:\s*\[(.+)\]$/m);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, ""))
    : [];
  return { name: nameMatch?.[1]?.trim(), description: descMatch?.[1]?.trim(), tags, body };
}

function inferTags(name: string): string[] {
  const lower = name.toLowerCase();
  const tags: string[] = [];
  if (lower.includes("git") || lower.includes("ci") || lower.includes("deploy")) tags.push("git");
  if (lower.includes("debug") || lower.includes("investigate")) tags.push("debug");
  if (lower.includes("security") || lower.includes("auth")) tags.push("security");
  if (lower.includes("db") || lower.includes("database") || lower.includes("sql")) tags.push("database");
  if (lower.includes("ai") || lower.includes("llm") || lower.includes("prompt")) tags.push("ai");
  return tags;
}

function extractFirstParagraph(markdown: string): string {
  const lines = markdown.split("\n");
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.trim() === "") {
      if (current.length > 0) { paragraphs.push(current.join(" ").trim()); current = []; }
    } else { current.push(line.trim()); }
  }
  if (current.length > 0) paragraphs.push(current.join(" ").trim());
  return paragraphs[0]?.slice(0, 150) || "";
}

const CACHE_TTL_MS = 10 * 60 * 1000;
interface CacheEntry { skills: RemoteSkill[]; fetchedAt: number; }
const memCache = new Map<string, CacheEntry>();

/** Fetch all skills from one skill-root directory */
async function fetchSkillsFromRoot(
  owner: string,
  repo: string,
  branch: string,
  skillRoot: string, // e.g. "", "skills", "skills/.curated"
  repoMeta: { id: string; label: string; url: string }
): Promise<RemoteSkill[]> {
  const items = await fetchJson<GithubItem[]>(
    apiContentsUrl(owner, repo, skillRoot)
  );
  const dirs = items.filter(
    (i) => i.type === "dir" && !i.name.startsWith(".git")
  );

  const skills: RemoteSkill[] = [];

  await Promise.allSettled(
    dirs.map(async (dir) => {
      const skillFilePath = skillRoot
        ? `${skillRoot}/${dir.name}/SKILL.md`
        : `${dir.name}/SKILL.md`;

      const skillRawUrl = rawUrl(owner, repo, branch, skillFilePath);
      const fileRes = await fetch(skillRawUrl);
      if (!fileRes.ok) return; // no SKILL.md here

      const rawContent = await fileRes.text();
      const { name, description, tags, body } = parseFrontMatter(rawContent);
      const skillName = name || dir.name;

      skills.push({
        id: `${repoMeta.id}::${dir.name}`,
        repoId: repoMeta.id,
        repoLabel: repoMeta.label,
        repoUrl: repoMeta.url,
        name: skillName,
        description: description || extractFirstParagraph(body),
        content: rawContent,
        tags: tags && tags.length > 0 ? tags : inferTags(dir.name),
        path: skillFilePath,
        rawUrl: skillRawUrl,
      });
    })
  );

  return skills;
}

/** Main export: fetch all skills from a third-party GitHub repo */
export async function fetchRepoSkills(repo: ThirdPartyRepo): Promise<RemoteSkill[]> {
  const cached = memCache.get(repo.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.skills;
  }

  const parsed = parseGitHubRepo(repo.url);
  if (!parsed) throw new Error(`Invalid GitHub URL: ${repo.url}`);
  const { owner, repo: repoName } = parsed;

  // Always fetch the real default branch first to avoid raw URL 404s
  const branch = await fetchDefaultBranch(owner, repoName);

  const skillRoots = await detectSkillRoots(owner, repoName, branch);
  const repoMeta = { id: repo.id, label: repo.label, url: repo.url };

  const nested = await Promise.all(
    skillRoots.map((root) =>
      fetchSkillsFromRoot(owner, repoName, branch, root, repoMeta).catch(() => [] as RemoteSkill[])
    )
  );

  const skills = nested.flat().sort((a, b) => a.name.localeCompare(b.name));
  memCache.set(repo.id, { skills, fetchedAt: Date.now() });
  return skills;
}

export function invalidateRepoCache(repoId: string) {
  memCache.delete(repoId);
}

export function clearRepoCache() {
  memCache.clear();
}
