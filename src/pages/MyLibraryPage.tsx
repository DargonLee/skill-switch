import { useState, useEffect, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import {
  X,
  Search,
  Trash2,
  GitBranch,
  Clock,
  Globe,
  Folder,
  Plus,
  AlertTriangle,
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
import { useToast } from "../components/ui/Toast";
import {
  skillInstallToProject,
  skillUninstallFromProject,
  projectRemoveCliFolders,
  skillInstallGlobal,
  skillUninstallGlobal,
  skillImportFromDialog,
  skillImportFromFolder,
  skillExportToZip,
  skillListDirectory,
  skillReadFile,
  skillShowInFinder,
  openWithTypora,
} from "../services/skill";
import { IconButton } from "../components/ui/IconButton";
import type { Skill, SkillDirectoryListing, SkillDirectoryEntry, SkillFileContent, ExternalSkill, Provenance } from "../types";
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

// Get provenance badge label
function getProvenanceBadge(provenance?: Provenance): string {
  if (!provenance) return "";
  switch (provenance.kind) {
    case "manual": return "";
    case "file-import": return "导入";
    case "external-app": return provenance.label || "外部导入";
    case "marketplace": return "市场导入";
    case "repo-source": return provenance.sourceName ? `仓库源 · ${provenance.sourceName}` : "仓库源导入";
    default: return "";
  }
}

function getAppMeta(appId: string) {
  return APP_LIST.find((app) => app.id === appId) ?? null;
}

interface ExternalImportPreviewState {
  skill: ExternalSkill;
  entries: Array<{ name: string; kind: "file" | "directory"; isSymlink: boolean }>;
  duplicateSkill: Skill | null;
}

// ── Skill Card (left list) ───────────────────────────────────────────────────
function SkillCard({
  skill,
  selected,
  onClick,
}: {
  skill: Skill;
  selected: boolean;
  onClick: () => void;
}) {
  const iconColors = getIconColors(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();
  const badge = getProvenanceBadge(skill.provenance);

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
            {badge && (
              <span className={s.cardBadge}>
                <Globe size={10} /> {badge}
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
  selected,
  onImport,
  onClick,
}: {
  skill: ExternalSkill;
  selected?: boolean;
  onImport: () => void;
  onClick?: () => void;
}) {
  const iconColors = getIconColors(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();

  return (
    <div className={`${s.card} ${s.cardExternal} ${selected ? s.cardSelected : ""}`} onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
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

// ── External Detail Panel (read-only) ────────────────────────────────────────
function ExternalDetailPanel({
  skill,
  onImport,
}: {
  skill: ExternalSkill;
  onImport: () => void;
}) {
  const iconColors = getIconColors(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();
  const appMeta = getAppMeta(skill.appId);

  return (
    <aside className={s.detail}>
      <div className={s.detailInner}>
        {/* Header */}
        <div className={s.detailHero}>
          <div
            className={s.detailIcon}
            style={{ background: iconColors.bg, color: iconColors.fg }}
          >
            <span>{initial}</span>
          </div>
          <div className={s.detailHeroText}>
            <h2 className={s.detailName}>{skill.name}</h2>
            <span className={s.detailSlug}>{skill.slug}</span>
          </div>
        </div>

        {/* Meta info */}
        <div className={s.externalDetailMeta}>
          {appMeta && (
            <div className={s.externalDetailRow}>
              <span className={s.externalDetailLabel}>来源</span>
              <span className={s.externalDetailValue}>
                <img src={appMeta.iconSrc} alt="" style={{ width: 14, height: 14, borderRadius: 3, verticalAlign: -2 }} />
                {" "}{appMeta.label}
              </span>
            </div>
          )}
          <div className={s.externalDetailRow}>
            <span className={s.externalDetailLabel}>路径</span>
            <span className={s.externalDetailValue} style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>{skill.path}</span>
          </div>
          {skill.isSymlink && (
            <div className={s.externalDetailRow}>
              <span className={s.externalDetailLabel}>类型</span>
              <span className={s.externalDetailValue}>符号链接{skill.symlinkTarget ? ` → ${skill.symlinkTarget}` : ""}</span>
            </div>
          )}
        </div>

        {/* Description */}
        {skill.description && (
          <div className={s.externalDetailDesc}>
            <p>{skill.description}</p>
          </div>
        )}

        {/* Import action */}
        <button className={s.externalDetailImportBtn} onClick={onImport}>
          <Download size={14} /> 导入到 SkillSwitch
        </button>
      </div>
    </aside>
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
type LibraryGroupTab = "self-created" | "external";

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
  onDelete,
  onExport,
}: {
  skill: Skill;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [tab, setTab] = useState<Tab>("enable");
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);
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

  useEffect(() => {
    setTab("enable");
    setPreviewingFile(null);
  }, [skill.id]);

  const handleTabChange = (nextTab: Tab) => {
    if (nextTab === tab) {
      return;
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
              icon={<ExternalLink size={16} />}
              variant="default"
              title="在 Finder 中显示"
              onClick={async () => {
                const result = await skillShowInFinder(skill.id);
                if (!result.ok) {
                  toast.error("无法打开 Finder");
                }
              }}
              aria-label="在 Finder 中显示"
            />
            <IconButton
              icon={<FileUp size={16} />}
              variant="default"
              title="导出 ZIP"
              onClick={onExport}
              aria-label="导出 ZIP"
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
              </div>
              <div className={s.skillmdActions}>
                <button
                  className={`${s.skillmdActionBtn} ${s.skillmdActionPrimary}`}
                  onClick={() => openWithTypora(skill.id)}
                >
                  用Typora打开
                </button>
              </div>
            </div>
            <pre className={s.skillmdCode}>{skill.content}</pre>
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
// ── Main InstalledPage ───────────────────────────────────────────────────────
export function MyLibraryPage({ onNavigate, activeLibraryTab, externalAppFilter }: {
  onNavigate: (page: import("../App").PageId) => void;
  activeLibraryTab: LibraryGroupTab;
  externalAppFilter: string | null;
}) {
  const { skills, externalSkills, loading, error, search, remove, refresh } = useSkills();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedExternalKey, setSelectedExternalKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [externalImportPreview, setExternalImportPreview] = useState<ExternalImportPreviewState | null>(null);
  const [loadingExternalPreview, setLoadingExternalPreview] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const selectedExternal = activeLibraryTab === "external" && selectedExternalKey
    ? externalSkills.find((sk) => `${sk.appId}:${sk.slug}` === selectedExternalKey) ?? null
    : null;

  const handleDelete = useCallback(async () => {
    if (selectedSkill) {
      const tid = toast.loading(`正在卸载「${selectedSkill.name}」…`);
      const success = await remove(selectedSkill.id);
      if (success) {
        toast.resolve(tid, "success", `「${selectedSkill.name}」已卸载`);
        setSelectedId(skills[0]?.id ?? null);
      } else {
        toast.resolve(tid, "error", "卸载失败");
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

  const handleImport = useCallback(async () => {
    if (importing) {
      return;
    }

    setImporting(true);
    const tid = toast.loading("请选择 Skill 文件夹或 ZIP 包...");

    try {
      const result = await skillImportFromDialog();

      if (!result.ok) {
        toast.resolve(tid, "error", result.error);
        return;
      }

      if (!result.value) {
        toast.dismiss(tid);
        return;
      }

      toast.resolve(tid, "success", `「${result.value.name}」导入成功`);
      await refresh();
      setSelectedId(result.value.id);
    } catch (error) {
      toast.resolve(tid, "error", `导入失败：${String(error)}`);
    } finally {
      setImporting(false);
    }
  }, [importing, refresh, toast]);

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

  const handlePreviewExternalImport = useCallback(async (skill: ExternalSkill) => {
    setLoadingExternalPreview(true);
    try {
      const entries = await readDir(skill.path);
      const previewEntries = entries
        .filter((entry) => !!entry.name && !entry.name.startsWith("."))
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory ? "directory" as const : "file" as const,
          isSymlink: entry.isSymlink,
        }))
        .sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "directory" ? -1 : 1;
          }
          return left.name.localeCompare(right.name, "zh-CN");
        });

      setExternalImportPreview({
        skill,
        entries: previewEntries,
        duplicateSkill: skills.find((managedSkill) => managedSkill.slug === skill.slug) ?? null,
      });
    } catch (error) {
      toast.error(`读取导入预览失败：${String(error)}`);
    } finally {
      setLoadingExternalPreview(false);
    }
  }, [skills, toast]);

  // Separate self-created and external skills
  const filteredSkills = searchQuery.trim()
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      )
    : skills;

  const filteredSelfCreated = filteredSkills;

  // Apply externalAppFilter first, then search query
  const appFilteredExternal = externalAppFilter
    ? externalSkills.filter((skill) => skill.appId === externalAppFilter)
    : externalSkills;
  const filteredExternal = searchQuery.trim()
    ? appFilteredExternal.filter((skill) => {
        const query = searchQuery.toLowerCase();
        const appLabel = getAppMeta(skill.appId)?.label.toLowerCase() ?? "";
        return skill.name.toLowerCase().includes(query)
          || skill.slug.toLowerCase().includes(query)
          || (skill.description?.toLowerCase().includes(query) ?? false)
          || appLabel.includes(query);
      })
    : appFilteredExternal;
  const activeManagedSkills = activeLibraryTab === "self-created"
    ? skills
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

  useEffect(() => {
    if (activeLibraryTab !== "external" || !externalAppFilter) {
      if (selectedExternalKey !== null) {
        setSelectedExternalKey(null);
      }
      return;
    }

    if (filteredExternal.length === 0) {
      if (selectedExternalKey !== null) {
        setSelectedExternalKey(null);
      }
      return;
    }

    const selectedStillVisible = filteredExternal.some(
      (skill) => `${skill.appId}:${skill.slug}` === selectedExternalKey
    );

    if (!selectedStillVisible) {
      setSelectedExternalKey(`${filteredExternal[0].appId}:${filteredExternal[0].slug}`);
    }
  }, [activeLibraryTab, externalAppFilter, filteredExternal, selectedExternalKey]);

  const handleSelectManagedSkill = useCallback((skillId: string) => {
    if (skillId === selectedId) {
      return;
    }

    setSelectedId(skillId);
  }, [selectedId]);

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
          onClick={() => handleSelectManagedSkill(skill.id)}
        />
      ));
    }

    if (!externalAppFilter) {
      return (
        <div className={s.empty}>
          从左侧二级列表选择一个 CLI 来源后，这里会显示对应的外部 Skills。
        </div>
      );
    }

    if (filteredExternal.length === 0) {
      return (
        <div className={s.empty}>
          {searchQuery ? "外部 Skills 中未找到匹配项" : "还没有发现可导入的外部 Skills"}
        </div>
      );
    }

    return filteredExternal.map((skill) => {
      const key = `${skill.appId}:${skill.slug}`;
      return (
        <ExternalSkillCard
          key={key}
          skill={skill}
          selected={selectedExternalKey === key}
          onClick={() => setSelectedExternalKey(key)}
          onImport={() => handlePreviewExternalImport(skill)}
        />
      );
    });
  };

  return (
    <div className={s.page}>
      {/* ── Header ── */}
      <header className={s.header}>
        <div className={s.headerLeft}>
          <h1 className={s.headerTitle}>
            {activeLibraryTab === "self-created" ? "自建 Skills" : "外部 Skills"}
          </h1>
          <span className={s.headerSub}>
            {activeLibraryTab === "self-created" && `${filteredSelfCreated.length} 个`}
            {activeLibraryTab === "external" && `${filteredExternal.length} 个`}
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
          <button className={s.importBtn} onClick={() => void handleImport()} disabled={importing}>
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
            onDelete={handleDelete}
            onExport={handleExport}
          />
        )}
        {!selectedSkill && activeLibraryTab === "external" && selectedExternal && (
          <ExternalDetailPanel
            key={`${selectedExternal.appId}:${selectedExternal.slug}`}
            skill={selectedExternal}
            onImport={() => handlePreviewExternalImport(selectedExternal)}
          />
        )}
        {!selectedSkill && activeLibraryTab === "external" && !selectedExternal && (
          <div className={s.detailPlaceholder}>
            <div className={s.detailPlaceholderIcon}>
              <ExternalLink size={18} />
            </div>
            <div className={s.detailPlaceholderTitle}>外部 Skills</div>
            <div className={s.detailPlaceholderHint}>
              从左侧二级列表选择一个 CLI 来源，再查看并导入该目录下发现的外部 Skill。
            </div>
          </div>
        )}
      </div>
      {externalImportPreview && (
        <ExternalImportPreviewModal
          preview={externalImportPreview}
          importing={importing}
          loading={loadingExternalPreview}
          onClose={() => setExternalImportPreview(null)}
          onConfirm={async () => {
            await handleImportExternal(externalImportPreview.skill);
            setExternalImportPreview(null);
          }}
        />
      )}
    </div>
  );
}

function ExternalImportPreviewModal({
  preview,
  importing,
  loading,
  onClose,
  onConfirm,
}: {
  preview: ExternalImportPreviewState;
  importing: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const appMeta = getAppMeta(preview.skill.appId);

  return (
    <div className={modalStyles.modalOverlay} onClick={onClose}>
      <div className={`${modalStyles.modal} ${s.externalPreviewModal}`} onClick={(event) => event.stopPropagation()}>
        <div className={modalStyles.modalHeader}>
          <span className={modalStyles.modalTitle}>导入前预览</span>
          <button className={modalStyles.modalClose} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className={modalStyles.modalBody}>
          <div className={s.externalPreviewMeta}>
            <div className={s.externalPreviewRow}>
              <span className={s.externalPreviewLabel}>Skill</span>
              <span className={s.externalPreviewValue}>{preview.skill.name} · {preview.skill.slug}</span>
            </div>
            {appMeta && (
              <div className={s.externalPreviewRow}>
                <span className={s.externalPreviewLabel}>来源</span>
                <span className={s.externalPreviewValue}>{appMeta.label}</span>
              </div>
            )}
            <div className={s.externalPreviewRow}>
              <span className={s.externalPreviewLabel}>路径</span>
              <span className={`${s.externalPreviewValue} ${s.externalPreviewPath}`}>{preview.skill.path}</span>
            </div>
            <div className={s.externalPreviewRow}>
              <span className={s.externalPreviewLabel}>符号链接</span>
              <span className={s.externalPreviewValue}>
                {preview.skill.isSymlink ? `是${preview.skill.symlinkTarget ? ` → ${preview.skill.symlinkTarget}` : ""}` : "否"}
              </span>
            </div>
          </div>

          {preview.duplicateSkill && (
            <div className={s.externalPreviewWarning}>
              <AlertTriangle size={14} />
              <span>当前库中已存在同 slug 的 Skill：{preview.duplicateSkill.name}。继续导入可能失败或需要重命名。</span>
            </div>
          )}

          <div className={s.externalPreviewSection}>
            <div className={s.externalPreviewSectionTitle}>即将导入的顶层文件</div>
            {loading ? (
              <div className={s.externalPreviewEmpty}>正在读取目录...</div>
            ) : preview.entries.length > 0 ? (
              <div className={s.externalPreviewList}>
                {preview.entries.map((entry) => (
                  <div key={entry.name} className={s.externalPreviewEntry}>
                    {entry.kind === "directory" ? <Folder size={13} /> : <File size={13} />}
                    <span className={s.externalPreviewEntryName}>{entry.name}</span>
                    <span className={s.externalPreviewEntryMeta}>
                      {entry.kind === "directory" ? "目录" : "文件"}{entry.isSymlink ? " · 符号链接" : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={s.externalPreviewEmpty}>目录为空或没有可展示的文件。</div>
            )}
          </div>

          <div className={s.externalPreviewActions}>
            <button className={s.previewCancelBtn} onClick={onClose} disabled={importing}>取消</button>
            <button className={s.previewConfirmBtn} onClick={() => void onConfirm()} disabled={importing || loading}>
              {importing ? <><Loader size={14} className={s.btnSpin} /> 导入中...</> : <><Download size={14} /> 确认导入</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
