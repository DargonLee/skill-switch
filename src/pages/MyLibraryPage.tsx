import { useState, useEffect, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  X,
  Search,
  Camera,
  Trash2,
  GitBranch,
  Clock,
  Globe,
  Folder,
  Plus,
  Check,
  AlertTriangle,
  FileArchive,
  FolderOpen,
  Loader,
  FileUp,
  File,
  FileCode,
  FileText,
  Image,
  ChevronRight,
  ArrowLeft,
  ExternalLink,
  Download,
} from "lucide-react";
import { useSkills } from "../context/SkillContext";
import { APP_LIST } from "../context/AppContext";
import { useSettings } from "../context/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { BACKUP_SOURCE_REPO_ID } from "../services/backupSource";
import {
  skillInstallToProject,
  skillUninstallFromProject,
  projectRemoveCliFolders,
  skillInstallGlobal,
  skillUninstallGlobal,
  skillImportFromFolder,
  skillImportFromZip,
  skillExportToZip,
  skillListDirectory,
  skillReadFile,
  showInFinder,
  formatSkillOperationError,
} from "../services/skill";
import { IconButton } from "../components/ui/IconButton";
import type { Skill, ThirdPartyRepo, SkillDirectoryListing, SkillDirectoryEntry, SkillFileContent, ExternalSkill } from "../types";
import modalStyles from "../components/layout/AppShell.module.css";
import s from "./MyLibraryPage.module.css";

// Generate icon colors based on skill name
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

// Format timestamp to readable date
function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN");
}

// Extract remote source info from skill tags
function getRemoteSource(skill: Skill, repos: ThirdPartyRepo[]): { isRemote: boolean; label: string } {
  const remoteTag = skill.tags.find(t => t.startsWith("_remote:"));
  if (!remoteTag) return { isRemote: false, label: "" };

  const repoId = remoteTag.slice(8); // Remove "_remote:" prefix
  if (repoId === BACKUP_SOURCE_REPO_ID) {
    return { isRemote: false, label: "" };
  }
  const repo = repos.find(r => r.id === repoId);

  return {
    isRemote: true,
    label: repo?.label ?? "第三方",
  };
}

function getRemoteRepoId(skill: Skill): string | null {
  const remoteTag = skill.tags.find((t) => t.startsWith("_remote:"));
  return remoteTag ? remoteTag.slice(8) : null;
}

function isThirdPartySkill(skill: Skill): boolean {
  const repoId = getRemoteRepoId(skill);
  return !!repoId && repoId !== BACKUP_SOURCE_REPO_ID;
}

function getAppMeta(appId: string) {
  return APP_LIST.find((app) => app.id === appId) ?? null;
}

