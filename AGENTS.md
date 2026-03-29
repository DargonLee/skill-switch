# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

SkillSwitch is a cross-platform desktop app for managing AI coding assistant "Skills" across multiple tools: Codex, Codex CLI, Gemini CLI, Cursor, and Windsurf. It allows users to install, create, backup, and sync skill files across global and project-level scopes.

## Development Commands

```bash
# Install dependencies
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

React Context providers in `src/context/` manage all state:

- `AppContext` - Global app state, current app selection (Codex/Codex/Gemini/etc.)
- `SkillContext` - Skill CRUD operations
- `ProjectContext` - Project management
- `SourceContext` - Repo source management (sync, updates)
- `SettingsContext` - User preferences
- `UpdaterContext` - App update checking and installation

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

- **Global**: `~/.Codex/commands/`, `~/.codex/commands/`, etc.
- **Project**: `<project>/.Codex/commands/`, `<project>/.codex/commands/`, etc.

The backend handles path resolution and file operations. Frontend only specifies `skillId`, `projectPath`, and `apps` list.

## Runtime Behavior

On app startup, the backend automatically runs `migrate_copied_skills_to_symlinks` to convert any previously copied skill directories into symlinks. This ensures consistent skill management across app versions.

## CI/CD

- **CI** (`ci.yml`): Runs on push/PR to main/develop. Checks TypeScript types and Rust clippy.
- **PR Check** (`pr-check.yml`): Runs on PRs to main/develop. Checks TypeScript types and Rust formatting.
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