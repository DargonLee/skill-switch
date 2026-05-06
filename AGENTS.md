# AGENTS.md

Guidance for AI coding agents working with this repository.

## Project Overview

**SkillSwitch** is a cross-platform Tauri 2 desktop application for managing AI coding assistant "Skills" across multiple tools: **Claude Code**, **Codex CLI**, **Gemini CLI**, **Cursor**, **Windsurf**, and **OpenCode**. It provides a unified interface to install, create, discover, backup, and sync skill/slash-command files across global and project-level scopes.

### What It Does

- **Library Management**: Browse, create, edit, delete skills and slash commands stored in a local library
- **Multi-App Installation**: Install skills as symlinks into multiple AI CLI app directories simultaneously (e.g., `~/.claude/skills/`, `~/.codex/commands/`)
- **Discovery**: Browse curated marketplace feeds, search the skills.sh registry, and explore third-party GitHub repos (anthropics/skills, openai/skills, ComposioHQ/awesome-claude-skills)
- **Git Backup**: Automatic backup sync to a user-configured Git remote repository — every mutation (create, update, delete, import) triggers a `git add → commit → push`
- **Project Profiles**: Define project profiles with attached skills; apply them to project directories via symlinks; capture changes back into the library
- **External App Scanning**: Detect skills/commands already present in AI app directories (managed or unmanaged)
- **Self-Update**: Built-in app update checking and installation via Tauri updater plugin
- **Import/Export**: Import skills from folders, ZIP files, GitHub repos (marketplace), or skills.sh registry; export to ZIP

### Supported AI Apps

| App | App ID | Accent Color | CLI Directory |
|---|---|---|---|
| Claude Code | `claude` | `#2563eb` (blue) | `.claude/` |
| Codex CLI | `codex` | `#7c3aed` (violet) | `.codex/` |
| Gemini CLI | `gemini` | — | `.gemini/` |
| Cursor | `cursor` | `#0891b2` (cyan) | `.cursor/` |
| Windsurf | `windsurf` | — | `.windsurf/` |
| OpenCode | `opencode` | `#00A3FF` (blue) | `.opencode/` or `.config/opencode/` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript 5 + Vite 6 |
| Backend | Rust (Tauri 2) |
| Styling | CSS Modules + CSS Custom Properties (design tokens) |
| Package Manager | pnpm 9 (Node 20) |
| IPC | Tauri `invoke` → Rust-style `Result<T>` |
| State Management | React Context (no Redux/Zustand) |
| Routing | None — `PageId` union type in `App.tsx` |
| Git Operations | Shell out to `git` CLI (no git2 crate) |
| Serialization | `serde` + `serde_json` with `camelCase` renaming |

---

## Development Commands

```bash
# Install dependencies (requires pnpm 9, Node 20)
pnpm install

# Start full app with Tauri window (frontend + Rust backend)
pnpm tauri dev

# Start Vite dev server only (frontend-only, no backend)
pnpm dev

# Type check (TypeScript, no build)
pnpm exec tsc --noEmit

# Lint
pnpm lint

# Format check
pnpm format:check

# Production build
pnpm tauri build

# Rust backend checks (run in src-tauri/)
cd src-tauri && cargo check
cd src-tauri && cargo clippy -- -D warnings
cd src-tauri && cargo fmt -- --check
```

**No test suite is currently configured.**

---

## Architecture

### Frontend-Backend Communication (IPC)

All frontend-backend communication uses Tauri IPC:

```
React Component → Context method → Service wrapper (src/services/*.ts) → tauriInvoke() → Rust #[tauri::command] → Business logic (store.rs, repo_sources.rs, etc.)
```

- **Core IPC wrapper**: `src/services/tauri.ts` wraps Tauri's `invoke()` and returns a Rust-style `Result<T>`: `{ ok: true, value: T }` or `{ ok: false, error: string }`
- **Service layer**: Each domain has a 1:1 mapping — one file in `src/services/` per module in the Rust backend
- **Command pattern**: All mutating commands use `run_blocking_command` to offload blocking I/O to a thread pool; read-only commands are synchronous

### Type System (Dual Mirror)

TypeScript types in `src/types/index.ts` **mirror** Rust domain types in `src-tauri/src/domain.rs`. Both use `camelCase` naming:

- Rust: `#[serde(rename_all = "camelCase")]` on structs, `#[serde(rename_all = "kebab-case")]` on most enums
- TypeScript: All types match the serialized JSON shape exactly

