# Copilot Instructions

## Project Overview

SkillSwitch is a cross-platform Tauri 2 desktop app (React 18 + TypeScript 5 frontend, Rust backend) for managing AI coding assistant "Skills" across Claude Code, Codex CLI, Gemini CLI, Cursor, and Windsurf.

## Quick Reference

- **No test suite** is currently configured
- **No router** — page state managed via `PageId` union type in `App.tsx`
- **CSS Modules** for all component styling (`.module.css` files)
- **Design tokens** in `src/styles/variables.css` — always use CSS custom properties

## Development Commands

```bash
pnpm install                          # Install dependencies (pnpm 9, Node 20)
pnpm tauri dev                        # Full app with Tauri window
pnpm dev                              # Frontend-only (no backend)
pnpm exec tsc --noEmit                # Type check
pnpm lint                             # ESLint
pnpm format:check                     # Prettier check
cd src-tauri && cargo check           # Rust check
cd src-tauri && cargo clippy -- -D warnings  # Rust lint
cd src-tauri && cargo fmt -- --check  # Rust format check
```

## Architecture

See [CLAUDE.md](../CLAUDE.md) for full architecture details. Key points:

- **IPC**: All backend calls through `src/services/tauri.ts` → Rust-style `Result<T>`
- **Types**: `src/types/index.ts` mirrors `src-tauri/src/domain.rs` (both camelCase via Serde)
- **State**: React Context providers in `src/context/` — nesting order matters:
  `AppProvider → SettingsProvider → ToastProvider → SourceProvider → SkillProvider → ProjectProvider → UpdaterProvider`
- **Services**: `src/services/*.ts` map 1:1 to Rust commands in `src-tauri/src/commands.rs`

## Adding a New Backend Command

1. Domain types in `src-tauri/src/domain.rs` with `#[serde(rename_all = "camelCase")]`
2. Mirror types in `src/types/index.ts`
3. Command in `src-tauri/src/commands.rs` with `#[tauri::command]`
4. Register in `src-tauri/src/lib.rs` `invoke_handler!` macro
5. Service wrapper in `src/services/<domain>.ts`
6. Use from React context

## Git Backup Sync

All skill mutations (create, update, delete, import) automatically push to the configured Git backup source. The sync function is `sync_backup_source_after_mutation` in `store.rs`.

## CI/CD

- **CI** (`ci.yml`): TypeScript type check + Rust clippy on push/PR to main/develop
- **PR Check** (`pr-check.yml`): Type check + Rust format check + console.log/debugger warning
- **Release** (`release.yml`): Triggered by git tags, builds macOS/Linux/Windows
