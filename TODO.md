

Read [](file:///Users/ninebot/Desktop/Github/skill-switch/src-tauri/src/domain.rs#1-1), lines 1 to 120

已提取 2 资源

# 方案：把"系统化仓库"作为 Bundle 处理，复用现有 Resource 抽象

## 现状判断

你的 domain.rs 已经有 `ResourceKind { Skill, Prompt, Agents }` 抽象，不只是 skill。问题不是缺架构，而是缺 **bundle 分组** 和 **更多资源类型**。无需重构。


Read [](file:///Users/ninebot/Desktop/Github/skill-switch/src-tauri/src/domain.rs#1-1), lines 1 to 120

已提取 2 资源

# 方案：把"系统化仓库"作为 Bundle 处理，复用现有 Resource 抽象

## 现状判断

你的 domain.rs 已经有 `ResourceKind { Skill, Prompt, Agents }` 抽象，不只是 skill。问题不是缺架构，而是缺 **bundle 分组** 和 **更多资源类型**。无需重构。

## 核心思路

把 ECC / claude-mem 这种仓库识别为 **Bundle**（一个仓库 = 多个资源），复用现有 Resource 模型，仅做三件事：

1. 扩 `ResourceKind` 枚举
2. 给 `Resource` 加 `bundleId` 字段
3. UI 加一层 grouping

不引入新概念，不改安装管线。

## 改动清单（按优先级）

### 1. 后端：扩展资源类型 + 分组字段

domain.rs

```rust
pub enum ResourceKind {
    Skill, Prompt, Agents,
    Command, Hook, Rule, McpConfig,  // 新增
}

pub struct Resource {
    // ...existing fields...
    pub bundle_id: Option<String>,    // 新增：同仓库的资源共享
    pub bundle_name: Option<String>,
}
```

index.ts 同步镜像。

### 2. 后端：仓库扫描时识别 Bundle

在 repo_sources.rs 现有扫描逻辑里，增加 **目录约定 + manifest 双轨识别**：

```
仓库根扫描顺序：
  1. .claude-plugin/plugin.json  →  按 manifest 列出资源
  2. 否则按约定目录扫描：
       agents/*.md       → Agents
       commands/*.md     → Command
       skills/*/SKILL.md → Skill（已支持）
       hooks/hooks.json  → Hook（一个条目即可）
       rules/**/*.md     → Rule
       mcp-configs/*.json→ McpConfig
  3. 单 skill 仓库（现状）：保持不变，bundle_id = None
```

**bundle_id** = 仓库的 source_id；**bundle_name** = 仓库名。

### 3. 安装路径路由

在 store.rs 现有按 ResourceKind 分流的逻辑里补 4 个分支：

| Kind | Global | Project |
|---|---|---|
| Command | `~/.claude/commands/` | `<proj>/.claude/commands/` |
| Hook | **只显示，不写**（提示合并到 settings.json） | 同左 |
| Rule | `~/.claude/rules/` | `<proj>/.claude/rules/` |
| McpConfig | **只显示**（提示合并到 `~/.claude.json`） | 同左 |

> Hook / MCP 自动写配置风险高（覆盖用户已有），第一版**只读 + 复制按钮 + 文档链接**，零风险。

### 4. 前端：BundleCard 折叠卡片

MyLibraryPage.tsx / RepoBrowsePage.tsx：

- 渲染前按 `bundleId` group（无 bundleId 的保持单卡）
- 新建 `src/components/ui/BundleCard.tsx`：
  - 折叠态：仓库名 + 资源类型徽章（`12 Skills · 8 Commands · 5 Agents`）+ "Install All" 按钮
  - 展开态：内部按 ResourceKind 分 tab，每 tab 复用现有卡片
- 沿用 variables.css 设计 token，颜色/圆角不变

### 5. 类型徽章配色（沿用现有 palette）

| Kind | 颜色复用 |
|---|---|
| Skill | 现有 |
| Command | indigo（同 Git & CI/CD） |
| Agents | violet（同 AI/LLM） |
| Hook | orange（同 Debug） |
| Rule | green（同 Database） |
| MCP | sky |

## 不做的事

- ❌ 不引入插件运行时 / 沙箱
- ❌ 不发明新 manifest 格式（直接读 `.claude-plugin/plugin.json` 已有子集）
- ❌ 不改 git backup sync（store.rs `sync_backup_source_after_mutation` 不动）
- ❌ 不动 symlink 迁移逻辑
- ❌ 第一版不自动合并 hooks/mcp 配置（只展示）

## 工作量估算

| 模块 | 文件数 | 难度 |
|---|---|---|
| domain + types 同步 | 2 | 低 |
| 扫描器扩展 | 1 | 中（manifest 解析 + 目录遍历） |
| 安装路径路由 | 1 | 低（已有模式） |
| BundleCard + 分组 | 3 | 中（UI） |
| 测试 ECC / claude-mem 两个真实仓库 | — | 低 |

总计：约 **7 个文件**，新增枚举 4 个、字段 2 个、UI 组件 1 个。完全向后兼容（旧的单 skill 仓库 `bundleId = None` 走原路径）。

## 后续可选迭代

- v2：Hook / MCP 半自动 merge（带 diff 预览）
- v2：Bundle 整体 update（一键把仓库内所有资源拉新）
- v2：Profile 概念——用户保存"我从 ECC 装了哪几个"

需要我直接动手实现哪一步？建议先做 **第 1+2 步**（domain + 扫描器），跑通一次 ECC 仓库的 list 输出再继续 UI。
## 核心思路

把 ECC / claude-mem 这种仓库识别为 **Bundle**（一个仓库 = 多个资源），复用现有 Resource 模型，仅做三件事：

1. 扩 `ResourceKind` 枚举
2. 给 `Resource` 加 `bundleId` 字段
3. UI 加一层 grouping

不引入新概念，不改安装管线。

## 改动清单（按优先级）

### 1. 后端：扩展资源类型 + 分组字段

domain.rs

```rust
pub enum ResourceKind {
    Skill, Prompt, Agents,
    Command, Hook, Rule, McpConfig,  // 新增
}

pub struct Resource {
    // ...existing fields...
    pub bundle_id: Option<String>,    // 新增：同仓库的资源共享
    pub bundle_name: Option<String>,
}
```

index.ts 同步镜像。

### 2. 后端：仓库扫描时识别 Bundle

在 repo_sources.rs 现有扫描逻辑里，增加 **目录约定 + manifest 双轨识别**：

```
仓库根扫描顺序：
  1. .claude-plugin/plugin.json  →  按 manifest 列出资源
  2. 否则按约定目录扫描：
       agents/*.md       → Agents
       commands/*.md     → Command
       skills/*/SKILL.md → Skill（已支持）
       hooks/hooks.json  → Hook（一个条目即可）
       rules/**/*.md     → Rule
       mcp-configs/*.json→ McpConfig
  3. 单 skill 仓库（现状）：保持不变，bundle_id = None
```

**bundle_id** = 仓库的 source_id；**bundle_name** = 仓库名。

### 3. 安装路径路由

在 store.rs 现有按 ResourceKind 分流的逻辑里补 4 个分支：

| Kind | Global | Project |
|---|---|---|
| Command | `~/.claude/commands/` | `<proj>/.claude/commands/` |
| Hook | **只显示，不写**（提示合并到 settings.json） | 同左 |
| Rule | `~/.claude/rules/` | `<proj>/.claude/rules/` |
| McpConfig | **只显示**（提示合并到 `~/.claude.json`） | 同左 |

> Hook / MCP 自动写配置风险高（覆盖用户已有），第一版**只读 + 复制按钮 + 文档链接**，零风险。

### 4. 前端：BundleCard 折叠卡片

MyLibraryPage.tsx / RepoBrowsePage.tsx：

- 渲染前按 `bundleId` group（无 bundleId 的保持单卡）
- 新建 `src/components/ui/BundleCard.tsx`：
  - 折叠态：仓库名 + 资源类型徽章（`12 Skills · 8 Commands · 5 Agents`）+ "Install All" 按钮
  - 展开态：内部按 ResourceKind 分 tab，每 tab 复用现有卡片
- 沿用 variables.css 设计 token，颜色/圆角不变

### 5. 类型徽章配色（沿用现有 palette）

| Kind | 颜色复用 |
|---|---|
| Skill | 现有 |
| Command | indigo（同 Git & CI/CD） |
| Agents | violet（同 AI/LLM） |
| Hook | orange（同 Debug） |
| Rule | green（同 Database） |
| MCP | sky |

## 不做的事

- ❌ 不引入插件运行时 / 沙箱
- ❌ 不发明新 manifest 格式（直接读 `.claude-plugin/plugin.json` 已有子集）
- ❌ 不改 git backup sync（store.rs `sync_backup_source_after_mutation` 不动）
- ❌ 不动 symlink 迁移逻辑
- ❌ 第一版不自动合并 hooks/mcp 配置（只展示）

## 工作量估算

| 模块 | 文件数 | 难度 |
|---|---|---|
| domain + types 同步 | 2 | 低 |
| 扫描器扩展 | 1 | 中（manifest 解析 + 目录遍历） |
| 安装路径路由 | 1 | 低（已有模式） |
| BundleCard + 分组 | 3 | 中（UI） |
| 测试 ECC / claude-mem 两个真实仓库 | — | 低 |

总计：约 **7 个文件**，新增枚举 4 个、字段 2 个、UI 组件 1 个。完全向后兼容（旧的单 skill 仓库 `bundleId = None` 走原路径）。

## 后续可选迭代

- v2：Hook / MCP 半自动 merge（带 diff 预览）
- v2：Bundle 整体 update（一键把仓库内所有资源拉新）
- v2：Profile 概念——用户保存"我从 ECC 装了哪几个"

需要我直接动手实现哪一步？建议先做 **第 1+2 步**（domain + 扫描器），跑通一次 ECC 仓库的 list 输出再继续 UI。