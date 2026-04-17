import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Search, Check, Download, RefreshCw,
  Loader, AlertTriangle, Globe, Sparkles, Database, X,
} from "lucide-react";
import { useSkills } from "../context/SkillContext";
import { useSource } from "../context/SourceContext";
import { useSettings } from "../context/SettingsContext";
import { BACKUP_SOURCE_REPO_ID, backupSourcePull } from "../services/backupSource";
import { skillImportFromMarket } from "../services/marketplace";
import {
  registryFetchContent,
  registryInstall,
  type RegistrySkillDisplay,
} from "../services/registry";
import { repoSourceNeedsSync, repoSourceSync } from "../services/repoSource";
import { formatSkillOperationError } from "../services/skill";
import type { RemoteSkill } from "../types";
import modalStyles from "../components/layout/AppShell.module.css";
import s from "./RepoBrowsePage.module.css";

const CATEGORIES = ["全部", "Git & CI/CD", "调试", "安全", "数据库", "AI / LLM", "已安装", "未安装"];

// Performance: max items to keep in memory for market source
// With 67,689 total items, limit prevents memory/DOM issues
const MAX_MARKET_ITEMS = 500;

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

interface MarketSkill extends RemoteSkill {
  githubUrl?: string;
  branch?: string;
  skillPath?: string;
  stars?: number;
  author?: string;
}

function stripFrontMatter(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return normalized;
  }

  const boundary = normalized.indexOf("\n---\n", 4);
  if (boundary === -1) {
    return normalized;
  }

  return normalized.slice(boundary + 5).trim();
}

