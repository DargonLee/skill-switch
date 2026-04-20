# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project Overview

SkillSwitch is a cross-platform desktop app for managing AI coding assistant "Skills" across multiple tools: Claude Code, Codex CLI, Gemini CLI, Cursor, and Windsurf. It allows users to install, create, backup, and sync skill files across global and project-level scopes.

## Development Commands

```bash
# Install dependencies (requires pnpm 9, Node 20)
pnpm install

# Start dev server with Tauri window (full app)
pnpm tauri dev

# Start Vite dev server only (frontend-only, no backend)
pnpm dev

# Type check only (no build)
pnpm exec tsc --noEmit

# Production build
pnpm tauri build

# Rust backend checks (in src-tauri/)
cargo check --release
cargo clippy --release -- -D warnings
cargo fmt -- --check          # format check (used in CI)
```

**Note**: No test suite is currently configured.

## Architecture

### Frontend-Backend Communication

The app uses Tauri IPC for frontend-backend communication:

- **Frontend**: React 18 + TypeScript 5 + Vite 6
- **Backend**: Rust (Tauri 2)
- **IPC Pattern**: All backend calls go through `src/services/tauri.ts` which wraps Tauri's `invoke` and returns a Rust-style `Result<T>` type (`{ ok: true, value: T }` or `{ ok: false, error: string }`)

Each domain has a corresponding service file in `src/services/` that maps 1:1 to Rust commands in `src-tauri/src/commands.rs`.

### Type System

TypeScript types in `src/types/index.ts` mirror the Rust domain types in `src-tauri/src/domain.rs`. Both use `camelCase` naming via `#[serde(rename_all = "camelCase")]` on the Rust side. When adding new types, update both files to keep them synchronized.

### State Management

React Context providers manage all state, nested in this order (outer to inner):

```
AppProvider → SettingsProvider → ToastProvider → SourceProvider → SkillProvider → ProjectProvider → UpdaterProvider
```

- Context files live in `src/context/` (AppContext, SettingsContext, SkillContext, ProjectContext, SourceContext, UpdaterContext)
- `ToastProvider` is a component-based provider in `src/components/ui/Toast.tsx`

Each context loads data on mount and provides async methods that wrap the service layer.

### Page Navigation

No router is used. `App.tsx` manages page state via a `PageId` union type (`"my-library" | "repo-browse" | "create" | "settings"`). The `AppShell` component renders the sidebar navigation.

### Backend Structure

```
src-tauri/src/
├── lib.rs         # Registers all Tauri commands, app setup
├── main.rs        # Entry point
├── commands.rs    # Tauri command handlers (entry points)
├── domain.rs      # Domain types with Serde serialization
├── store.rs       # Data persistence, file operations, repo management
├── git.rs         # Git operations (clone, pull, push, status)
├── legacy.rs      # Migration from older data formats
├── marketplace.rs # Marketplace feed loading
├── registry.rs    # Registry search and installation
├── repo_sources.rs # Repo source sync and management
└── updater.rs     # App self-update functionality
```

### Data Loading

- **skill-sources folder**: Located in the app's data directory. On startup, the app loads skills from this folder and syncs with displayed data sources. Folder changes should be reflected in the UI at startup.
- **Startup sync**: `migrate_copied_skills_to_symlinks` runs automatically on startup to ensure consistent skill management.

## Key Patterns

### Adding a New Backend Command

1. Add the domain types in `src-tauri/src/domain.rs` with `#[serde(rename_all = "camelCase")]`
2. Add the corresponding TypeScript types in `src/types/index.ts`
3. Implement the command in `src-tauri/src/commands.rs` with `#[tauri::command]`
4. Register it in `src-tauri/src/lib.rs` in the `invoke_handler!` macro
5. Create a wrapper function in `src/services/<domain>.ts`
6. Use it from the appropriate React context

### Adding a New Page

1. Create component in `src/pages/`
2. Add the page ID to `PageId` type in `App.tsx`
3. Add a case in the `renderPage` switch
4. Add navigation item in `AppShell.tsx`

## Skill Installation Paths

Skills are installed to different paths depending on scope and target app:

- **Global**: `~/.claude/commands/`, `~/.codex/commands/`, etc.
- **Project**: `<project>/.claude/commands/`, `<project>/.codex/commands/`, etc.

The backend handles path resolution and file operations. Frontend only specifies `skillId`, `projectPath`, and `apps` list.

## Runtime Behavior

On app startup, the backend automatically runs `migrate_copied_skills_to_symlinks` to convert any previously copied skill directories into symlinks. This ensures consistent skill management across app versions.

## CI/CD

- **CI** (`ci.yml`): Runs on push/PR to main/develop. Checks TypeScript types and Rust clippy.
- **PR Check** (`pr-check.yml`): Runs on PRs to main/develop. Checks TypeScript types, Rust formatting, and warns on `console.log`/`debugger` statements in source files.
- **Release** (`release.yml`): Triggered by git tags. Builds for macOS (arm64 + x86_64), Linux, Windows.

## UI Design System

SkillSwitch follows a consistent, modern design language. Design tokens are defined in `src/styles/variables.css`.

### Key Tokens

- **Colors**: `--canvas`, `--surface`, `--ink` (text), `--accent`, `--success`, `--danger`, `--warning`
- **Typography**: `--font-display` (Manrope), `--font-body`, `--font-mono` (IBM Plex Mono)
- **Spacing**: `--space-1` through `--space-16` (0.25rem to 4rem)
- **Radius**: `--radius-sm` through `--radius-full`
- **Shadows**: `--shadow-xs` through `--shadow-xl`

Light/dark themes via `prefers-color-scheme` and `[data-theme="dark"]`.

### Card Component

The card is the primary UI element. Key characteristics:

- Soft container with subtle border and shadow (`14px` radius)
- Icon container (42x42px, 12px radius) with color derived from item name hash
- Semantic badge (top right) with category-specific pastel colors
- Floating action button (bottom right, 32px circular)

### Category Color Palette

| Category | Background | Text Color |
|----------|------------|------------|
| Git & CI/CD | `rgba(99, 102, 241, 0.10)` | `#6366f1` |
| 调试 (Debug) | `rgba(249, 115, 22, 0.10)` | `#f97316` |
| 安全 (Security) | `rgba(239, 68, 68, 0.10)` | `#ef4444` |
| 数据库 (Database) | `rgba(34, 197, 94, 0.10)` | `#22c55e` |
| AI / LLM | `rgba(139, 92, 246, 0.10)` | `#8b5cf6` |

### Icon Color Generation

Colors are derived from item name for visual consistency: `palettes[name.charCodeAt(0) % palettes.length]` using 8 preset palettes (indigo, green, red, cyan, orange, pink, violet, sky).

### Design Principles

1. **Content as Interface**: Use color blocks and spacing to separate regions instead of heavy dividers
2. **Visual Breathing**: Always provide sufficient whitespace between elements
3. **Progressive Disclosure**: Primary info (name, badge) prominent; secondary info (source, metadata) subtle
4. **Action Affordance**: Interactive elements should feel tappable with clear hover states
5. **Consistent Patterns**: Same card style across all pages (MyLibraryPage, RepoBrowsePage, DiscoverPage)