**When adding new types, always update BOTH files to keep them synchronized.**

### State Management

React Context providers manage all state, nested in this order (outer → inner):

```
AppProvider → SettingsProvider → ToastProvider → [BackupGate] → SourceProvider → SkillProvider → SlashCommandProvider → ProjectProvider → UpdaterProvider
```

| Context | File | State |
|---|---|---|
| `AppContext` | `src/context/AppContext.tsx` | `APP_LIST` constant (3 apps), `AppId` type. Pass-through, no mutable state |
| `SettingsContext` | `src/context/SettingsContext.tsx` | `AppSettings` (theme, locale, auto-check, backup source, third-party repos). Theme sync with Tauri window |
| `SourceContext` | `src/context/SourceContext.tsx` | Source/marketplace/registry state, `allRemoteSkills`, per-repo fetch states |
| `SkillContext` | `src/context/SkillContext.tsx` | `skills[]`, `externalSkills[]`, CRUD methods |
| `SlashCommandContext` | `src/context/SlashCommandContext.tsx` | `commands[]`, `externalCommands[]`, CRUD methods (mirrors SkillContext) |
| `ProjectContext` | `src/context/ProjectContext.tsx` | `projects[]`, CRUD methods |
| `UpdaterContext` | `src/context/UpdaterContext.tsx` | Update checking, download progress, installation |

Each context loads data on mount and provides async methods that wrap the service layer.

### Page Navigation

**No router is used.** `App.tsx` manages page state via a `PageId` union type:

```typescript
type PageId = "my-library" | "my-commands" | "repo-browse" | "create" | "settings"
```

The `AppShell` component renders the sidebar navigation. Navigation helpers:
- `navigateToRepo(repoId)` — switches to `repo-browse` with a specific repo
- `navigateToLibraryTab(tab)` — switches to `my-library` with a specific tab
- `navigateToExternalApp(appId)` — switches to `my-library` with external tab filtered by app

### Page Components

| Page | File | Purpose |
|---|---|---|
| My Library | `src/pages/MyLibraryPage.tsx` | Manage self-created & external skills |
| My Commands | `src/pages/MySlashCommandsPage.tsx` | Manage slash commands |
| Repo Browse | `src/pages/RepoBrowsePage.tsx` | Browse/discover skills from repos, marketplace, registry |
| Discover | `src/pages/DiscoverPage.tsx` | Discovery page with local, registry, and repo tabs |
| Create | `src/pages/CreatePage.tsx` | Skill/slash-command creation and editing form |
| Settings | `src/pages/SettingsPage.tsx` | App settings, backup source configuration, third-party repos |

### Backend Structure

```
src-tauri/src/
├── main.rs         # Entry point — delegates to skill_switch_lib::run()
├── lib.rs          # App setup, registers ~80 Tauri commands, startup logic
├── commands.rs     # Tauri command handlers (thin IPC boundary layer)
├── domain.rs       # Domain types with Serde serialization (~1000 lines)
├── store.rs        # Core business logic: CRUD, file I/O, symlinks, install, backup (~5800 lines)
├── git.rs          # Git operations via CLI (clone, pull, push, status, merge)
├── legacy.rs       # One-time migration from v1 (skills.json) to v2 (library.json)
├── marketplace.rs  # Marketplace feed loading + GitHub-based skill import
├── registry.rs     # Skills.sh registry search + GitHub-based installation
├── repo_sources.rs # Third-party repo source sync and skill discovery
└── updater.rs      # App self-update via tauri-plugin-updater
```

### Service Files

| Service | File | Backend Module |
|---|---|---|
| Core IPC | `src/services/tauri.ts` | — |
| Skills | `src/services/skill.ts` | `store.rs` |
| Slash Commands | `src/services/slashCommand.ts` | `store.rs` |
| Settings | `src/services/settings.ts` | `store.rs` |
| Projects | `src/services/project.ts` | `store.rs` |
| Backup Source | `src/services/backupSource.ts` | `store.rs` |
| Library Repo | `src/services/repo.ts` | `store.rs` |
| Repo Sources | `src/services/repoSource.ts` | `repo_sources.rs` |
| GitHub | `src/services/github.ts` | Pure frontend (REST API) |
| Marketplace | `src/services/marketplace.ts` | `marketplace.rs` |
| Registry | `src/services/registry.ts` | `registry.rs` |
| Resources | `src/services/resource.ts` | `store.rs` |
| Updater | `src/services/updater.ts` | `updater.rs` |

