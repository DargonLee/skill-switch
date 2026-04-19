import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { PageId, LibraryTab } from "../../App";
import { useSkills } from "../../context/SkillContext";
import { APP_LIST } from "../../context/AppContext";
import { useSettings } from "../../context/SettingsContext";
import { useSource } from "../../context/SourceContext";
import { useToast } from "../ui/Toast";
import { BACKUP_SOURCE_REPO_ID } from "../../services/backupSource";
import { MARKET_SOURCE_ID } from "../../services/marketplace";
import { REGISTRY_SOURCE_ID } from "../../services/registry";
import { repoSourceDelete, repoSourceNeedsSync, repoSourceSync } from "../../services/repoSource";
import type { ThirdPartyRepo } from "../../types";
import {
  Plus, Settings, Zap, Sparkles, Database,
  BookMarked, Globe, X, Loader, Cloud, RefreshCw, Trash2, ExternalLink, ChevronRight,
} from "lucide-react";
import s from "./AppShell.module.css";

interface Props {
  activePage: PageId;
  activeRepoId: string | null;
  activeLibraryTab: LibraryTab;
  externalAppFilter: string | null;
  onNavigate: (page: PageId) => void;
  onNavigateRepo: (repoId: string) => void;
  onNavigateLibraryTab: (tab: LibraryTab) => void;
  onNavigateExternalApp: (appId: string) => void;
  children: React.ReactNode;
}

function formatSidebarSyncDate(timestamp?: number | null): string {
  if (!timestamp) {
    return "未同步";
  }

  return `已同步 ${new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  })}`;
}

function formatRepoMeta(url: string, hasLocalSync: boolean): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return `${host} · ${hasLocalSync ? "本地已同步" : "等待同步"}`;
  } catch {
    return hasLocalSync ? "仓库源 · 本地已同步" : "仓库源 · 等待同步";
  }
}

