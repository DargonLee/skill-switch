---
name: verify
description: Run full verification pipeline (lint, format check, type check, cargo clippy)
---

Run the full verification pipeline for this Tauri project:

1. **Frontend checks:**
   - `pnpm lint` — ESLint
   - `pnpm format:check` — Prettier format check
   - `pnpm exec tsc --noEmit` — TypeScript type check

2. **Backend checks:**
   - `cd src-tauri && cargo clippy --release -- -D warnings` — Rust lint (warnings as errors)
   - `cd src-tauri && cargo fmt -- --check` — Rust format check

Report results concisely. If any check fails, summarize what needs fixing.