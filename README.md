# SkillSwitch

**AI Skill 管理工具** — 专为 Claude Code、Codex CLI、Gemini CLI 等 AI 编程助手设计的跨平台桌面应用，用于统一管理、发现和备份你的 Skill 文件。

---

## 功能概览

### 已安装
浏览和管理当前已安装的 Skills。左侧卡片列表展示所有 Skill，右侧详情面板提供三个标签页：

- **概览** — 版本更新信息（Changelog）、Stars/下载量/文件大小统计
- **启用状态** — 按全局级别和项目级别控制该 Skill 在哪些 App、哪些项目中生效
- **SKILL.md** — 查看 Skill 的入口文件内容，支持一键复制

### 发现
从仓库源浏览可安装的 Skills，支持分类标签筛选（Git & CI/CD、调试、安全、数据库、AI/LLM 等）和关键词搜索，一键安装/卸载。

### 创建
可视化创建新 Skill，支持完整的目录结构：

| 文件/目录 | 用途 |
|---|---|
| `SKILL.md` | Skill 入口文件，AI 每次调用时读取 |
| `agents/` | 子 Agent 指令文件 |
| `assets/` | 图片、模板等静态资源 |
| `references/` | 参考文档、知识库 |
| `scripts/` | 可执行脚本 |

左侧填写基本信息（名称、描述、颜色、启用应用），右侧多文件 Tab 编辑器实时预览目录结构。

### 备份
管理 Skill 快照，分两个区块：
- **当前已安装（手动快照）** — 可随时回滚到快照版本
- **已卸载（自动保存）** — 卸载时自动保留，支持恢复

支持「立即备份全部」一键创建所有已安装 Skill 的快照。

当前版本固定将备份写入应用数据目录。macOS 默认路径是 `~/Library/Application Support/com.skill-switch.app/backups`。

### 设置

| 分区 | 配置项 |
|---|---|
| 通用 | 界面语言、自动检查更新、开机自启 |
| 备份 | 本地备份文件夹（固定为应用数据目录）、最大保留数量 |
| 备份源（SSH） | SSH 仓库地址、目标分支、手动推送/拉取、SSH 配置说明 |
| 外观 | 浅色 / 深色 / 跟随系统 |
| 危险操作 | 清空备份、重置设置 |

### 配置 GitHub 备份

SkillSwitch 的 GitHub 备份只支持 SSH key 认证。先准备好你自己的仓库和 SSH key，再把仓库地址填到设置页。

1. 在 GitHub 新建一个空仓库，建议单独用于备份。
2. 如果电脑上还没有 SSH key，运行 `ssh-keygen -t ed25519 -C "you@example.com"`。
3. 运行 `cat ~/.ssh/id_ed25519.pub`，复制输出内容，然后粘贴到 GitHub 的 [SSH keys 设置页](https://github.com/settings/keys)。
4. 运行 `ssh -T git@github.com`，确认 GitHub 已识别这台电脑。
5. 打开 SkillSwitch 的 **设置** > **备份源（SSH）**，填写仓库 SSH 地址，例如 `git@github.com:owner/skill-switch-backup.git`。

---

## App Switcher

侧边栏顶部支持切换当前管理的 AI 应用，已内置：

- 🤖 Claude Code
- ⌨️ Codex CLI
- 💎 Gemini CLI
- 🖱️ Cursor
- 🏄 Windsurf

切换后界面主题色跟随对应 App 的品牌色。

---

## Tech Stack

| 层 | 技术 |
|---|---|
| UI | React 18 + TypeScript 5 |
| 构建 | Vite 6 |
| 桌面运行时 | Tauri 2 |
| 样式 | CSS Modules + CSS Variables |
| 包管理 | pnpm |

---

## 项目结构

```
src/
├── App.tsx                  # 根组件，本地 state 控制页面切换（无 Router）
├── data/
│   └── mockData.ts          # 共享 mock 数据（Skills、Apps）
├── pages/
│   ├── InstalledPage.tsx    # 已安装页（卡片列表 + 详情面板）
│   ├── DiscoverPage.tsx     # 发现页
│   ├── CreatePage.tsx       # 创建页（多文件 Tab 编辑器）
│   ├── BackupsPage.tsx      # 备份页
│   └── SettingsPage.tsx     # 设置页
├── components/
│   └── layout/
│       └── AppShell.tsx     # 侧边栏布局（Logo、AppSwitcher、导航、仓库源）
└── styles/
    ├── reset.css
    └── variables.css        # 设计 Token（CSS 自定义属性，支持深色模式）

src-tauri/                   # Rust 后端（Tauri 2）
.github/
└── workflows/
    ├── ci.yml               # 前端类型检查 + Rust clippy（push/PR 触发）
    ├── pr-check.yml         # PR 验证 + rustfmt 格式检查
    └── release.yml          # 多平台构建并发布（git tag 触发）
```

---

## 窗口配置

默认启动尺寸 **1100 × 720**，最小尺寸 **900 × 600**（在 `src-tauri/tauri.conf.json` 中配置）。

---

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器 + Tauri 窗口
pnpm tauri dev

# 仅类型检查
pnpm exec tsc --noEmit
```

## 构建

```bash
pnpm tauri build
```

## 发布

推送版本 tag 触发 release workflow，自动构建 macOS (arm64 + x86_64)、Linux、Windows 三平台产物并发布为 draft release：

```bash
git tag v0.1.0
git push origin v0.1.0
```