---

## Key Domain Concepts

### Resource Model

The central entity is `Resource`, which can be a skill, slash command, prompt, or agents file:

```rust
struct Resource {
    id: String,              // UUID v4
    slug: String,            // URL-safe identifier
    title: String,
    kind: ResourceKind,      // Skill | SlashCommand | Prompt | Agents
    scope: ResourceScope,    // Global | Project
    origin: ResourceOrigin,  // Private | Vendor | ForkedVendor
    source_status: SourceStatus,
    content: String,         // SKILL.md / COMMAND.md content
    revision: String,        // SHA256 of content
    upstream_revision: Option<String>,
    provenance: ProvenanceKind,  // Manual | FileImport | ExternalApp | Marketplace | RepoSource
}
```

### Symlink-Based Installation

Skills live in `{app_data}/skill-sources/{slug}/` with a `SKILL.md` file. Installation creates **symlinks** from CLI app directories to SkillSwitch source directories:

```
~/.claude/skills/my-skill  →  {app_data}/skill-sources/my-skill/
~/.codex/commands/my-cmd   →  {app_data}/command-sources/my-cmd/
```

This allows one source to be installed into multiple apps simultaneously. Cross-platform:
- Unix: `std::os::unix::fs::symlink`
- Windows: `std::os::windows::fs::symlink_dir` (requires Developer Mode)

### Revision Tracking

Content is hashed with SHA256 via `compute_revision()`. `InstallRecord` tracks the revision at install time:
- Source changed → `Stale`
- Both source and installed file diverged → `Diverged`
- Source missing → `Missing`
- Match → `InSync`

### Persistence

Two JSON files:
1. **`library.json`** (in `.skill-switch/` inside repo root): `RepoLibrary` — all resources and project profiles (synced to backup)
2. **`local-state.json`** (in app data dir): `LocalState` — machine-specific bindings, install records, migration flags (not synced)

### Git Backup Sync

Every mutation automatically pushes to the configured Git backup source:

```
sync_after_mutation() → git add -A → git commit -m "{message}" → git push
```

- Push failures are **non-fatal** — the mutation still succeeds, backup sync status becomes "pending"
- On app startup, `backup_source_startup_sync` does a fetch/pull
- The backup uses a persistent clone directory for push/pull operations

### Skill Installation Paths

| Scope | Path Pattern |
|---|---|
| Global (Claude) | `~/.claude/skills/{slug}` |
| Global (Codex) | `~/.codex/skills/{slug}` |
| Global (Cursor) | `~/.cursor/skills/{slug}` |
| Project (Claude) | `{project}/.claude/skills/{slug}` |
| Project (Codex) | `{project}/.codex/skills/{slug}` |

The backend handles path resolution and file operations. Frontend only specifies `skillId`, `projectPath`, and `apps` list.

---

## Key Patterns

### Adding a New Backend Command

1. Add domain types in `src-tauri/src/domain.rs` with `#[serde(rename_all = "camelCase")]`
2. Add corresponding TypeScript types in `src/types/index.ts`
3. Implement the command in `src-tauri/src/commands.rs` with `#[tauri::command]`
4. Register it in `src-tauri/src/lib.rs` in the `invoke_handler!` macro
5. Create a wrapper function in `src/services/<domain>.ts`
6. Use it from the appropriate React context

### Adding a New Page

1. Create component in `src/pages/`
2. Add the page ID to `PageId` type in `App.tsx`
3. Add a case in the `renderPage` switch
4. Add navigation item in `AppShell.tsx`

### Adding a New AI App

1. Add the app to `APP_LIST` in `src/context/AppContext.tsx` (id, name, accent color)
2. Add CLI directory alias in `store.rs` → `app_cli_dir_aliases()`
3. Add skills directory mapping in `registry.rs` → `get_app_skills_dir()`
4. Update install path routing in `store.rs` as needed

### Frontmatter Parsing

Multiple modules parse YAML frontmatter from `SKILL.md`/`COMMAND.md`:
- `store::parse_skill_front_matter` — name, description, tags, directories
- `repo_sources::parse_front_matter` — name, description, tags
- `registry::parse_frontmatter_name` — name only

All follow the `---\n...\n---\n` convention.

---

## Runtime Behavior