function buildPreviewSummary(skill: MarketSkill, content: string): string {
  const fallback = skill.description || "暂无描述";
  if (!content.trim()) {
    return fallback;
  }

  const paragraphs = stripFrontMatter(content)
    .split(/\n\s*\n/)
    .map((section) => section.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((section) => !section.startsWith("#"))
    .filter((section) => !section.startsWith("```"));

  return paragraphs[0] ?? fallback;
}

function SkillCard({ skill, isInstalled, isInstalling, onInstall, onPreview }: {
  skill: MarketSkill;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
  onPreview?: () => void;
}) {
  const category = inferCategory(skill.tags);
  const iconColors = getIconColors(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();
  const previewable = typeof onPreview === "function";

  return (
    <div
      className={`${s.card} ${previewable ? s.cardPreviewable : ""}`}
      onClick={onPreview}
    >
      <div className={s.cardContent}>
        <div className={s.cardIcon} style={{ background: iconColors.bg, color: iconColors.fg }}>
          <span>{initial}</span>
        </div>

        <div className={s.cardBody}>
          <div className={s.cardHeader}>
            <span className={s.cardName}>{skill.name}</span>
            <span
              className={`${s.cardBadge} ${isInstalled ? s.cardBadgeInstalled : ""}`}
              style={!isInstalled ? {
                background: getCategoryColor(category),
                color: getCategoryTextColor(category)
              } : undefined}
            >
              {isInstalled ? "已安装" : category}
            </span>
          </div>
          <p className={s.cardDesc}>{skill.description || "暂无描述"}</p>
          <div className={s.cardFooter}>
            {skill.author && <span className={s.cardAuthor}>{skill.author}</span>}
            {skill.stars != null && (
              <span className={s.cardStars}>★ {skill.stars.toLocaleString()}</span>
            )}
            {previewable && <span className={s.cardPreviewHint}>点击预览</span>}
          </div>
        </div>

        <button
          className={`${s.cardBtn} ${isInstalled ? s.cardBtnDone : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onInstall();
          }}
          disabled={isInstalling || isInstalled}
          title={isInstalled ? "已安装" : "安装"}
        >
          {isInstalling ? <Loader size={14} className={s.spin} />
            : isInstalled ? <Check size={14} />
            : <Download size={14} />}
        </button>
      </div>
    </div>
  );
}

// Registry Skill Card
function RegistrySkillCard({ skill, isInstalled, isInstalling, onInstall }: {
  skill: RegistrySkillDisplay; isInstalled: boolean; isInstalling: boolean; onInstall: () => void;
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
          <div className={s.cardHeader}>
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
          {isInstalling ? <Loader size={14} className={s.spin} />
            : isInstalled ? <Check size={14} />
            : <Download size={14} />}
        </button>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className={s.card}>
      <div className={s.cardContent}>
        <div className={s.skeletonIcon} />
        <div className={s.skeletonBody}>
          <div className={s.skeletonTitle} />
          <div className={s.skeletonDesc} />
          <div className={s.skeletonFooter} />
        </div>
      </div>
    </div>
  );
}

function MarketPreviewModal({
  skill,
  content,
  status,
  error,
  isInstalled,
  isInstalling,
  onClose,
  onInstall,
}: {
  skill: MarketSkill;
  content: string;
  status: "loading" | "success" | "error";
  error: string | null;
  isInstalled: boolean;
  isInstalling: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  const summary = buildPreviewSummary(skill, content);

  return (
    <div className={modalStyles.modalOverlay} onClick={onClose}>
      <div
        className={`${modalStyles.modal} ${s.previewModal}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={modalStyles.modalHeader}>
          <div className={s.previewHeaderMain}>
            <span className={modalStyles.modalTitle}>{skill.name}</span>
            <span className={s.previewHeaderMeta}>
              {skill.author ? `${skill.author} · ` : ""}
              {skill.stars != null ? `${skill.stars.toLocaleString()} stars` : "技能市场"}
            </span>
          </div>
          <button className={modalStyles.modalClose} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className={`${modalStyles.modalBody} ${s.previewBody}`}>
          <div className={s.previewSummaryCard}>
            <div className={s.previewSectionLabel}>这个 Skill 是做什么的</div>
            <div className={s.previewSummaryText}>{summary}</div>
            <div className={s.previewMetaRow}>
              {skill.skillPath && <span className={s.previewMetaChip}>{skill.skillPath}</span>}
              {skill.branch && <span className={s.previewMetaChip}>分支 {skill.branch}</span>}
              <span className={s.previewMetaChip}>{inferCategory(skill.tags)}</span>
            </div>
          </div>

          <div className={s.previewSection}>
            <div className={s.previewSectionTitle}>SKILL.md 预览</div>
            {status === "loading" ? (
              <div className={s.previewLoading}>
                <Loader size={16} className={s.spin} />
                <span>正在读取 SKILL.md...</span>
              </div>
            ) : status === "error" ? (
              <div className={s.previewErrorBox}>
                <AlertTriangle size={16} />
                <span>{error || "读取 SKILL.md 失败"}</span>
              </div>
            ) : (
              <pre className={s.previewContent}>{content}</pre>
            )}
          </div>

          <div className={s.previewActions}>
            <button className={s.previewCloseBtn} onClick={onClose}>
              关闭
            </button>
            <button
              className={`${s.previewInstallBtn} ${isInstalled ? s.previewInstallBtnDone : ""}`}
              onClick={onInstall}
              disabled={isInstalling || isInstalled}
            >
              {isInstalling ? <><Loader size={14} className={s.spin} /> 安装中</> : isInstalled ? <><Check size={14} /> 已安装</> : <><Download size={14} /> 安装到我的库</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RepoBrowsePage({ repoId }: { repoId: string }) {
  const { skills: installedSkills, create } = useSkills();
  const { sourceStates, marketState, registryState, searchRegistry, refresh, loadMoreMarket, searchMarket, isMarketSource, isRegistrySource } = useSource();
  const { settings, updateSettings } = useSettings();
  const [search, setSearch] = useState("");
  const [registrySearchInput, setRegistrySearchInput] = useState("");
  const [category, setCategory] = useState("全部");
  const [installing, setInstalling] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<MarketSkill | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewStatus, setPreviewStatus] = useState<"loading" | "success" | "error">("loading");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const previewRequestRef = useRef(0);

  const state = sourceStates.get(repoId);
  const installedNames = useMemo(
    () => new Set(installedSkills.map(sk => sk.name.toLowerCase())), [installedSkills]
  );

  const isMarket = isMarketSource(repoId);
  const isRegistry = isRegistrySource(repoId);
  const isBackup = repoId === BACKUP_SOURCE_REPO_ID;

  // Get skills based on source type, limit for market source to prevent memory issues
  const rawSkills = isMarket ? marketState.items : (state?.skills ?? []);
  const skills = useMemo(() => {
    if (isMarket && rawSkills.length > MAX_MARKET_ITEMS) {
      return rawSkills.slice(0, MAX_MARKET_ITEMS);
    }
    return rawSkills;
  }, [rawSkills, isMarket]);

  const isLoading = isMarket ? marketState.status === "loading" : (!state || state.status === "loading");

  const filtered = useMemo(() => {
    return skills.filter(sk => {
      const inst = installedNames.has(sk.name.toLowerCase());
      if (category === "已安装" && !inst) return false;
      if (category === "未安装" && inst) return false;
      if (!["全部","已安装","未安装"].includes(category) && inferCategory(sk.tags) !== category) return false;
      // For market source, search is handled by the backend
      if (isMarket) return true;
      if (!search) return true;
      const q = search.toLowerCase();
      return sk.name.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q)
        || sk.tags.some(t => t.toLowerCase().includes(q));
    });
  }, [skills, installedNames, category, search, isMarket]);

  // Infinite scroll for market source
  useEffect(() => {
    if (!isMarket) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Only load more if we haven't hit the limit
        if (entries[0].isIntersecting &&
            marketState.page < marketState.totalPages &&
            rawSkills.length < MAX_MARKET_ITEMS) {
          loadMoreMarket();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [isMarket, marketState.page, marketState.totalPages, loadMoreMarket, rawSkills.length]);

  const handleInstall = useCallback(async (skill: MarketSkill) => {
    if (installedNames.has(skill.name.toLowerCase())) return;
    setInstalling(skill.id);

    try {
      if (isMarket && skill.githubUrl && skill.branch && skill.skillPath) {
        const result = await skillImportFromMarket({
          githubUrl: skill.githubUrl,
          branch: skill.branch,
          skillPath: skill.skillPath,
          skillName: skill.name,
        });

        if (!result.ok) {
          throw new Error(result.error);
        }

        setToast(`「${skill.name}」已安装！`);
      } else {
        const tags = isBackup
          ? skill.tags.filter((t) => !t.startsWith("_"))
          : [...skill.tags.filter((t) => !t.startsWith("_")), `_remote:${repoId}`];
        const result = await create({
          name: skill.name,
          description: skill.description || null,
          content: skill.content,
          directories: [],
          tags,
          projectIds: [],
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        setToast(`「${skill.name}」已安装！`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast(formatSkillOperationError(message, "安装"));
    } finally {
      setInstalling(null);
      setTimeout(() => setToast(null), 2400);
    }
  }, [create, installedNames, isBackup, isMarket, repoId]);

  const handlePreview = useCallback(async (skill: MarketSkill) => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;

    setPreviewSkill(skill);
    setPreviewError(null);

    if (skill.content.trim()) {
      setPreviewContent(skill.content);
      setPreviewStatus("success");
      return;
    }

    setPreviewContent("");
    setPreviewStatus("loading");

    try {
      const response = await fetch(skill.rawUrl, {
        headers: { Accept: "text/plain" },
      });

      if (!response.ok) {
        throw new Error(`读取失败（${response.status}）`);
      }

      const content = await response.text();
      if (previewRequestRef.current !== requestId) {
        return;
      }

      setPreviewContent(content);
      setPreviewStatus("success");
    } catch (error) {
      if (previewRequestRef.current !== requestId) {
        return;
      }

      setPreviewContent("");
      setPreviewStatus("error");
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleClosePreview = useCallback(() => {
    previewRequestRef.current += 1;
    setPreviewSkill(null);
    setPreviewContent("");
    setPreviewError(null);
    setPreviewStatus("loading");
  }, []);

  const handleSync = useCallback(async () => {
    if (isMarket) {
      refresh(repoId);
      setToast("已刷新市场数据");
      setTimeout(() => setToast(null), 2400);
      return;
    }

    // Handle backup source sync
    if (isBackup) {
      setSyncing(true);
      const result = await backupSourcePull();
      setSyncing(false);

      if (!result.ok) {
        setToast(`同步失败：${result.error}`);
        setTimeout(() => setToast(null), 2400);
        return;
      }

      // Update backup source settings with new sync info
      const saved = await updateSettings({
        backupSource: settings.backupSource ? {
          ...settings.backupSource,
          lastSyncedAt: Date.now(),
          lastSyncedCommit: result.value.lastSyncedCommit ?? null,
        } : null,
      });
      if (!saved) {
        setToast("备份源信息保存失败");
        setTimeout(() => setToast(null), 2400);
        return;
      }

      refresh(repoId);
      setToast(`已同步备份源`);
      setTimeout(() => setToast(null), 2400);
      return;
    }

    const repo = settings.thirdPartyRepos?.find((item) => item.id === repoId);
    if (!repo) return;

    setSyncing(true);
    const result = await repoSourceSync(repo);
    setSyncing(false);

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
  }, [refresh, repoId, settings.thirdPartyRepos, settings.backupSource, updateSettings, isMarket, isBackup]);

  // Debounced search for market source
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);

    if (isMarket) {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      searchTimeoutRef.current = setTimeout(() => {
        searchMarket(value);
      }, 300);
    }
  }, [isMarket, searchMarket]);

  // Registry search handler
  const handleRegistrySearchChange = useCallback((value: string) => {
    setRegistrySearchInput(value);
    searchRegistry(value);
  }, [searchRegistry]);

  // Install registry skill
  const handleInstallRegistry = useCallback(async (skill: RegistrySkillDisplay) => {
    if (installedNames.has(skill.name.toLowerCase())) return;
    setInstalling(skill.id);
    setToast("正在获取技能内容...");

    try {
      const contentResult = await registryFetchContent(skill.source, skill.skillId);
      if (!contentResult.ok) {
        throw new Error(contentResult.error);
      }

      const installResult = await registryInstall({
        skillId: skill.skillId,
        skillName: skill.name,
        content: contentResult.value.content,
        source: skill.source,
        apps: ["claude", "codex", "cursor"],
      });

      if (!installResult.ok) {
        throw new Error(installResult.error);
      }

      const { installedApps, failedApps } = installResult.value;
      if (installedApps.length > 0) {
        setToast(`「${skill.name}」已安装到 ${installedApps.join(", ")}！`);
      } else if (failedApps.length > 0) {
        setToast(`安装失败：${failedApps.join(", ")}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast(formatSkillOperationError(message, "安装"));
    } finally {
      setInstalling(null);
      setTimeout(() => setToast(null), 2400);
    }
  }, [installedNames]);

  const needsSync = !isMarket && !isRegistry && repoSourceNeedsSync(state?.error);
  const repoLabel = isMarket ? "技能市场" : isRegistry ? "在线搜索" : (state?.skills[0]?.repoLabel ?? repoId);
  const repoUrl = (isMarket || isRegistry) ? "" : (state?.skills[0]?.repoUrl ?? "");
  const previewInstalled = previewSkill ? installedNames.has(previewSkill.name.toLowerCase()) : false;

  // Check if we hit the item limit
  const hitLimit = isMarket && rawSkills.length >= MAX_MARKET_ITEMS;

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerLeft}>
          {isMarket ? (
            <Sparkles size={16} className={s.headerIcon} />
          ) : isRegistry ? (
            <Database size={16} className={s.headerIcon} />
          ) : (
            <Globe size={16} className={s.headerIcon} />
          )}
          <div>
            <div className={s.headerTitle}>{repoLabel}</div>
            {repoUrl && <div className={s.headerUrl}>{repoUrl}</div>}
            {isMarket && marketState.total > 0 && (
              <div className={s.headerSubtitle}>
                共 {marketState.total.toLocaleString()} 项技能
                {hitLimit && ` · 已加载 ${MAX_MARKET_ITEMS.toLocaleString()} 项`}
              </div>
            )}
            {isRegistry && (
              <div className={s.headerSubtitle}>搜索 skills.sh 全网技能</div>
            )}
          </div>
          {needsSync && <span className={s.statusBadge}>未同步</span>}
        </div>
        <div className={s.headerRight}>
          {isRegistry ? (
            <div className={s.searchWrap}>
              <Search size={13} className={s.searchIcon} />
              <input className={s.search} value={registrySearchInput}
                onChange={e => handleRegistrySearchChange(e.target.value)}
                placeholder="搜索技能..." />
            </div>
          ) : (
            <>
              <div className={s.searchWrap}>
                <Search size={13} className={s.searchIcon} />
                <input className={s.search} value={search}
                  onChange={e => handleSearchChange(e.target.value)} placeholder="搜索..." />
              </div>
              <button className={s.refreshBtn}
                onClick={() => refresh(repoId)} disabled={isLoading} title="刷新">
                <RefreshCw size={13} className={isLoading ? s.spin : ""} />
              </button>
            </>
          )}
        </div>
      </header>

      {!isRegistry && (
        <div className={s.filterBar}>
          {CATEGORIES.map(c => (
            <button key={c} className={`${s.pill} ${category === c ? s.pillActive : ""}`}
              onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
      )}

      <div className={s.content}>
        {isRegistry ? (
          // Registry content
          registryState.status === "loading" ? (
            <div className={s.grid}>{[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}</div>
          ) : registryState.error ? (
            <div className={s.errorState}>
              <AlertTriangle size={16} />
              <span>{registryState.error}</span>
            </div>
          ) : registrySearchInput.length < 2 ? (
            <div className={s.emptyState}>输入关键词搜索全网技能</div>
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
                  onInstall={() => handleInstallRegistry(sk)}
                />
              ))}
            </div>
          )
        ) : isLoading && skills.length === 0 ? (
          <div className={s.grid}>{[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}</div>
        ) : needsSync ? (
          <div className={s.noticeState}>
            <AlertTriangle size={16} />
            <div>
              <div className={s.noticeTitle}>这个仓库源还没有同步到本地</div>
              <div className={s.noticeText}>同步完成后，这里会展示本地仓库里的 Skills 列表。</div>
            </div>
            <button className={s.noticeBtn} onClick={handleSync} disabled={syncing}>
              {syncing ? <><Loader size={12} className={s.spin} /> 同步中</> : <><RefreshCw size={12} /> 立即同步</>}
            </button>
          </div>
        ) : state?.error && !isMarket ? (
          <div className={s.errorState}>
            <AlertTriangle size={16} />
            <span>{state.error}</span>
            <button onClick={() => refresh(repoId)}>重试</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className={s.emptyState}>暂无匹配的 Skills</div>
        ) : (
          <>
            <div className={s.grid}>
              {filtered.map(sk => (
                <SkillCard key={sk.id} skill={sk as MarketSkill}
                  isInstalled={installedNames.has(sk.name.toLowerCase())}
                  isInstalling={installing === sk.id}
                  onInstall={() => handleInstall(sk as MarketSkill)}
                  onPreview={isMarket ? () => void handlePreview(sk as MarketSkill) : undefined} />
              ))}
            </div>
            {/* Load more trigger or limit message */}
            {isMarket && (
              hitLimit ? (
                <div className={s.loadMore}>
                  <span>已加载 {MAX_MARKET_ITEMS.toLocaleString()} 项，使用搜索查找更多技能</span>
                </div>
              ) : marketState.page < marketState.totalPages && (
                <div ref={loadMoreRef} className={s.loadMore}>
                  {marketState.status === "loading" ? (
                    <Loader size={16} className={s.spin} />
                  ) : (
                    <span>加载更多...</span>
                  )}
                </div>
              )
            )}
          </>
        )}
      </div>

      {previewSkill && (
        <MarketPreviewModal
          skill={previewSkill}
          content={previewContent}
          status={previewStatus}
          error={previewError}
          isInstalled={previewInstalled}
          isInstalling={installing === previewSkill.id}
          onClose={handleClosePreview}
          onInstall={() => void handleInstall(previewSkill)}
        />
      )}

      {toast && <div className={s.toast}>{toast}</div>}
    </div>
  );
}
