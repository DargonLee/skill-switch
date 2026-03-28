import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Search, Check, Download, RefreshCw, Globe,
  Loader, AlertTriangle, BookMarked, Database,
} from "lucide-react";
import { useSkills } from "../context/SkillContext";
import { useSource } from "../context/SourceContext";
import { useSettings } from "../context/SettingsContext";
import { BACKUP_SOURCE_REPO_ID } from "../services/backupSource";
import { resourceList } from "../services/resource";
import { repoSourceNeedsSync, repoSourceSync } from "../services/repoSource";
import { formatSkillOperationError } from "../services/skill";
import {
  REGISTRY_SOURCE_ID,
  registryFetchContent,
  registryInstall,
  type RegistrySkillDisplay,
} from "../services/registry";
import type { Resource, RemoteSkill } from "../types";
import s from "./DiscoverPage.module.css";

const CATEGORIES = ["全部", "Git & CI/CD", "调试", "安全", "数据库", "AI / LLM", "已安装", "未安装"];

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    "Git & CI/CD": "rgba(99, 102, 241, 0.10)",
    "调试": "rgba(249, 115, 22, 0.10)",
    "安全": "rgba(239, 68, 68, 0.10)",
    "数据库": "rgba(34, 197, 94, 0.10)",
    "AI / LLM": "rgba(139, 92, 246, 0.10)",
  };
  return colors[category] || "rgba(99, 102, 241, 0.10)";
}

function getCategoryTextColor(category: string): string {
  const colors: Record<string, string> = {
    "Git & CI/CD": "#6366f1",
    "调试": "#f97316",
    "安全": "#ef4444",
    "数据库": "#22c55e",
    "AI / LLM": "#8b5cf6",
  };
  return colors[category] || "#6366f1";
}

function getIconColors(name: string): { bg: string; fg: string } {
  const palettes = [
    { bg: "#6366f1", fg: "#ffffff" },
    { bg: "#22c55e", fg: "#ffffff" },
    { bg: "#ef4444", fg: "#ffffff" },
    { bg: "#06b6d4", fg: "#ffffff" },
    { bg: "#f97316", fg: "#ffffff" },
    { bg: "#ec4899", fg: "#ffffff" },
    { bg: "#8b5cf6", fg: "#ffffff" },
    { bg: "#0ea5e9", fg: "#ffffff" },
  ];
  return palettes[name.charCodeAt(0) % palettes.length];
}

function inferCategory(tags: string[]): string {
  if (tags.some(t => t === "git" || t === "ci")) return "Git & CI/CD";
  if (tags.some(t => t === "debug" || t === "debugging")) return "调试";
  if (tags.includes("security")) return "安全";
  if (tags.some(t => t === "database" || t === "db")) return "数据库";
  return "AI / LLM";
}