- **Startup migration**: `migrate_copied_skills_to_symlinks` runs automatically to convert any previously copied skill directories into symlinks
- **Legacy migration**: If `skills.json` (v1) exists, it's auto-migrated to `library.json` (v2) on first run
- **Backup startup sync**: If a backup source is configured, `backup_source_startup_sync` fetches/pulls on launch
- **Theme sync**: `SettingsContext` listens to Tauri window theme changes and applies `data-theme` attribute
- **Auto-update check**: `UpdaterContext` checks for updates 3s after mount if `settings.autoCheckAppUpdates` is true

---

## CI/CD

| Workflow | Trigger | What It Does |
|---|---|---|
| `ci.yml` | Push/PR to main/develop | TypeScript type check (`tsc --noEmit`) + Rust clippy |
| `pr-check.yml` | PR open/sync | TypeScript types + Rust format check + `console.log`/`debugger` warning |
| `release.yml` | Git tag (`v*.*.*`) | Build macOS (arm64 + x86_64), Linux, Windows; create GitHub release |

---

## UI Design System

### Design Tokens (`src/styles/variables.css`)

- **Colors (OKLCH)**: `--canvas`, `--surface`, `--ink`, `--accent`, `--success`, `--danger`, `--warning`
- **Typography**: `--font-display` (Manrope), `--font-body`, `--font-mono` (IBM Plex Mono)
- **Spacing**: `--space-0` through `--space-16` (0 to 4rem)
- **Radius**: `--radius-xs` (2px) through `--radius-full` (9999px)
- **Shadows**: 5 levels (`--shadow-xs` through `--shadow-xl`)
- **Animations**: `fadeIn`, `slideUp`, `slideIn`, `scaleIn`, `shimmer`
- **Transitions**: `--duration-instant` (50ms) through `--duration-slow` (320ms)
- **App brand colors**: `--app-claude: #2563eb`, `--app-codex: #7c3aed`, `--app-cursor: #0891b2`

Light/dark themes via `prefers-color-scheme` and `[data-theme="dark"]`.

**Always use CSS custom properties — never hardcode colors, spacing, or typography values.**

### Design Principles

1. **Content as Interface**: Use color blocks and spacing to separate regions instead of heavy dividers
2. **Visual Breathing**: Always provide sufficient whitespace between elements
3. **Progressive Disclosure**: Primary info prominent; secondary info subtle
4. **Action Affordance**: Interactive elements should feel tappable with clear hover states
5. **Consistent Patterns**: Same card style across all pages
6. **Editorial Restraint**: Less is more — every element must earn its place
7. **Warm Minimalism**: Neutral palette with intentional warmth, no neon or decorative effects
8. **Native Feel**: Behave like a native desktop app, not a web page

### Category Color Palette

| Category | Background | Text Color |
|---|---|---|
| Git & CI/CD | `rgba(99, 102, 241, 0.10)` | `#6366f1` |
| 调试 (Debug) | `rgba(249, 115, 22, 0.10)` | `#f97316` |
| 安全 (Security) | `rgba(239, 68, 68, 0.10)` | `#ef4444` |
| 数据库 (Database) | `rgba(34, 197, 94, 0.10)` | `#22c55e` |
| AI / LLM | `rgba(139, 92, 246, 0.10)` | `#8b5cf6` |

### Icon Color Generation

Colors are derived from item name: `palettes[name.charCodeAt(0) % palettes.length]` using 8 preset palettes (indigo, green, red, cyan, orange, pink, violet, sky).

### Styling Rules

- **CSS Modules** for all component styling (`.module.css` files)
- Use `composes` for shared styles when beneficial
- No inline styles; no Tailwind; no CSS-in-JS
- Animations should be fast (120–200ms), functional, not theatrical
- No loading spinners — use skeletons or nothing for local data
- Empty states: simple message + optional action, no illustrations

---

## Important Constraints

- **No test suite** — be extra careful with type safety and manual verification
- **Type sync is manual** — `src/types/index.ts` and `src-tauri/src/domain.rs` must be kept in sync by the developer
- **Backup sync is automatic** — every mutation triggers a git push; don't break this flow
- **Symlinks are critical** — installation/uninstallation must maintain symlink integrity
- **Cross-platform** — code must work on macOS, Linux, and Windows (especially symlink creation)
- **No router** — page state is managed via `PageId` in `App.tsx`
- **Error handling in Rust** — all functions return `Result<T, String>`, no custom error types
- **Git operations** — shell out to `git` CLI, not git2 crate; ensure `git` is available
- **Frontmatter convention** — SKILL.md uses YAML frontmatter (`---` delimited) for metadata
