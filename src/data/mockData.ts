// ── Mock data shared across all pages ──────────────────────────────────────

export interface SkillApp { id: string; label: string; color: string }
export const APPS: SkillApp[] = [
  { id: "claude",  label: "Claude", color: "#2563eb" },
  { id: "codex",   label: "Codex",  color: "#7c3aed" },
  { id: "cursor",  label: "Cursor", color: "#0891b2" },
];

export interface MockProject {
  name: string;
  path: string;
  apps: string[];
}

export interface MockSkill {
  id: string;
  name: string;
  description: string;
  gradient: [string, string];
  version: string;
  nextVersion?: string;
  author: string;
  updatedAt: string;
  stars: number;
  downloads: string;
  sizeKb: number;
  apps: string[];
  content: string;
  projects: MockProject[];
  changelog?: { type: "add" | "fix" | "break"; text: string }[];
}

export const MOCK_SKILLS: MockSkill[] = [
  {
    id: "gstack",
    name: "gstack",
    description: "Git workflow automation and CI/CD integration for modern development",
    gradient: ["#22c55e", "#16a34a"],
    version: "v2.1.0",
    nextVersion: "v2.2.0",
    author: "anthropics",
    updatedAt: "3 天前",
    stars: 128,
    downloads: "2.4k",
    sizeKb: 24,
    apps: ["claude", "codex"],
    content: `---\nname: gstack\ndescription: Git workflow automation\n---\n\n# Gstack - Git Workflow Skill\n\nAutomates git operations, branch management,\nand CI/CD integration.\n\n## Usage\n\n- \`/gstack commit\` - Smart commit with message\n- \`/gstack ship\`   - Deploy workflow\n- \`/gstack review\` - PR review assistant`,
    changelog: [
      { type: "add", text: "新增: 自动冲突解决功能" },
      { type: "add", text: "新增: 支持 Cursor" },
      { type: "fix", text: "修复: Windows 路径问题" },
    ],
    projects: [
      { name: "cc-switch-main", path: "~/Downloads/cc-switch-main", apps: ["claude"] },
      { name: "skillswitch", path: "~/Downloads/cc-switch-main/skillswitch", apps: ["claude", "codex"] },
    ],
  },
  {
    id: "browse",
    name: "browse",
    description: "Headless browser for QA and web automation tasks",
    gradient: ["#f97316", "#ea580c"],
    version: "v1.5.0",
    nextVersion: "v1.6.0",
    author: "anthropics",
    updatedAt: "5 天前",
    stars: 89,
    downloads: "1.2k",
    sizeKb: 18,
    apps: ["claude"],
    content: `---\nname: browse\ndescription: Headless browser for QA\n---\n\n# Browse Skill\n\n- \`/browse open <url>\` - Open a URL\n- \`/browse screenshot\` - Take a screenshot`,
    changelog: [
      { type: "add", text: "新增: 支持 Firefox" },
      { type: "fix", text: "修复: 截图尺寸问题" },
    ],
    projects: [],
  },
  {
    id: "plan-ceo-review",
    name: "plan-ceo-review",
    description: "CEO mode plan review and strategic analysis",
    gradient: ["#3b82f6", "#2563eb"],
    version: "v1.0.0",
    author: "anthropics",
    updatedAt: "2 周前",
    stars: 45,
    downloads: "890",
    sizeKb: 12,
    apps: ["claude"],
    content: `---\nname: plan-ceo-review\ndescription: CEO mode plan review\n---\n\n# Plan CEO Review\n\n- \`/plan-ceo-review\` - Start CEO review mode`,
    projects: [],
  },
  {
    id: "design-review",
    name: "design-review",
    description: "Visual design audit tool for UI/UX consistency",
    gradient: ["#ec4899", "#db2777"],
    version: "v3.0.0",
    author: "anthropics",
    updatedAt: "1 个月前",
    stars: 201,
    downloads: "3.1k",
    sizeKb: 32,
    apps: ["claude", "codex"],
    content: `---\nname: design-review\ndescription: Visual design audit tool\n---\n\n# Design Review Skill\n\n- \`/design-review\` - Start design audit`,
    projects: [],
  },
  {
    id: "ship",
    name: "ship",
    description: "Deploy workflow automation for production releases",
    gradient: ["#06b6d4", "#0891b2"],
    version: "v2.0.0",
    author: "anthropics",
    updatedAt: "3 周前",
    stars: 156,
    downloads: "2.8k",
    sizeKb: 20,
    apps: ["claude"],
    content: `---\nname: ship\ndescription: Deploy workflow automation\n---\n\n# Ship Skill\n\n- \`/ship\` - Start deployment process`,
    projects: [],
  },
  {
    id: "investigate",
    name: "investigate",
    description: "Systematic debugging assistant for complex issues",
    gradient: ["#eab308", "#ca8a04"],
    version: "v1.3.0",
    author: "anthropics",
    updatedAt: "4 天前",
    stars: 78,
    downloads: "1.5k",
    sizeKb: 21,
    apps: ["claude"],
    content: `---\nname: investigate\ndescription: Systematic debugging\n---\n\n# Investigate Skill\n\n- \`/investigate\` - Start debugging session`,
    projects: [],
  },
];