// ─── Registry Skill Card ───────────────────────────────────────────────────────
function RegistrySkillCard({
  skill, isInstalled, isInstalling, onInstall,
}: {
  skill: RegistrySkillDisplay;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
}) {
  const iconColors = getIconColors(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();

  return (
    <div className={s.card}>
      <div className={s.cardContent}>
        <div className={s.cardIcon} style={{ background: iconColors.bg, color: iconColors.fg }}>
          <span>{initial}</span>
        </div>
        <div className={s.cardBody}>
          <div className={s.cardTop}>
            <span className={s.cardName}>{skill.name}</span>
            <span
              className={`${s.cardBadge} ${isInstalled ? s.cardBadgeInstalled : ""}`}
              style={!isInstalled ? {
                background: "rgba(139, 92, 246, 0.10)",
                color: "#8b5cf6"
              } : undefined}
            >
              {isInstalled ? "已安装" : skill.formattedInstalls}
            </span>
          </div>
          <p className={s.cardDesc}>{skill.source}</p>
        </div>
        <button
          className={`${s.cardBtn} ${isInstalled ? s.cardBtnDone : ""}`}
          onClick={onInstall}
          disabled={isInstalling || isInstalled}
          title={isInstalled ? "已安装" : "安装"}
        >
          {isInstalling
            ? <Loader size={14} className={s.btnSpinner} />
            : isInstalled
            ? <Check size={14} />
            : <Download size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── Compact Skill Card ───────────────────────────────────────────────────────
function SkillCard({
  name, description, tags, isInstalled, isInstalling, onInstall,
}: {
  name: string; description: string; tags: string[];
  isInstalled: boolean; isInstalling: boolean; onInstall: () => void;
}) {
  const cat = inferCategory(tags);
  const iconColors = getIconColors(name);
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className={s.card}>
      <div className={s.cardContent}>
        {/* 左侧图标容器 */}
        <div className={s.cardIcon} style={{ background: iconColors.bg, color: iconColors.fg }}>
          <span>{initial}</span>
        </div>

        {/* 主体内容 */}
        <div className={s.cardBody}>
          <div className={s.cardTop}>
            <span className={s.cardName}>{name}</span>
            <span
              className={`${s.cardBadge} ${isInstalled ? s.cardBadgeInstalled : ""}`}
              style={!isInstalled ? {
                background: getCategoryColor(cat),
                color: getCategoryTextColor(cat)
              } : undefined}
            >
              {isInstalled ? "已安装" : cat}
            </span>
          </div>
          <p className={s.cardDesc}>{description || "暂无描述"}</p>
        </div>

        {/* 右下角悬浮按钮 */}
        <button
          className={`${s.cardBtn} ${isInstalled ? s.cardBtnDone : ""}`}
          onClick={onInstall}
          disabled={isInstalling || isInstalled}
          title={isInstalled ? "已安装" : "安装"}
        >
          {isInstalling
            ? <Loader size={14} className={s.btnSpinner} />
            : isInstalled
            ? <Check size={14} />
            : <Download size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className={s.card}>
      <div className={s.cardContent}>
        <div className={s.skeletonIcon} />
        <div className={s.skeletonBody}>
          <div className={s.skeletonTitle} />
          <div className={s.skeletonDesc} />
        </div>
      </div>
    </div>
  );
}

// ─── Source Tab item ──────────────────────────────────────────────────────────
interface SourceTab {
  id: string;
  label: string;
  shortLabel: string;
  isLocal: boolean;
  isRegistry?: boolean;
  count: number;
  loading: boolean;
  error: string | null;
  needsSync?: boolean;
  url?: string;
}

function TabItem({
  tab, active, onClick,
}: { tab: SourceTab; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`${s.tab} ${active ? s.tabActive : ""}`}
      onClick={onClick}
      title={tab.url ?? tab.label}
    >
      <span className={s.tabIcon}>
        {tab.isLocal
          ? <BookMarked size={13} />
          : tab.isRegistry
          ? <Database size={13} />
          : <Globe size={13} />}
      </span>
      <span className={s.tabLabel}>{tab.shortLabel}</span>
      <span className={s.tabRight}>
        {tab.loading
          ? <Loader size={11} className={s.tabSpinner} />
          : tab.needsSync
          ? <span className={s.tabStatus}>未同步</span>
          : tab.error
          ? <AlertTriangle size={11} className={s.tabError} />
          : <span className={s.tabCount}>{tab.count}</span>}
      </span>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function DiscoverPage() {
  const { skills: installedSkills, create } = useSkills();
  const { sourceStates, registryState, searchRegistry, anyLoading, refresh } = useSource();
  const { settings, updateSettings } = useSettings();
  const [localResources, setLocalResources] = useState<Resource[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [registrySearchInput, setRegistrySearchInput] = useState("");
  const [category, setCategory] = useState("全部");
  const [activeTab, setActiveTab] = useState("__local__");
  const [installing, setInstalling] = useState<string | null>(null);
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const installedIds = useMemo(
    () => new Set(installedSkills.map((sk) => sk.id)), [installedSkills]
  );
  const installedNames = useMemo(
    () => new Set(installedSkills.map((sk) => sk.name.toLowerCase())), [installedSkills]
  );

  useEffect(() => {
    (async () => {
      setLocalLoading(true);
      const result = await resourceList({ kind: "skill" });
      if (result.ok) setLocalResources(result.value);
      else setLocalError(result.error);
      setLocalLoading(false);
    })();
  }, []);

  const matches = useCallback((name: string, desc: string | null | undefined, tags: string[], inst: boolean) => {
    if (category === "已安装" && !inst) return false;
    if (category === "未安装" && inst) return false;
    if (!["全部", "已安装", "未安装"].includes(category) && inferCategory(tags) !== category) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || (desc ?? "").toLowerCase().includes(q)
      || tags.some(t => t.toLowerCase().includes(q));
  }, [search, category]);

  const filteredLocal = useMemo(() =>
    localResources.filter(r => matches(r.title, r.description, r.tags, installedIds.has(r.id))),
    [localResources, installedIds, matches]
  );

  const repoGroups = useMemo(() =>
    Array.from(sourceStates.entries()).map(([id, state]) => ({
      id,
      label: state.skills[0]?.repoLabel ?? id,
      url: state.skills[0]?.repoUrl ?? "",
      status: state.status,
      error: state.error,
      skills: state.skills.filter((sk: RemoteSkill) =>
        matches(sk.name, sk.description, sk.tags, installedNames.has(sk.name.toLowerCase()))
      ),
      allCount: state.skills.length,
    })),
    [sourceStates, installedNames, matches]
  );

  // Build tab list
  const tabs: SourceTab[] = useMemo(() => {
    const localTab: SourceTab = {
      id: "__local__",
      label: "我的库",
      shortLabel: "我的库",
      isLocal: true,
      count: filteredLocal.length,
      loading: localLoading,
      error: localError,
    };
    const registryTab: SourceTab = {
      id: REGISTRY_SOURCE_ID,
      label: "Registry",
      shortLabel: "Registry",
      isLocal: false,
      isRegistry: true,
      count: registryState.skills.length,
      loading: registryState.status === "loading",
      error: registryState.error,
    };
    const repoTabs: SourceTab[] = repoGroups.map((g: { id: string; label: string; url: string; status: string; error: string | null; skills: RemoteSkill[] }) => ({
      id: g.id,
      label: g.label,
      shortLabel: g.label.split("/").pop() ?? g.label,
      isLocal: false,
      count: g.skills.length,
      loading: g.status === "loading",
      error: g.error,
      needsSync: repoSourceNeedsSync(g.error),
      url: g.url,
    }));
    return [localTab, registryTab, ...repoTabs];
  }, [filteredLocal.length, localLoading, localError, registryState, repoGroups]);

  const handleInstallLocal = useCallback(async (resource: Resource) => {
    if (installedIds.has(resource.id)) return;
    setInstalling(resource.id);
    const result = await create({ name: resource.title, description: resource.description || null,
      content: resource.content, directories: [], tags: resource.tags, projectIds: [] });
    setInstalling(null);
    setToast(result.ok ? `「${resource.title}」已安装！` : formatSkillOperationError(result.error, "安装"));
    setTimeout(() => setToast(null), 2400);
  }, [create, installedIds]);

  const handleInstallRemote = useCallback(async (skill: RemoteSkill) => {
    if (installedNames.has(skill.name.toLowerCase())) return;
    setInstalling(skill.id);
    const tags = skill.repoId === BACKUP_SOURCE_REPO_ID
      ? skill.tags.filter((t) => !t.startsWith("_"))
      : [...skill.tags.filter((t) => !t.startsWith("_")), `_remote:${skill.repoId}`];
    const result = await create({ name: skill.name, description: skill.description || null,
      content: skill.content, directories: [], tags, projectIds: [] });
    setInstalling(null);
    setToast(result.ok ? `「${skill.name}」已安装！` : formatSkillOperationError(result.error, "安装"));
    setTimeout(() => setToast(null), 2400);
  }, [create, installedNames]);

  const handleSyncSource = useCallback(async (repoId: string) => {
    const repo = settings.thirdPartyRepos?.find((item) => item.id === repoId);
    if (!repo) return;

    setSyncingRepoId(repoId);
    const result = await repoSourceSync(repo);
    setSyncingRepoId(null);

    if (!result.ok) {
      setToast(`同步失败：${result.error}`);
      setTimeout(() => setToast(null), 2400);
      return;
    }

    const saved = await updateSettings({
      thirdPartyRepos: (settings.thirdPartyRepos ?? []).map((item) =>
        item.id === repoId ? result.value : item
      ),
    });
    if (!saved) {
      setToast("仓库源信息保存失败");
      setTimeout(() => setToast(null), 2400);
      return;
    }

    refresh(repoId);
    setToast(`已同步 ${result.value.label}`);
    setTimeout(() => setToast(null), 2400);
  }, [refresh, settings.thirdPartyRepos, updateSettings]);

  // Registry search input change handler
  const handleRegistrySearchChange = useCallback((query: string) => {
    setRegistrySearchInput(query);
    searchRegistry(query);
  }, [searchRegistry]);

  // Install registry skill
  const handleInstallRegistrySkill = useCallback(async (skill: RegistrySkillDisplay) => {
    if (installedNames.has(skill.name.toLowerCase())) return;

    setInstalling(skill.id);
    setToast("正在获取技能内容...");

    // First fetch content
    const contentResult = await registryFetchContent(skill.source, skill.skillId);

    if (!contentResult.ok) {
      setToast(`获取内容失败：${contentResult.error}`);
      setInstalling(null);
      setTimeout(() => setToast(null), 2400);
      return;
    }

    // Then install
    const installResult = await registryInstall({
      skillId: skill.skillId,
      skillName: skill.name,
      content: contentResult.value.content,
      source: skill.source,
      apps: ["claude", "codex", "cursor"],
    });

    setInstalling(null);

    if (installResult.ok) {
      const { installedApps, failedApps } = installResult.value;
      if (installedApps.length > 0) {
        setToast(`「${skill.name}」已安装到 ${installedApps.join(", ")}！`);
      } else if (failedApps.length > 0) {
        setToast(`安装失败：${failedApps.join(", ")}`);
      }
    } else {
      setToast(`安装失败：${installResult.error}`);
    }
    setTimeout(() => setToast(null), 2400);
  }, [installedNames]);

  // Active tab data
  const activeGroup = activeTab === "__local__" ? null : repoGroups.find(g => g.id === activeTab);
  const activeTabData = tabs.find(t => t.id === activeTab);
  const activeRepoNeedsSync = activeGroup ? repoSourceNeedsSync(activeGroup.error) : false;

  return (
    <div className={s.page}>
      {/* ── Left sidebar tabs ── */}
      <aside className={s.sidebar}>
        <div className={s.sidebarHeader}>
          <span className={s.sidebarTitle}>来源</span>
          <button
            className={s.sidebarRefresh}
            onClick={() => refresh()}
            disabled={anyLoading}
            title="刷新所有源"
          >
            <RefreshCw size={12} className={anyLoading ? s.spinning : ""} />
          </button>
        </div>
        <div className={s.tabList}>
          {tabs.map(tab => (
            <TabItem key={tab.id} tab={tab} active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)} />
          ))}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className={s.main}>
        {/* Top bar */}
        <div className={s.topBar}>
          <div className={s.topBarLeft}>
            <span className={s.contentTitle}>{activeTabData?.label}</span>
            {activeTabData?.url && (
              <span className={s.contentUrl}>{activeTabData.url}</span>
            )}
            {activeRepoNeedsSync && <span className={s.statusBadge}>未同步</span>}
          </div>
          <div className={s.topBarRight}>
            <div className={s.searchWrap}>
              <Search size={13} className={s.searchIcon} />
              <input ref={searchRef} className={s.search} value={search}
                onChange={e => setSearch(e.target.value)} placeholder="搜索..." />
            </div>
            {activeGroup && (
              <button className={s.refreshBtn} onClick={() => refresh(activeGroup.id)}
                disabled={activeGroup.status === "loading"} title="刷新此源">
                <RefreshCw size={13} className={activeGroup.status === "loading" ? s.spinning : ""} />
              </button>
            )}
          </div>
        </div>

        {/* Category filter */}
        <div className={s.filterBar}>
          {CATEGORIES.map(c => (
            <button key={c} className={`${s.pill} ${category === c ? s.pillActive : ""}`}
              onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>

        {/* Content area */}
        <div className={s.content}>
          {activeTab === "__local__" ? (
            // Local skills
            localLoading ? (
              <div className={s.grid}>{[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}</div>
            ) : localError ? (
              <div className={s.errorState}><AlertTriangle size={16} /><span>{localError}</span></div>
            ) : filteredLocal.length === 0 ? (
              <div className={s.emptyState}>暂无匹配的 Skills</div>
            ) : (
              <div className={s.grid}>
                {filteredLocal.map(r => (
                  <SkillCard key={r.id} name={r.title} description={r.description ?? ""}
                    tags={r.tags} isInstalled={installedIds.has(r.id)}
                    isInstalling={installing === r.id}
                    onInstall={() => handleInstallLocal(r)} />
                ))}
              </div>
            )
          ) : activeTab === REGISTRY_SOURCE_ID ? (
            // Registry search
            <div className={s.registryContent}>
              <div className={s.registrySearchWrap}>
                <Search size={16} className={s.searchIcon} />
                <input
                  className={s.registrySearchInput}
                  value={registrySearchInput}
                  onChange={(e) => handleRegistrySearchChange(e.target.value)}
                  placeholder="搜索 skills.sh... (至少 2 个字符)"
                />
              </div>
              {registryState.status === "loading" ? (
                <div className={s.grid}>{[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}</div>
              ) : registryState.error ? (
                <div className={s.errorState}>
                  <AlertTriangle size={16} />
                  <span>{registryState.error}</span>
                </div>
              ) : registrySearchInput.length < 2 ? (
                <div className={s.emptyState}>输入至少 2 个字符开始搜索</div>
              ) : registryState.skills.length === 0 ? (
                <div className={s.emptyState}>未找到匹配的 Skills</div>
              ) : (
                <div className={s.grid}>
                  {registryState.skills.map(sk => (
                    <RegistrySkillCard
                      key={sk.id}
                      skill={sk}
                      isInstalled={installedNames.has(sk.name.toLowerCase())}
                      isInstalling={installing === sk.id}
                      onInstall={() => handleInstallRegistrySkill(sk)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : activeGroup ? (
            // Remote repo skills
            activeGroup.status === "loading" ? (
              <div className={s.grid}>{[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}</div>
              ) : activeRepoNeedsSync ? (
                <div className={s.noticeState}>
                  <AlertTriangle size={16} />
                  <div>
                    <div className={s.noticeTitle}>这个仓库源还没有同步到本地</div>
                    <div className={s.noticeText}>先同步一次本地副本，再浏览和安装其中的 Skills。</div>
                  </div>
                  <button
                    className={s.noticeBtn}
                    onClick={() => handleSyncSource(activeGroup.id)}
                    disabled={syncingRepoId === activeGroup.id}
                  >
                    {syncingRepoId === activeGroup.id ? <><Loader size={12} className={s.spinning} /> 同步中</> : <><RefreshCw size={12} /> 立即同步</>}
                  </button>
                </div>
            ) : activeGroup.error ? (
              <div className={s.errorState}>
                <AlertTriangle size={16} />
                <span>{activeGroup.error}</span>
                <button onClick={() => refresh(activeGroup.id)}>重试</button>
              </div>
            ) : activeGroup.skills.length === 0 ? (
              <div className={s.emptyState}>暂无匹配的 Skills</div>
            ) : (
              <div className={s.grid}>
                {activeGroup.skills.map(sk => (
                  <SkillCard key={sk.id} name={sk.name} description={sk.description}
                    tags={sk.tags}
                    isInstalled={installedNames.has(sk.name.toLowerCase())}
                    isInstalling={installing === sk.id}
                    onInstall={() => handleInstallRemote(sk)} />
                ))}
              </div>
            )
          ) : null}
        </div>
      </div>

      {toast && <div className={s.toast}>{toast}</div>}
    </div>
  );
}
