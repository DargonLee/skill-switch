#!/bin/bash
# release.sh - 自动发版脚本
# 用法: ./scripts/release.sh <version>
# 示例: ./scripts/release.sh 0.2.0
#
# 功能：自动更新版本号、提交、打标签、推送

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── 参数校验 ───────────────────────────────────────────────────────────

if [ -z "$1" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

NEW_VERSION="$1"

# 验证版本号格式
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Invalid version format. Expected: X.Y.Z (e.g., 0.2.0)"
  exit 1
fi

# ── 获取当前版本 ─────────────────────────────────────────────────────────

CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  SkillSwitch Release Script             │"
echo "├─────────────────────────────────────────┤"
printf "│  Current: %-28s │\n" "v$CURRENT_VERSION"
printf "│  New:     %-28s │\n" "v$NEW_VERSION"
echo "└─────────────────────────────────────────┘"
echo ""

# ── 确认 ────────────────────────────────────────────────────────────────

read -p "Release v$NEW_VERSION? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── 检查工作区状态 ───────────────────────────────────────────────────────

if ! git diff --quiet; then
  echo ""
  echo "Warning: You have uncommitted changes:"
  git status --short
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── 1. 更新版本号 ────────────────────────────────────────────────────────

echo ""
echo "→ Step 1/5: Updating version numbers..."

# package.json
sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION\"/" package.json

# src-tauri/tauri.conf.json
sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json

# src-tauri/Cargo.toml
sed -i '' "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml

# src/pages/SettingsPage.tsx
sed -i '' "s/SkillSwitch v[0-9]*\.[0-9]*\.[0-9]*/SkillSwitch v$NEW_VERSION/" src/pages/SettingsPage.tsx

echo "  ✓ package.json"
echo "  ✓ src-tauri/tauri.conf.json"
echo "  ✓ src-tauri/Cargo.toml"
echo "  ✓ src/pages/SettingsPage.tsx"

# ── 2. 更新 Cargo.lock ───────────────────────────────────────────────────

echo ""
echo "→ Step 2/5: Updating Cargo.lock..."
cd src-tauri && cargo update -p skill-switch --precise "$NEW_VERSION" 2>/dev/null || true
cd ..

# ── 3. Git 提交 ───────────────────────────────────────────────────────────

echo ""
echo "→ Step 3/5: Committing changes..."
git add -A
git commit -m "chore: bump version to $NEW_VERSION"

# ── 4. 打标签 ─────────────────────────────────────────────────────────────

echo ""
echo "→ Step 4/5: Creating tag v$NEW_VERSION..."
git tag "v$NEW_VERSION"

# ── 5. 推送 ───────────────────────────────────────────────────────────────

echo ""
echo "→ Step 5/5: Pushing to remote..."
git push
git push --tags

# ── 完成 ──────────────────────────────────────────────────────────────────

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  ✓ Release v$NEW_VERSION published!      │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "GitHub Actions will build and release automatically."
echo "Check: https://github.com/YOUR_USERNAME/skill-switch/actions"
echo ""