// ── Add Repo Modal ────────────────────────────────────────────────────────────
function AddRepoModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (url: string) => Promise<string | null>; // returns error string or null
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed) { setError("请输入仓库地址"); return; }
    if (!trimmed.startsWith("https://github.com/")) {
      setError("仅支持 https://github.com/ 开头的地址");
      return;
    }
    setLoading(true);
    setError(null);
    const err = await onAdd(trimmed);
    setLoading(false);
    if (err) { setError(err); } else { onClose(); }
  };

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>添加仓库源</span>
          <button className={s.modalClose} onClick={onClose}><X size={14} /></button>
        </div>
        <div className={s.modalBody}>
          <div className={s.modalLabel}>GitHub 仓库地址</div>
          <input
            ref={inputRef}
            className={`${s.modalInput} ${error ? s.modalInputError : ""}`}
            value={url}
            onChange={e => { setUrl(e.target.value); setError(null); }}
            placeholder="https://github.com/owner/repo"
            onKeyDown={e => e.key === "Enter" && handleAdd()}
          />
          {error && <div className={s.modalError}>{error}</div>}
          <div className={s.modalHint}>支持任意公开 GitHub 仓库，技能需以 SKILL.md 文件标识</div>
        </div>
        <div className={s.modalFooter}>
          <button className={s.modalCancelBtn} onClick={onClose}>取消</button>
          <button className={s.modalAddBtn} onClick={handleAdd} disabled={loading}>
            {loading ? <><Loader size={12} className={s.btnSpin} /> 添加中…</> : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ activePage, activeRepoId, activeLibraryTab, externalAppFilter, onNavigate, onNavigateRepo, onNavigateLibraryTab, onNavigateExternalApp, children }: Props) {
  const { skills, externalSkills } = useSkills();
  const { settings, updateSettings } = useSettings();
  const { sourceStates, marketState, registryState, refresh } = useSource();
  const toast = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [repoSyncing, setRepoSyncing] = useState<string | null>(null);
  const [repoDeleting, setRepoDeleting] = useState<string | null>(null);
  const [externalExpanded, setExternalExpanded] = useState(false);

  const repos: ThirdPartyRepo[] = settings.thirdPartyRepos ?? [];
  const backupSource = settings.backupSource;
  const backupState = sourceStates.get(BACKUP_SOURCE_REPO_ID);
  const isBackupActive = activePage === "repo-browse" && activeRepoId === BACKUP_SOURCE_REPO_ID;
  const isMarketActive = activePage === "repo-browse" && activeRepoId === MARKET_SOURCE_ID;
  const isRegistryActive = activePage === "repo-browse" && activeRepoId === REGISTRY_SOURCE_ID;
  const isSyncingAllRepos = repoSyncing === "__all__";

  // Market source summary with total count
  const marketSummary = marketState.status === "loading"
    ? "加载中"
    : marketState.status === "error"
    ? "加载失败"
    : marketState.total > 0
    ? `${marketState.total.toLocaleString()} 项`
    : "内置市场";

  const handleAddRepo = useCallback(async (url: string): Promise<string | null> => {
    if (repos.some(r => r.url === url)) return "该仓库已添加";
    const parts = url.replace(/\/$/, "").split("/");
    const label = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    const newRepo: ThirdPartyRepo = {
      id: `custom-${Date.now()}`,
      url,
      label,
      enabled: true,
      addedAt: Date.now(),
      localPath: null,
      lastSyncedAt: null,
    };

    setRepoSyncing(newRepo.id);
    const syncResult = await repoSourceSync(newRepo);
    setRepoSyncing(null);

    if (!syncResult.ok) {
      return `克隆失败：${syncResult.error}`;
    }

    const ok = await updateSettings({ thirdPartyRepos: [...repos, syncResult.value] });
    if (!ok) {
      await repoSourceDelete(syncResult.value);
      return "保存失败，请重试";
    }

    toast.success(`已添加 ${label}`);
    return null;
  }, [repos, toast, updateSettings]);

  const handleSyncRepo = useCallback(async (repo: ThirdPartyRepo) => {
    setRepoSyncing(repo.id);
    const result = await repoSourceSync(repo);
    setRepoSyncing(null);

    if (!result.ok) {
      toast.error(`更新失败：${result.error}`);
      return;
    }

    const saved = await updateSettings({
      thirdPartyRepos: repos.map((item) => (item.id === repo.id ? result.value : item)),
    });
    if (!saved) {
      toast.error("仓库源信息保存失败");
      return;
    }

    refresh(repo.id);
    toast.success(`已更新 ${repo.label}`);
  }, [refresh, repos, toast, updateSettings]);

  const handleSyncAllRepos = useCallback(async () => {
    if (repos.length === 0) return;

    setRepoSyncing("__all__");
    let nextRepos = [...repos];
    let successCount = 0;
    let failedCount = 0;

    for (const repo of repos) {
      const result = await repoSourceSync(repo);
      if (result.ok) {
        nextRepos = nextRepos.map((item) => (item.id === repo.id ? result.value : item));
        successCount += 1;
      } else {
        failedCount += 1;
      }
    }

    setRepoSyncing(null);

    const saved = await updateSettings({ thirdPartyRepos: nextRepos });
    if (!saved) {
      toast.error("仓库源信息保存失败");
      return;
    }

    refresh();
    if (failedCount > 0) {
      toast.info(`已更新 ${successCount} 个源，${failedCount} 个失败`);
      return;
    }
    toast.success(`已更新全部 ${successCount} 个仓库源`);
  }, [refresh, repos, toast, updateSettings]);

  const handleDeleteRepo = useCallback(async (repo: ThirdPartyRepo) => {
    const confirmed = window.confirm(`删除仓库源「${repo.label}」？这会移除本地克隆。`);
    if (!confirmed) {
      return;
    }

    setRepoDeleting(repo.id);
    const removeResult = await repoSourceDelete(repo);
    setRepoDeleting(null);

    if (!removeResult.ok) {
      toast.error(`删除失败：${removeResult.error}`);
      return;
    }

    const saved = await updateSettings({
      thirdPartyRepos: repos.filter((item) => item.id !== repo.id),
    });
    if (!saved) {
      toast.error("仓库列表保存失败");
      return;
    }

    if (activePage === "repo-browse" && activeRepoId === repo.id) {
      onNavigate("my-library");
    }
    toast.success("仓库源已删除，并移除了本地克隆");
  }, [activePage, activeRepoId, onNavigate, repos, toast, updateSettings]);

  const selfCreatedCount = skills.length;
  const externalCount = externalSkills.length;

  // Per-app external skill counts for sidebar sub-items
  const externalAppGroups = useMemo(() =>
    APP_LIST.map((app) => ({
      appId: app.id,
      label: app.label,
      iconSrc: app.iconSrc,
      count: externalSkills.filter((sk) => sk.appId === app.id).length,
    })).filter((g) => g.count > 0),
    [externalSkills],
  );

  useEffect(() => {
    if (activePage === "my-library" && activeLibraryTab === "external" && externalAppFilter) {
      setExternalExpanded(true);
    }
  }, [activeLibraryTab, activePage, externalAppFilter]);

  const isExternalExpanded = externalExpanded
    || (activePage === "my-library" && activeLibraryTab === "external" && !!externalAppFilter);
  const isExternalActive = activePage === "my-library" && activeLibraryTab === "external";

  const backupSourceBadge = !backupSource
    ? "未配置"
    : backupState?.status === "loading"
    ? "读取中"
    : backupState?.status === "error"
    ? "异常"
    : "已配置";

  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        {/* Logo - fixed at top */}
        <div className={s.logo}>
          <div className={s.logoIcon}><Zap size={18} /></div>
          <span className={s.logoName}>SkillSwitch</span>
        </div>

        {/* Scrollable content */}
        <div className={s.sidebarScroll}>

          {/* Nav */}
          <nav className={s.nav}>
            {/* ── 我的库 section (backup-source style) ── */}
            <div className={s.backupSection}>
              <div className={s.reposHeader}>
                <span>我的库</span>
              </div>

              {/* 自建 */}
              <button
                className={`${s.libraryItem} ${activePage === "my-library" && activeLibraryTab === "self-created" ? s.libraryItemActive : ""}`}
                onClick={() => onNavigateLibraryTab("self-created")}
              >
                <BookMarked size={12} className={s.libraryItemIcon} />
                <span className={s.backupNameWrap}>
                  <span className={s.backupName}>自建</span>
                  <span className={s.backupMeta}>本地创建和导入的 Skills</span>
                </span>
                <span className={s.backupRight}>{selfCreatedCount > 0 ? `${selfCreatedCount} 项` : ""}</span>
              </button>

              {/* 外部 — collapsible with per-CLI sub-items */}
              <button
                className={`${s.libraryItem} ${isExternalActive || isExternalExpanded ? s.libraryItemActive : ""}`}
                onClick={() => setExternalExpanded((prev) => !prev)}
              >
                <ExternalLink size={12} className={s.libraryItemIcon} />
                <span className={s.backupNameWrap}>
                  <span className={s.backupName}>外部</span>
                  <span className={s.backupMeta}>CLI 目录中发现的可导入项</span>
                </span>
                <span className={s.backupRight}>
                  {externalCount > 0 ? `${externalCount} 项` : ""}
                  <ChevronRight size={10} className={`${s.libraryChevron} ${isExternalExpanded ? s.libraryChevronOpen : ""}`} />
                </span>
              </button>

              {/* External sub-items (per CLI app) */}
              {isExternalExpanded && externalAppGroups.length > 0 && (
                <div className={s.librarySubItems}>
                  {externalAppGroups.map((group) => {
                    const isSubActive = externalAppFilter === group.appId;
                    return (
                      <button
                        key={group.appId}
                        className={`${s.librarySubItem} ${isSubActive ? s.librarySubItemActive : ""}`}
                        onClick={() => onNavigateExternalApp(group.appId)}
                      >
                        <img src={group.iconSrc} alt="" className={s.librarySubItemIcon} />
                        <span className={s.librarySubItemLabel}>{group.label}</span>
                        <span className={s.librarySubItemCount}>{group.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}

            </div>

            {/* Backup Source Pin */}
            <div className={s.backupSection}>
              <div className={s.reposHeader}>
                <span>备份源</span>
                <span className={s.backupStateBadge}>{backupSourceBadge}</span>
              </div>
              {backupSource ? (
                <button
                  className={`${s.backupItem} ${isBackupActive ? s.backupItemActive : ""}`}
                  onClick={() =>
                    backupSource.localPath
                      ? onNavigateRepo(BACKUP_SOURCE_REPO_ID)
                      : onNavigate("settings")
                  }
                  title={backupSource.remoteUrl}
                >
                  <Cloud size={12} className={s.backupIcon} />
                  <span className={s.backupNameWrap}>
                    <span className={s.backupName}>{backupSource.repo || backupSource.label}</span>
                    <span className={s.backupMeta}>
                      {backupSource.repo} · {backupSource.branch}
                    </span>
                  </span>
                  <span className={s.backupRight}>
                    {backupState?.status === "loading"
                      ? "读取中"
                      : backupState?.status === "error"
                      ? "需检查"
                      : backupState?.skills.length != null
                      ? `${backupState.skills.length} 项`
                      : formatSidebarSyncDate(backupSource.lastSyncedAt)}
                  </span>
                </button>
              ) : (
                <button
                  className={s.backupItem}
                  onClick={() => onNavigate("settings")}
                  title="前往设置备份源"
                >
                  <Cloud size={12} className={s.backupIcon} />
                  <span className={s.backupNameWrap}>
                    <span className={s.backupName}>备份源未配置</span>
                    <span className={s.backupMeta}>去设置页填写 SSH 仓库与分支</span>
                  </span>
                  <span className={s.backupRight}>设置</span>
                </button>
              )}
            </div>

            {/* Repo Sources Section */}
            <div className={`${s.backupSection} ${s.reposSection}`}>
              <div className={s.reposHeader}>
                <span>仓库源</span>
                <div className={s.reposHeaderActions}>
                  {repos.length > 0 && (
                    <button
                      className={s.reposHeaderBtn}
                      onClick={handleSyncAllRepos}
                      title="更新全部仓库源"
                      disabled={isSyncingAllRepos || repoDeleting !== null}
                    >
                      {isSyncingAllRepos ? <Loader size={12} className={s.repoSpinner} /> : <RefreshCw size={12} />}
                    </button>
                  )}
                  <button
                    className={s.reposHeaderBtn}
                    onClick={() => setShowAddModal(true)}
                    title="添加仓库源"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>

              {/* Online Search (Registry) - always at top */}
              <div
                className={`${s.repoCard} ${isRegistryActive ? s.repoCardActive : ""}`}
              >
                <button
                  className={s.repoCardMain}
                  onClick={() => onNavigateRepo(REGISTRY_SOURCE_ID)}
                  title="在线搜索 skills.sh"
                >
                  <Database size={12} className={`${s.backupIcon} ${s.registryIcon}`} />
                  <span className={s.backupNameWrap}>
                    <span className={s.backupName}>在线搜索</span>
                    <span className={s.backupMeta}>github.com · 全网技能</span>
                  </span>
                  <span className={`${s.backupRight} ${s.repoSummary}`}>
                    {registryState.status === "loading" ? "搜索中..." : registryState.skills.length > 0 ? `${registryState.skills.length} 项结果` : "skills.sh"}
                  </span>
                </button>
              </div>

              {/* Market Source */}
              <div
                className={`${s.repoCard} ${isMarketActive ? s.repoCardActive : ""}`}
              >
                <button
                  className={s.repoCardMain}
                  onClick={() => onNavigateRepo(MARKET_SOURCE_ID)}
                  title="内置技能市场"
                >
                  <Sparkles size={12} className={`${s.backupIcon} ${s.marketIcon}`} />
                  <span className={s.backupNameWrap}>
                    <span className={s.backupName}>技能市场</span>
                    <span className={s.backupMeta}>内置 · 精选技能</span>
                  </span>
                  <span className={`${s.backupRight} ${s.repoSummary}`}>{marketSummary}</span>
                </button>
                {/* No actions for market source - it's a system item */}
              </div>

              {/* Third-party repo sources */}
              {repos.map(repo => {
                const state = sourceStates.get(repo.id);
                const isActive = activePage === "repo-browse" && activeRepoId === repo.id;
                const syncInFlight = repoSyncing === repo.id || isSyncingAllRepos;
                const deleteInFlight = repoDeleting === repo.id;
                const count = state?.skills.length ?? null;
                const loading = syncInFlight || state?.status === "loading";
                const needsSync = repoSourceNeedsSync(state?.error);
                const meta = formatRepoMeta(repo.url, Boolean(repo.localPath));
                const summary = loading
                  ? "更新中"
                  : deleteInFlight
                  ? "删除中"
                  : needsSync
                  ? "未同步"
                  : state?.status === "error"
                  ? "需检查"
                  : count != null
                  ? `${count} 项`
                  : formatSidebarSyncDate(repo.lastSyncedAt);
                return (
                  <div
                    key={repo.id}
                    className={`${s.repoCard} ${isActive ? s.repoCardActive : ""}`}
                  >
                    <button
                      className={s.repoCardMain}
                      onClick={() => onNavigateRepo(repo.id)}
                      title={repo.url}
                      disabled={deleteInFlight}
                    >
                      <Globe size={12} className={`${s.backupIcon} ${s.repoIcon}`} />
                      <span className={s.backupNameWrap}>
                        <span className={s.backupName}>{repo.label}</span>
                        <span className={s.backupMeta}>{meta}</span>
                      </span>
                      <span className={`${s.backupRight} ${s.repoSummary}`}>{summary}</span>
                    </button>
                    <div className={s.repoActions}>
                      <button
                        type="button"
                        className={s.repoActionBtn}
                        onClick={() => handleSyncRepo(repo)}
                        title="更新仓库源"
                        aria-label={`更新仓库源 ${repo.label}`}
                        disabled={syncInFlight || deleteInFlight || isSyncingAllRepos}
                      >
                        {loading ? <Loader size={11} className={s.repoSpinner} /> : <RefreshCw size={11} />}
                        <span>更新仓库源</span>
                      </button>
                      <button
                        type="button"
                        className={`${s.repoActionBtn} ${s.repoActionBtnDanger}`}
                        onClick={() => handleDeleteRepo(repo)}
                        title="删除仓库源"
                        aria-label={`删除仓库源 ${repo.label}`}
                        disabled={syncInFlight || deleteInFlight}
                      >
                        <Trash2 size={11} />
                        <span>删除仓库源</span>
                      </button>
                    </div>
                  </div>
                );
              })}
              {repos.length === 0 && (
                <div className={s.reposEmpty}>点击 + 添加仓库源</div>
              )}
            </div>
          </nav>
        </div>

        {/* Settings - fixed at bottom */}
        <div className={s.settingsWrap}>
          <button
            className={`${s.settingsBtn} ${activePage === "settings" ? s.settingsBtnActive : ""}`}
            onClick={() => onNavigate("settings")}
          >
            <Settings size={14} /> <span>设置</span>
          </button>
        </div>
      </aside>

      <main className={s.main}>{children}</main>

      {showAddModal && (
        <AddRepoModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddRepo}
        />
      )}
    </div>
  );
}