// ── Skill Card (left list) ───────────────────────────────────────────────────
function SkillCard({
  skill,
  selected,
  originLabel,
  onClick,
}: {
  skill: Skill;
  selected: boolean;
  originLabel: string;
  onClick: () => void;
}) {
  const iconColors = getIconColors(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();
  const isRemote = !!originLabel;

  return (
    <div
      className={`${s.card} ${selected ? s.cardSelected : ""}`}
      onClick={onClick}
    >
      <div className={s.cardContent}>
        {/* 左侧图标容器 */}
        <div
          className={s.cardIcon}
          style={{ background: iconColors.bg, color: iconColors.fg }}
        >
          <span>{initial}</span>
        </div>

        {/* 主体内容 */}
        <div className={s.cardBody}>
          <div className={s.cardHeader}>
            <span className={s.cardName}>{skill.name}</span>
            {isRemote && (
              <span className={s.cardBadge}>
                <Globe size={10} /> {originLabel}
              </span>
            )}
          </div>
          <p className={s.cardDesc}>{skill.description || "无描述"}</p>
          <div className={s.cardFooter}>
            <span className={s.cardSlug}>{skill.slug}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── External Skill Card (from app directory, not managed by SkillSwitch) ───────
function ExternalSkillCard({
  skill,
  onImport,
}: {
  skill: ExternalSkill;
  onImport: () => void;
}) {
  const iconColors = getIconColors(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();

  return (
    <div className={`${s.card} ${s.cardExternal}`}>
      <div className={s.cardContent}>
        <div
          className={s.cardIcon}
          style={{ background: iconColors.bg, color: iconColors.fg }}
        >
          <span>{initial}</span>
        </div>
        <div className={s.cardBody}>
          <div className={s.cardHeader}>
            <span className={s.cardName}>{skill.name}</span>
            <span className={s.cardBadgeExternal}>
              <ExternalLink size={10} /> 外部
            </span>
          </div>
          <p className={s.cardDesc}>{skill.description || "无描述"}</p>
          <div className={s.cardFooter}>
            <span className={s.cardSlug}>{skill.slug}</span>
          </div>
        </div>
        <button
          className={s.cardImportBtn}
          onClick={(e) => { e.stopPropagation(); onImport(); }}
          title="导入到 SkillSwitch 管理"
        >
          <Download size={14} />
        </button>
      </div>
    </div>
  );
}

function GroupSection({
  title,
  count,
  collapsed,
  onToggle,
  children,
  nested = false,
  icon,
}: {
  title: React.ReactNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  nested?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <section className={`${s.groupSection} ${nested ? s.groupSectionNested : ""}`}>
      <button
        type="button"
        className={`${s.groupHeader} ${nested ? s.groupHeaderNested : ""}`}
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className={s.groupHeaderLeft}>
          <ChevronRight
            size={12}
            className={`${s.groupChevron} ${collapsed ? s.groupChevronCollapsed : ""}`}
          />
          {icon && <span className={s.groupHeaderIcon}>{icon}</span>}
          <span className={s.groupHeaderTitle}>{title}</span>
        </span>
        <span className={s.groupCount}>{count}</span>
      </button>
      {!collapsed && <div className={s.groupBody}>{children}</div>}
    </section>
  );
}

// ── Project enable state interface
interface ProjectEnableState {
  projectId: string;
  projectName: string;
  projectPath: string;
  apps: Record<string, boolean>;
}

// ── Detail Panel Tabs ────────────────────────────────────────────────────────
type Tab = "enable" | "skillmd" | "files";
type LibraryGroupTab = "self-created" | "third-party" | "external";
type DetailLeaveGuard = () => boolean;

// ── File icon based on extension ─────────────────────────────────────────────
function getFileIcon(entry: SkillDirectoryEntry): React.ReactNode {
  if (entry.kind === "directory") {
    return <Folder size={18} />;
  }

  const ext = entry.extension?.toLowerCase();
  switch (ext) {
    case "md":
      return <FileText size={18} />;
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "json":
      return <FileCode size={18} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return <Image size={18} />;
    default:
      return <File size={18} />;
  }
}

// ── Format file size ─────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Directory Browser Component ──────────────────────────────────────────────
function DirectoryBrowser({
  skill,
  onOpenFile,
}: {
  skill: Skill;
  onOpenFile: (path: string) => void;
}) {
  const [listing, setListing] = useState<SkillDirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");

  const loadDirectory = useCallback(async (subPath: string = "") => {
    setLoading(true);
    setError(null);
    const result = await skillListDirectory({ skillId: skill.id, subPath: subPath || null });
    if (result.ok) {
      setListing(result.value);
      setCurrentPath(result.value.currentPath);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [skill.id]);

  useEffect(() => {
    loadDirectory("");
  }, [loadDirectory]);

  const handleEntryClick = (entry: SkillDirectoryEntry) => {
    if (entry.kind === "directory") {
      loadDirectory(entry.path);
    } else {
      onOpenFile(entry.path);
    }
  };

  const handleBackToParent = () => {
    if (listing?.parentPath !== undefined) {
      loadDirectory(listing.parentPath || "");
    }
  };

  const handlePathClick = (path: string) => {
    loadDirectory(path);
  };

  const handleShowInFinder = async () => {
    if (!listing) return;
    const targetPath = currentPath
      ? `${listing.rootPath}/${currentPath}`
      : listing.rootPath;
    const result = await showInFinder(targetPath);
    if (!result.ok) {
      console.error("Failed to show in finder:", result.error);
    }
  };

  if (loading) {
    return (
      <div className={s.directoryBrowser}>
        <div className={s.emptyDirectory}>
          <Loader size={24} className={s.btnSpin} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={s.directoryBrowser}>
        <div className={s.emptyDirectory}>
          <AlertTriangle size={24} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!listing) return null;

  // Build path segments for breadcrumb
  const pathSegments = currentPath.split("/").filter(Boolean);

  return (
    <div className={s.directoryBrowser}>
      <div className={s.directoryHeader}>
        <Folder size={14} />
        <div className={s.directoryPath}>
          <span
            className={s.pathSegmentLink}
            onClick={() => handlePathClick("")}
          >
            {skill.slug}
          </span>
          {pathSegments.map((segment, idx) => (
            <span key={idx} className={s.pathSegment}>
              <ChevronRight size={12} className={s.pathSeparator} />
              <span
                className={s.pathSegmentLink}
                onClick={() => handlePathClick(pathSegments.slice(0, idx + 1).join("/"))}
              >
                {segment}
              </span>
            </span>
          ))}
        </div>
        {currentPath && (
          <button className={s.backBtn} onClick={handleBackToParent}>
            <ArrowLeft size={12} /> 上级
          </button>
        )}
        <button className={s.finderBtn} onClick={handleShowInFinder} title="在 Finder 中显示">
          <ExternalLink size={12} />
        </button>
      </div>
      <div className={s.directoryList}>
        {listing.entries.length === 0 ? (
          <div className={s.emptyDirectory}>
            <FolderOpen size={24} />
            <span>此目录为空</span>
          </div>
        ) : (
          listing.entries.map((entry) => (
            <div
              key={entry.path}
              className={s.directoryEntry}
              onClick={() => handleEntryClick(entry)}
            >
              <div className={`${s.entryIcon} ${entry.kind === "directory" ? s.entryIconDir : s.entryIconFile}`}>
                {getFileIcon(entry)}
              </div>
              <div className={s.entryInfo}>
                <div className={s.entryName}>{entry.name}</div>
                {entry.kind === "file" && entry.size != null && (
                  <div className={s.entryMeta}>{formatSize(entry.size)}</div>
                )}
              </div>
              {entry.kind === "directory" && <ChevronRight size={16} className={s.pathSeparator} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── File Preview Component ───────────────────────────────────────────────────
function FilePreview({
  skill,
  filePath,
  onBack,
}: {
  skill: Skill;
  filePath: string;
  onBack: () => void;
}) {
  const [content, setContent] = useState<SkillFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadFile = async () => {
      setLoading(true);
      setError(null);
      const result = await skillReadFile({ skillId: skill.id, filePath });
      if (result.ok) {
        setContent(result.value);
      } else {
        setError(result.error);
      }
      setLoading(false);
    };
    loadFile();
  }, [skill.id, filePath]);

  const fileName = filePath.split("/").pop() || filePath;

  return (
    <div className={s.filePreview}>
      <div className={s.filePreviewHeader}>
        <button className={s.backBtn} onClick={onBack}>
          <ArrowLeft size={12} /> 返回
        </button>
        <span className={s.fileName}>{fileName}</span>
      </div>
      <div className={s.filePreviewContent}>
        {loading ? (
          <span>加载中...</span>
        ) : error ? (
          <span style={{ color: "var(--error)" }}>{error}</span>
        ) : (
          content?.content || ""
        )}
      </div>
    </div>
  );
}

function DetailPanel({
  skill,
  onSnapshot,
  onDelete,
  onExport,
  onRegisterLeaveGuard,
}: {
  skill: Skill;
  onSnapshot: () => void;
  onDelete: () => void;
  onExport: () => void;
  onRegisterLeaveGuard: (guard: DetailLeaveGuard | null) => void;
}) {
  const { update } = useSkills();
  const [tab, setTab] = useState<Tab>("enable");
  const [copied, setCopied] = useState(false);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);
  const [isEditingSkillMd, setIsEditingSkillMd] = useState(false);
  const [draftContent, setDraftContent] = useState(skill.content);
  const [isSkillMdDirty, setIsSkillMdDirty] = useState(false);
  const [isSavingSkillMd, setIsSavingSkillMd] = useState(false);
  const iconColors = getIconColors(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();
  const toast = useToast();

  // Global app enable states — persisted per skillId in localStorage
  const globalStorageKey = `skill-global-${skill.id}`;
  const [globalApps, setGlobalAppsRaw] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(globalStorageKey);
      if (stored) return JSON.parse(stored) as Record<string, boolean>;
    } catch {}
    return Object.fromEntries(APP_LIST.map((a) => [a.id, false]));
  });

  const setGlobalApps = (updater: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    setGlobalAppsRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem(globalStorageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Project-level enable states — persisted per skillId in localStorage
  const storageKey = `skill-projects-${skill.id}`;
  const [projectEnables, setProjectEnablesRaw] = useState<ProjectEnableState[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return JSON.parse(stored) as ProjectEnableState[];
    } catch {}
    return [];
  });

  const setProjectEnables = (updater: ProjectEnableState[] | ((prev: ProjectEnableState[]) => ProjectEnableState[])) => {
    setProjectEnablesRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(skill.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const confirmDiscardSkillMdChanges = useCallback(() => {
    if (!isEditingSkillMd || !isSkillMdDirty) {
      return true;
    }

    return window.confirm("SKILL.md 有未保存的修改，确定要丢弃吗？");
  }, [isEditingSkillMd, isSkillMdDirty]);

  useEffect(() => {
    onRegisterLeaveGuard(confirmDiscardSkillMdChanges);
    return () => onRegisterLeaveGuard(null);
  }, [confirmDiscardSkillMdChanges, onRegisterLeaveGuard]);

  useEffect(() => {
    setTab("enable");
    setCopied(false);
    setPreviewingFile(null);
    setIsEditingSkillMd(false);
    setDraftContent(skill.content);
    setIsSkillMdDirty(false);
    setIsSavingSkillMd(false);
  }, [skill.id]);

  const handleSkillMdDraftChange = (value: string) => {
    setDraftContent(value);
    setIsSkillMdDirty(value !== skill.content);
  };

  const handleStartSkillMdEditing = () => {
    setDraftContent(skill.content);
    setIsSkillMdDirty(false);
    setIsEditingSkillMd(true);
  };

  const handleCancelSkillMdEditing = () => {
    if (!confirmDiscardSkillMdChanges()) {
      return;
    }

    setDraftContent(skill.content);
    setIsSkillMdDirty(false);
    setIsEditingSkillMd(false);
  };

  const handleSaveSkillMd = async () => {
    if (isSavingSkillMd) {
      return;
    }

    if (!isSkillMdDirty) {
      setIsEditingSkillMd(false);
      return;
    }

    setIsSavingSkillMd(true);
    const tid = toast.loading("正在保存 SKILL.md…");
    const result = await update({
      id: skill.id,
      content: draftContent,
    });
    setIsSavingSkillMd(false);

    if (result.ok) {
      setDraftContent(result.value.content);
      setIsSkillMdDirty(false);
      setIsEditingSkillMd(false);
      toast.resolve(tid, "success", "SKILL.md 已保存");
      return;
    }

    toast.resolve(tid, "error", formatSkillOperationError(result.error, "保存"));
  };

  const handleTabChange = (nextTab: Tab) => {
    if (nextTab === tab) {
      return;
    }

    if (!confirmDiscardSkillMdChanges()) {
      return;
    }

    if (isEditingSkillMd) {
      setDraftContent(skill.content);
      setIsSkillMdDirty(false);
      setIsEditingSkillMd(false);
    }

    setTab(nextTab);
  };

  const toggleGlobalApp = async (appId: string) => {
    const currentState = globalApps[appId] ?? false;
    const newState = !currentState;

    // Optimistically update UI
    setGlobalApps((prev) => ({ ...prev, [appId]: newState }));

    const appLabel = APP_LIST.find(a => a.id === appId)?.label ?? appId;
    const tid = newState
      ? toast.loading(`正在写入全局 ${appLabel}…`)
      : toast.loading(`正在移除全局 ${appLabel}…`);

    if (newState) {
      const result = await skillInstallGlobal({
        skillId: skill.id, apps: [appId],
      });
      if (result.ok) {
        toast.resolve(tid, "success", `已将 Skill 写入全局 ${appLabel}`);
      } else {
        toast.resolve(tid, "error", `写入失败：${result.error}`);
        setGlobalApps((prev) => ({ ...prev, [appId]: currentState }));
      }
    } else {
      const result = await skillUninstallGlobal({
        skillId: skill.id, apps: [appId],
      });
      if (result.ok) {
        toast.resolve(tid, "success", `已从全局 ${appLabel} 移除 Skill`);
      } else {
        toast.resolve(tid, "error", `移除失败：${result.error}`);
        setGlobalApps((prev) => ({ ...prev, [appId]: currentState }));
      }
    }
  };

  const toggleProjectApp = async (projectIdx: number, appId: string) => {
    const currentState = projectEnables[projectIdx]?.apps[appId] ?? false;
    const newState = !currentState;
    const project = projectEnables[projectIdx];
    if (!project) return;

    // Optimistically update UI
    setProjectEnables((prev) =>
      prev.map((p, i) => i !== projectIdx ? p : { ...p, apps: { ...p.apps, [appId]: newState } })
    );

    const appLabel = APP_LIST.find(a => a.id === appId)?.label ?? appId;
    const tid = newState
      ? toast.loading(`正在写入 ${appLabel}…`)
      : toast.loading(`正在移除 ${appLabel}…`);

    if (newState) {
      const result = await skillInstallToProject({
        skillId: skill.id, projectPath: project.projectPath, apps: [appId],
      });
      if (result.ok) {
        toast.resolve(tid, "success", `已将 Skill 写入 ${project.projectName} / ${appLabel}`);
      } else {
        toast.resolve(tid, "error", `写入失败：${result.error}`);
        setProjectEnables((prev) =>
          prev.map((p, i) => i !== projectIdx ? p : { ...p, apps: { ...p.apps, [appId]: currentState } })
        );
      }
    } else {
      const result = await skillUninstallFromProject({
        skillId: skill.id, projectPath: project.projectPath, apps: [appId],
      });
      if (result.ok) {
        toast.resolve(tid, "success", `已从 ${project.projectName} / ${appLabel} 移除 Skill`);
      } else {
        toast.resolve(tid, "error", `移除失败：${result.error}`);
        setProjectEnables((prev) =>
          prev.map((p, i) => i !== projectIdx ? p : { ...p, apps: { ...p.apps, [appId]: currentState } })
        );
      }
    }
  };

  const removeProjectEnable = async (projectIdx: number) => {
    const project = projectEnables[projectIdx];
    if (!project) return;

    const tid = toast.loading(`正在清理 ${project.projectName} 中的 Skill 文件…`);
    const allApps = APP_LIST.map((a) => a.id);
    const result = await projectRemoveCliFolders({ projectPath: project.projectPath, apps: allApps });

    if (result.ok) {
      toast.resolve(tid, "success", `已清理 ${project.projectName} 中的 Skill 文件`);
    } else {
      toast.resolve(tid, "error", `清理失败：${result.error}`);
    }
    setProjectEnables((prev) => prev.filter((_, i) => i !== projectIdx));
  };

  const addProjectEnable = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "选择项目文件夹" });
      if (selected) {
        const path = selected as string;
        const folderName = path.split(/[/\\]/).pop() || "未命名项目";
        setProjectEnables((prev) => [...prev, {
          projectId: `project-${Date.now()}`,
          projectName: folderName,
          projectPath: path,
          apps: Object.fromEntries(APP_LIST.map((a) => [a.id, false])),
        }]);
        toast.success(`已添加项目「${folderName}」`);
      }
    } catch (error) {
      console.error("Failed to open directory dialog:", error);
    }
  };

  return (
    <div className={s.detail}>
      {/* Header */}
      <div className={s.detailHeader}>
        <div className={s.detailTop}>
          <div
            className={s.detailIcon}
            style={{ background: iconColors.bg, color: iconColors.fg }}
          >
            <span>{initial}</span>
          </div>
          <div className={s.detailMeta}>
            <div className={s.detailNameRow}>
              <h2 className={s.detailName}>{skill.name}</h2>
            </div>
            <p className={s.detailDesc}>{skill.description || "无描述"}</p>
            <div className={s.detailMetaRow}>
              <span><GitBranch size={12} /> {skill.slug}</span>
              <span><Clock size={12} /> {formatDate(skill.updatedAt)}</span>
            </div>
          </div>
          <div className={s.detailActions}>
            <IconButton
              icon={<FileUp size={16} />}
              variant="default"
              title="导出 ZIP"
              onClick={onExport}
              aria-label="导出 ZIP"
            />
            <IconButton
              icon={<Camera size={16} />}
              title="手动备份快照"
              onClick={onSnapshot}
              aria-label="手动备份快照"
            />
            <IconButton
              icon={<Trash2 size={16} />}
              variant="danger"
              title="卸载"
              onClick={onDelete}
              aria-label={`卸载 ${skill.name}`}
            />
          </div>
        </div>
        {/* Tabs */}
        <div className={s.tabs}>
          {(["enable", "skillmd", "files"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`${s.tab} ${tab === t ? s.tabActive : ""}`}
              onClick={() => handleTabChange(t)}
            >
              {
                {
                  enable: "启用状态",
                  skillmd: "SKILL.md",
                  files: "目录",
                }[t]
              }
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className={s.detailBody}>
        {/* ── 启用状态 ── */}
        {tab === "enable" && (
          <div className={s.tabContent}>
            {/* 全局级别 */}
            <div className={s.enableSection}>
              <div className={s.enableSectionLabel}>
                <Globe size={14} /> 全局级别{" "}
                <span className={s.enableSectionHint}>(所有项目生效)</span>
              </div>
              <div className={s.globalApps}>
                {APP_LIST.map((a) => (
                  <label key={a.id} className={s.globalAppItem}>
                    <input
                      type="checkbox"
                      checked={!!globalApps[a.id]}
                      onChange={() => toggleGlobalApp(a.id)}
                      style={{ accentColor: a.accentColor }}
                    />
                    <div>
                      <div className={s.globalAppName}>{a.label}</div>
                      <div className={s.globalAppPath}>{a.skillPathLabel}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* 项目级别 */}
            <div className={s.enableSection}>
              <div className={s.enableSectionLabel}>
                <Folder size={14} /> 项目级别{" "}
                <span className={s.enableSectionHint}>(仅特定项目生效)</span>
                <button className={s.addProjectBtn} onClick={addProjectEnable}>
                  <Plus size={14} /> 添加项目
                </button>
              </div>
              <div className={s.projectList}>
                {projectEnables.map((proj, idx) => (
                  <div key={proj.projectId} className={s.projectItem}>
                    <div className={s.projectHeader}>
                      <div className={s.projectNameWrap}>
                        <span className={s.projectName}>{proj.projectName}</span>
                        <span className={s.projectPath}>{proj.projectPath}</span>
                      </div>
                      <IconButton
                        icon={<X size={14} />}
                        variant="danger"
                        size="sm"
                        className={s.removeProjectBtn}
                        onClick={() => removeProjectEnable(idx)}
                        aria-label={`移除项目 ${proj.projectName}`}
                        title="移除项目"
                      />
                    </div>
                    <div className={s.projectApps}>
                      {APP_LIST.map((a) => (
                        <label key={a.id} className={s.projectAppItem}>
                          <input
                            type="checkbox"
                            checked={!!proj.apps[a.id]}
                            onChange={() => toggleProjectApp(idx, a.id)}
                            style={{ accentColor: a.accentColor }}
                          />
                          <span>{a.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {projectEnables.length === 0 && (
                  <div className={s.noProjects}>
                    暂无项目级别配置，点击上方按钮添加
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SKILL.md ── */}
        {tab === "skillmd" && (
          <div className={s.skillmdWrap}>
            <div className={s.skillmdHeader}>
              <div className={s.skillmdMeta}>
                <span className={s.skillmdFilename}>SKILL.md</span>
                {isEditingSkillMd && isSkillMdDirty && (
                  <span className={s.skillmdStatus}>未保存</span>
                )}
              </div>
              <div className={s.skillmdActions}>
                {isEditingSkillMd ? (
                  <>
                    <button
                      className={`${s.skillmdActionBtn} ${s.skillmdActionSecondary}`}
                      onClick={handleCancelSkillMdEditing}
                      disabled={isSavingSkillMd}
                    >
                      取消
                    </button>
                    <button
                      className={`${s.skillmdActionBtn} ${s.skillmdActionPrimary}`}
                      onClick={handleSaveSkillMd}
                      disabled={isSavingSkillMd || !isSkillMdDirty}
                    >
                      {isSavingSkillMd ? <><Loader size={12} className={s.btnSpin} /> 保存中</> : "保存"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={`${s.skillmdActionBtn} ${s.skillmdActionSecondary}`}
                      onClick={handleStartSkillMdEditing}
                    >
                      编辑
                    </button>
                    <button
                      className={`${s.skillmdActionBtn} ${s.skillmdActionPrimary}`}
                      onClick={handleCopy}
                    >
                      {copied ? <><Check size={12} /> 已复制</> : "复制"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {isEditingSkillMd ? (
              <textarea
                className={s.skillmdEditor}
                value={draftContent}
                onChange={(e) => handleSkillMdDraftChange(e.target.value)}
                spellCheck={false}
              />
            ) : (
              <pre className={s.skillmdCode}>{skill.content}</pre>
            )}
          </div>
        )}

        {/* ── 目录浏览 ── */}
        {tab === "files" && (
          previewingFile ? (
            <FilePreview
              skill={skill}
              filePath={previewingFile}
              onBack={() => setPreviewingFile(null)}
            />
          ) : (
            <DirectoryBrowser
              skill={skill}
              onOpenFile={(path) => setPreviewingFile(path)}
            />
          )
        )}
      </div>
    </div>
  );
}

// ── Loading Skeleton ────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className={s.list}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={s.card}>
          <div className={s.cardContent}>
            <div className={s.skeletonIcon} />
            <div className={s.skeletonBody}>
              <div className={s.skeletonTitle} />
              <div className={s.skeletonDesc} />
              <div className={s.skeletonFooter} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Import Modal ────────────────────────────────────────────────────────────
function ImportModal({
  onClose,
  onImportFolder,
  onImportZip,
}: {
  onClose: () => void;
  onImportFolder: () => void;
  onImportZip: () => void;
}) {
  return (
    <div className={modalStyles.modalOverlay} onClick={onClose}>
      <div className={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={modalStyles.modalHeader}>
          <span className={modalStyles.modalTitle}>导入 Skill</span>
          <button className={modalStyles.modalClose} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className={modalStyles.modalBody}>
          <div className={s.importOptions}>
            <button className={s.importOption} onClick={onImportFolder}>
              <div className={s.importOptionIcon}>
                <FolderOpen size={24} />
              </div>
              <div className={s.importOptionText}>
                <div className={s.importOptionTitle}>导入文件夹</div>
                <div className={s.importOptionDesc}>选择包含 SKILL.md 的文件夹</div>
              </div>
            </button>
            <button className={s.importOption} onClick={onImportZip}>
              <div className={s.importOptionIcon}>
                <FileArchive size={24} />
              </div>
              <div className={s.importOptionText}>
                <div className={s.importOptionTitle}>导入 ZIP 包</div>
                <div className={s.importOptionDesc}>选择包含 Skill 文件夹的 ZIP 压缩包</div>
              </div>
            </button>
          </div>
          <div className={modalStyles.modalHint}>
            Skill 文件夹必须包含 SKILL.md 文件才能被正确识别
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main InstalledPage ───────────────────────────────────────────────────────
export function MyLibraryPage({ onNavigate, activeLibraryTab }: {
  onNavigate: (page: import("../App").PageId) => void;
  activeLibraryTab: LibraryGroupTab;
}) {
  const { skills, externalSkills, loading, error, search, remove, refresh } = useSkills();
  const { settings } = useSettings();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailLeaveGuardRef = useRef<DetailLeaveGuard | null>(null);

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      search(searchQuery);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, search]);

  const selectedSkill = activeLibraryTab === "external"
    ? null
    : skills.find((skill) => skill.id === selectedId) ?? null;

  const handleSnapshot = useCallback(() => {
    if (selectedSkill) toast.success(`「${selectedSkill.name}」快照已保存！`);
  }, [selectedSkill, toast]);

  const handleDelete = useCallback(async () => {
    if (selectedSkill) {
      const success = await remove(selectedSkill.id);
      if (success) {
        toast.success(`「${selectedSkill.name}」已卸载`);
        setSelectedId(skills[0]?.id ?? null);
      } else {
        toast.error("卸载失败");
      }
    }
  }, [selectedSkill, remove, skills, toast]);



  // Export handler
  const handleExport = useCallback(async () => {
    if (!selectedSkill) return;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择导出目录",
      });
      if (!selected) return;

      const exportPath = `${selected}/${selectedSkill.slug}.zip`;
      const tid = toast.loading("正在导出 ZIP...");

      const result = await skillExportToZip(selectedSkill.id, exportPath);
      if (result.ok) {
        toast.resolve(tid, "success", `「${selectedSkill.name}」已导出到 ${result.value}`);
      } else {
        toast.resolve(tid, "error", result.error);
      }
    } catch (e) {
      toast.error(`导出失败：${e}`);
    }
  }, [selectedSkill, toast]);

  // Import handlers
  const handleImportFolder = useCallback(async () => {
    setShowImportModal(false);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 Skill 文件夹",
      });
      if (!selected) return;

      setImporting(true);
      const tid = toast.loading("正在导入 Skill...");

      const result = await skillImportFromFolder(selected as string);
      setImporting(false);

      if (result.ok) {
        toast.resolve(tid, "success", `「${result.value.name}」导入成功`);
        refresh();
        setSelectedId(result.value.id);
      } else {
        toast.resolve(tid, "error", result.error);
      }
    } catch (e) {
      setImporting(false);
      toast.error(`导入失败：${e}`);
    }
  }, [refresh, toast]);

  const handleImportZip = useCallback(async () => {
    setShowImportModal(false);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
        title: "选择 Skill ZIP 包",
      });
      if (!selected) return;

      setImporting(true);
      const tid = toast.loading("正在解压并导入 Skill...");

      const result = await skillImportFromZip(selected as string);
      setImporting(false);

      if (result.ok) {
        toast.resolve(tid, "success", `「${result.value.name}」导入成功`);
        refresh();
        setSelectedId(result.value.id);
      } else {
        toast.resolve(tid, "error", result.error);
      }
    } catch (e) {
      setImporting(false);
      toast.error(`导入失败：${e}`);
    }
  }, [refresh, toast]);

  // Import external skill from app directory
  const handleImportExternal = useCallback(async (skill: ExternalSkill) => {
    setImporting(true);
    const tid = toast.loading(`正在导入「${skill.name}」...`);

    const result = await skillImportFromFolder(skill.path);
    setImporting(false);

    if (result.ok) {
      toast.resolve(tid, "success", `「${result.value.name}」已导入 SkillSwitch`);
      refresh();
      setSelectedId(result.value.id);
    } else {
      toast.resolve(tid, "error", result.error);
    }
  }, [refresh, toast]);

  // Separate self-created and third-party skills
  const thirdPartyRepos = settings.thirdPartyRepos ?? [];
  const selfCreated = skills.filter((skill) => !isThirdPartySkill(skill));
  const thirdParty = skills.filter(isThirdPartySkill);

  const filteredSkills = searchQuery.trim()
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      )
    : skills;

  const filteredSelfCreated = filteredSkills.filter((skill) => !isThirdPartySkill(skill));
  const filteredThirdParty = filteredSkills.filter(isThirdPartySkill);
  const filteredExternal = searchQuery.trim()
    ? externalSkills.filter((skill) => {
        const query = searchQuery.toLowerCase();
        const appLabel = getAppMeta(skill.appId)?.label.toLowerCase() ?? "";
        return skill.name.toLowerCase().includes(query)
          || skill.slug.toLowerCase().includes(query)
          || (skill.description?.toLowerCase().includes(query) ?? false)
          || appLabel.includes(query);
      })
    : externalSkills;
  const isSearching = searchQuery.trim().length > 0;

  const activeManagedSkills = activeLibraryTab === "self-created"
    ? selfCreated
    : activeLibraryTab === "third-party"
      ? thirdParty
      : [];

  useEffect(() => {
    if (activeLibraryTab === "external") return;

    if (activeManagedSkills.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }

    const selectedStillVisible = activeManagedSkills.some((skill) => skill.id === selectedId);
    if (!selectedStillVisible) {
      setSelectedId(activeManagedSkills[0].id);
    }
  }, [activeLibraryTab, activeManagedSkills, selectedId]);

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  }, []);

  const isGroupCollapsed = useCallback(
    (groupKey: string) => !isSearching && !!collapsedGroups[groupKey],
    [collapsedGroups, isSearching]
  );

  const registerDetailLeaveGuard = useCallback((guard: DetailLeaveGuard | null) => {
    detailLeaveGuardRef.current = guard;
  }, []);

  const canLeaveDetail = useCallback(() => {
    return detailLeaveGuardRef.current?.() ?? true;
  }, []);

  const handleSelectManagedSkill = useCallback((skillId: string) => {
    if (skillId === selectedId) {
      return;
    }

    if (!canLeaveDetail()) {
      return;
    }

    setSelectedId(skillId);
  }, [canLeaveDetail, selectedId]);

  const thirdPartyGroups = (() => {
    const grouped = new Map<string, Skill[]>();
    for (const skill of filteredThirdParty) {
      const repoId = getRemoteRepoId(skill) ?? "__unknown__";
      const current = grouped.get(repoId) ?? [];
      current.push(skill);
      grouped.set(repoId, current);
    }

    const ordered = thirdPartyRepos
      .map((repo) => ({
        key: repo.id,
        title: repo.label,
        skills: grouped.get(repo.id) ?? [],
      }))
      .filter((group) => group.skills.length > 0);

    const unknownSkills = grouped.get("__unknown__") ?? [];
    if (unknownSkills.length > 0) {
      ordered.push({
        key: "__unknown__",
        title: "第三方",
        skills: unknownSkills,
      });
    }

    return ordered;
  })();

  const externalGroups = APP_LIST.map((app) => ({
    key: app.id,
    title: app.label,
    iconSrc: app.iconSrc,
    hint: app.skillPathLabel,
    skills: filteredExternal.filter((skill) => skill.appId === app.id),
  })).filter((group) => group.skills.length > 0);

  const renderActiveTabContent = () => {
    if (activeLibraryTab === "self-created") {
      if (filteredSelfCreated.length === 0) {
        return (
          <div className={s.empty}>
            {searchQuery ? "自建 Skills 中未找到匹配项" : "还没有自建 Skill，点击「创建」试试"}
          </div>
        );
      }

      return filteredSelfCreated.map((skill) => (
        <SkillCard
          key={skill.id}
          skill={skill}
          selected={selectedId === skill.id}
          originLabel=""
          onClick={() => handleSelectManagedSkill(skill.id)}
        />
      ));
    }

    if (activeLibraryTab === "third-party") {
      if (thirdPartyGroups.length === 0) {
        return (
          <div className={s.empty}>
            {searchQuery ? "第三方 Skills 中未找到匹配项" : "还没有第三方 Skill，可从仓库源安装"}
          </div>
        );
      }

      return thirdPartyGroups.map((group) => (
        <GroupSection
          key={group.key}
          title={group.title}
          count={group.skills.length}
          collapsed={isGroupCollapsed(`third-party:${group.key}`)}
          onToggle={() => toggleGroup(`third-party:${group.key}`)}
          nested
        >
          {group.skills.map((skill) => {
            const { label } = getRemoteSource(skill, thirdPartyRepos);
            return (
              <SkillCard
                key={skill.id}
                skill={skill}
                selected={selectedId === skill.id}
                originLabel={label}
                onClick={() => handleSelectManagedSkill(skill.id)}
              />
            );
          })}
        </GroupSection>
      ));
    }

    if (filteredExternal.length === 0) {
      return (
        <div className={s.empty}>
          {searchQuery ? "外部 Skills 中未找到匹配项" : "还没有发现可导入的外部 Skills"}
        </div>
      );
    }

    return externalGroups.map((group) => (
      <GroupSection
        key={group.key}
        title={
          <span className={s.externalGroupTitle}>
            <span className={s.externalGroupName}>{group.title}</span>
            <span className={s.externalGroupHint}>{group.hint}</span>
          </span>
        }
        count={group.skills.length}
        collapsed={isGroupCollapsed(`external:${group.key}`)}
        onToggle={() => toggleGroup(`external:${group.key}`)}
        icon={
          <span className={s.externalGroupIcon}>
            <img src={group.iconSrc} alt="" className={s.externalGroupIconImage} />
          </span>
        }
      >
        {group.skills.map((skill) => (
          <ExternalSkillCard
            key={`${skill.appId}:${skill.slug}`}
            skill={skill}
            onImport={() => handleImportExternal(skill)}
          />
        ))}
      </GroupSection>
    ));
  };

  return (
    <div className={s.page}>
      {/* ── Header ── */}
      <header className={s.header}>
        <div className={s.headerLeft}>
          <h1 className={s.headerTitle}>我的库</h1>
          <span className={s.headerSub}>
            {selfCreated.length} 个自建 · {thirdParty.length} 个三方
            {externalSkills.length > 0 && ` · ${externalSkills.length} 个外部候选`}
          </span>
        </div>
        <div className={s.headerRight}>
          <div className={s.searchWrap}>
            <Search size={14} className={s.searchIcon} />
            <input
              className={s.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 Skills..."
            />
          </div>
          <button className={s.importBtn} onClick={() => setShowImportModal(true)} disabled={importing}>
            {importing ? <><Loader size={12} className={s.btnSpin} /> 导入中</> : "导入"}
          </button>
          <button className={s.createBtn} onClick={() => onNavigate("create")}>
            <Plus size={14} /> 创建 Skill
          </button>
        </div>
      </header>

      {/* ── Error Banner ── */}
      {error && (
        <div className={s.errorBanner}>
          <span><AlertTriangle size={14} /> {error}</span>
          <button onClick={() => window.location.reload()}>重试</button>
        </div>
      )}

      {/* ── Body: list + detail ── */}
      <div className={s.body}>
        {/* Left: card list */}
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <div className={s.list}>
            <div className={s.groupTabPanel}>
              {renderActiveTabContent()}
            </div>
          </div>
        )}

        {/* Right: detail panel */}
        {selectedSkill && (
          <DetailPanel
            key={selectedSkill.id}
            skill={selectedSkill}
            onSnapshot={handleSnapshot}
            onDelete={handleDelete}
            onExport={handleExport}
            onRegisterLeaveGuard={registerDetailLeaveGuard}
          />
        )}
        {!selectedSkill && activeLibraryTab === "external" && (
          <div className={s.detailPlaceholder}>
            <div className={s.detailPlaceholderIcon}>
              <ExternalLink size={18} />
            </div>
            <div className={s.detailPlaceholderTitle}>外部 Skills</div>
            <div className={s.detailPlaceholderHint}>
              这里按 CLI 分组展示从各个技能目录里发现的可导入项。点击左侧卡片即可把外部 Skill 纳入 SkillSwitch 管理。
            </div>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onImportFolder={handleImportFolder}
          onImportZip={handleImportZip}
        />
      )}
    </div>
  );
}
