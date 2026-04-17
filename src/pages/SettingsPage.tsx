import { useState, useCallback, useEffect } from "react";
import {
  Folder, Github,
  Languages, HardDrive, Palette, AlertTriangle,
  Terminal, Upload, Download, Info, X, RefreshCw,
} from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useSource } from "../context/SourceContext";
import { useSkills } from "../context/SkillContext";
import { useUpdater } from "../context/UpdaterContext";
import {
  BACKUP_SOURCE_REPO_ID,
  backupSourceConnect,
  backupSourcePull,
  backupSourcePush,
} from "../services/backupSource";
import { showInFinder } from "../services/skill";
import type { BackupSource, BackupSourceStatus } from "../types";
import s from "./SettingsPage.module.css";

function formatSyncTime(ts?: number | null): string {
  if (!ts) return "未同步";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type BackupSourceDraft = {
  enabled: boolean;
  remoteUrl: string;
  branch: string;
  localPath?: string | null;
  lastSyncedAt?: number | null;
};

const DEFAULT_BACKUP_SOURCE_DRAFT: BackupSourceDraft = {
  enabled: false,
  remoteUrl: "git@github.com:DargonLee/My-Skills.git",
  branch: "main",
  localPath: null,
  lastSyncedAt: null,
};

function normalizeBackupSource(source: BackupSource | null | undefined): BackupSourceDraft {
  if (!source) {
    return { ...DEFAULT_BACKUP_SOURCE_DRAFT };
  }

  return {
    enabled: source.enabled,
    remoteUrl: source.remoteUrl.trim(),
    branch: source.branch.trim() || "main",
    localPath: source.localPath ?? null,
    lastSyncedAt: source.lastSyncedAt ?? null,
  };
}

function parseRepoFromRemoteUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return "";

  const sshPrefix = "git@github.com:";
  if (trimmed.startsWith(sshPrefix)) {
    return trimmed.slice(sshPrefix.length).replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  }

  const sshUrlPrefix = "ssh://git@github.com/";
  if (trimmed.startsWith(sshUrlPrefix)) {
    return trimmed.slice(sshUrlPrefix.length).replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  }

  return "";
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`${s.toggle} ${checked ? s.toggleOn : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={`${s.toggleThumb} ${checked ? s.toggleThumbOn : ""}`} />
    </button>
  );
}

export function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { refresh: refreshSources } = useSource();
  const { refresh: refreshSkills } = useSkills();
  const { currentVersion, isChecking, checkForUpdates } = useUpdater();
  const [toast, setToast] = useState<string | null>(null);
  const [backupDraft, setBackupDraft] = useState<BackupSourceDraft>(() => normalizeBackupSource(settings.backupSource));
  const [backupAction, setBackupAction] = useState<"test" | "push" | "pull" | null>(null);
  const [showBackupGuide, setShowBackupGuide] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  useEffect(() => {
    setBackupDraft(normalizeBackupSource(settings.backupSource));
  }, [settings.backupSource]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  const handleBackupDraftChange = useCallback(<K extends keyof BackupSourceDraft>(
    key: K,
    value: BackupSourceDraft[K]
  ) => {
    setBackupDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSettingChange = useCallback(async (key: keyof Pick<
    typeof settings,
    "theme" | "locale" | "autoCheckUpdates" | "autoStart" | "backupPath" | "maxBackups"
  >, value: string | boolean | number | null) => {
    const success = await updateSettings({ [key]: value } as Partial<typeof settings>);
    if (!success) {
      showToast("设置保存失败");
    }
  }, [settings, showToast, updateSettings]);

  const syncBackupDraftFromStatus = useCallback((status: BackupSourceStatus) => {
    const nextSource: BackupSource = {
      enabled: status.enabled,
      repo: status.repo,
      label: status.label,
      remoteUrl: status.remoteUrl,
      branch: status.branch,
      localPath: status.localPath ?? null,
      lastSyncedAt: status.lastSyncedAt ?? null,
    };
    setBackupDraft(normalizeBackupSource(nextSource));
    return nextSource;
  }, []);

  const buildBackupToast = useCallback((message: string, notice?: string | null) => {
    return notice ? `${message}；${notice}` : message;
  }, []);

  const persistBackupSource = useCallback(async (showSuccessToast: boolean) => {
    const remoteUrl = backupDraft.remoteUrl.trim();
    const repo = parseRepoFromRemoteUrl(remoteUrl);
    const branch = backupDraft.branch.trim() || "main";

    if (!repo) {
      showToast("请输入 GitHub SSH 地址，例如 git@github.com:owner/repo.git");
      return null;
    }
    if (!remoteUrl.startsWith("git@github.com:") && !remoteUrl.startsWith("ssh://git@github.com/")) {
      showToast("请使用 GitHub SSH 地址，例如 git@github.com:owner/repo.git");
      return null;
    }

    const nextSource: BackupSource = {
      enabled: backupDraft.enabled,
      repo,
      label: repo,
      remoteUrl,
      branch,
      localPath: backupDraft.localPath ?? null,
      lastSyncedAt: backupDraft.lastSyncedAt ?? null,
    };

    const success = await updateSettings({ backupSource: nextSource });
    if (success) {
      setBackupDraft(normalizeBackupSource(nextSource));
      if (showSuccessToast) {
        showToast("备份源已保存");
      }
      return nextSource;
    } else {
      showToast("备份源保存失败");
      return null;
    }
  }, [backupDraft, showToast, updateSettings]);

  const handleBackupSourceAction = useCallback(async (action: "test" | "push" | "pull") => {
    const savedSource = await persistBackupSource(false);
    if (!savedSource) {
      return;
    }

    setBackupAction(action);

    const connectResult = await backupSourceConnect();
    if (!connectResult.ok) {
      showToast(`连接失败：${connectResult.error}`);
      setBackupAction(null);
      return;
    }

    const connectedSource = syncBackupDraftFromStatus(connectResult.value);
    const connectSaved = await updateSettings({ backupSource: connectedSource });
    if (!connectSaved) {
      showToast("连接状态保存失败");
      setBackupAction(null);
      return;
    }
    refreshSources(BACKUP_SOURCE_REPO_ID);
    await refreshSkills();

    if (action === "test") {
      showToast(buildBackupToast("备份源已连接", connectResult.value.notice));
      setBackupAction(null);
      return;
    }

    const syncResult = action === "push" ? await backupSourcePush() : await backupSourcePull();
    if (!syncResult.ok) {
      showToast(`${action === "push" ? "推送" : "拉取"}失败：${syncResult.error}`);
      setBackupAction(null);
      return;
    }

    const syncedSource = syncBackupDraftFromStatus(syncResult.value);
    const syncSaved = await updateSettings({ backupSource: syncedSource });
    if (!syncSaved) {
      showToast("同步状态保存失败");
      setBackupAction(null);
      return;
    }

    refreshSources(BACKUP_SOURCE_REPO_ID);
    await refreshSkills();
    showToast(
      buildBackupToast(
        action === "push" ? "备份已推送到 GitHub" : "已从 GitHub 拉取最新备份",
        syncResult.value.notice
      )
    );
    setBackupAction(null);
  }, [
    buildBackupToast,
    persistBackupSource,
    refreshSkills,
    refreshSources,
    showToast,
    syncBackupDraftFromStatus,
    updateSettings,
  ]);

  const handleOpenBackupFolder = useCallback(async () => {
    if (!settings.backupPath) {
      showToast("备份目录正在加载");
      return;
    }

    const result = await showInFinder(settings.backupPath);
    if (!result.ok) {
      showToast("备份目录还没有生成，请先创建一次备份");
    }
  }, [settings.backupPath, showToast]);

  const lang = settings.locale === "zh-CN" ? "简体中文" : settings.locale === "en-US" ? "English" : "繁體中文";
  const theme =
    settings.theme === "light"
      ? "浅色"
      : settings.theme === "dark"
      ? "深色"
      : "跟随系统";

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>设置</h1>
      </header>
      <div className={s.body}>
        <div className={s.inner}>
          {/* 通用 */}
          <section className={s.card} data-section="general">
            <div className={s.cardHeader}>
              <div className={s.cardTitleWrap}>
                <div className={s.cardTitleIcon}>
                  <Languages size={15} />
                </div>
                <h2 className={s.cardTitle}>通用</h2>
              </div>
            </div>
            <div className={s.rows}>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>界面语言</div>
                  <div className={s.rowHint}>切换显示语言</div>
                </div>
                <select
                  className={s.select}
                  value={lang}
                  onChange={(e) => {
                    const locale =
                      e.target.value === "简体中文"
                        ? "zh-CN"
                        : e.target.value === "English"
                        ? "en-US"
                        : "zh-TW";
                    handleSettingChange("locale", locale);
                  }}
                >
                  <option>简体中文</option>
                  <option>English</option>
                  <option>繁體中文</option>
                </select>
              </div>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>自动检查更新</div>
                  <div className={s.rowHint}>启动时从仓库源拉取最新版本信息</div>
                </div>
                <Toggle
                  checked={settings.autoCheckUpdates}
                  onChange={(v) => handleSettingChange("autoCheckUpdates", v)}
                />
              </div>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>开机自启</div>
                  <div className={s.rowHint}>登录后自动在后台运行</div>
                </div>
                <Toggle
                  checked={settings.autoStart}
                  onChange={(v) => handleSettingChange("autoStart", v)}
                />
              </div>
            </div>
          </section>

          {/* 应用更新 */}
          <section className={s.card} data-section="updates">
            <div className={s.cardHeader}>
              <div className={s.cardTitleWrap}>
                <div className={s.cardTitleIcon}>
                  <RefreshCw size={15} />
                </div>
                <h2 className={s.cardTitle}>应用更新</h2>
              </div>
            </div>
            <div className={s.rows}>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>自动检查应用更新</div>
                  <div className={s.rowHint}>启动时检查 SkillSwitch 新版本</div>
                </div>
                <Toggle
                  checked={settings.autoCheckAppUpdates ?? true}
                  onChange={(v) => updateSettings({ autoCheckAppUpdates: v })}
                />
              </div>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>当前版本</div>
                  <div className={s.rowHint + " " + s.mono}>v{currentVersion || "加载中..."}</div>
                </div>
                <button
                  className={s.btn}
                  onClick={async () => {
                    setIsCheckingUpdate(true);
                    await checkForUpdates(false);
                    setIsCheckingUpdate(false);
                  }}
                  disabled={isCheckingUpdate || isChecking}
                >
                  {isCheckingUpdate || isChecking ? (
                    <>检查中...</>
                  ) : (
                    <><RefreshCw size={12} /> 检查更新</>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* 备份 */}
          <section className={s.card} data-section="backup">
            <div className={s.cardHeader}>
              <div className={s.cardTitleWrap}>
                <div className={s.cardTitleIcon}>
                  <HardDrive size={15} />
                </div>
                <h2 className={s.cardTitle}>备份</h2>
              </div>
            </div>
            <div className={s.rows}>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>备份文件夹</div>
                  <div className={s.rowHint + " " + s.mono}>
                    {settings.backupPath || "加载中…"}
                  </div>
                  <div className={s.rowHint}>当前版本固定写入应用数据目录</div>
                </div>
                <button className={s.btn} onClick={handleOpenBackupFolder}>
                  <Folder size={14} /> 查看
                </button>
              </div>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>最大保留备份数</div>
                  <div className={s.rowHint}>设置已保留，自动清理逻辑后续接入</div>
                </div>
                <input
                  type="number"
                  className={s.numInput}
                  value={settings.maxBackups}
                  onChange={(e) => handleSettingChange("maxBackups", parseInt(e.target.value) || 10)}
                  min={1}
                  max={100}
                />
              </div>
            </div>
          </section>

          {/* Git 同步 */}
          <section className={s.card} data-section="github">
            <div className={s.cardHeader}>
              <div className={s.cardTitleWrap}>
                <div className={s.cardTitleIcon}>
                  <Github size={15} />
                </div>
                <h2 className={s.cardTitle}>Git 同步</h2>
              </div>
              <div className={s.cardHeaderActions}>
                <button
                  className={s.guideTrigger}
                  onClick={() => setShowBackupGuide(true)}
                  aria-label="查看 SSH 备份说明"
                  title="查看 SSH 备份说明"
                >
                  <Info size={14} />
                </button>
                <span className={backupDraft.enabled ? s.backupStateOn : s.backupStateOff}>
                  {backupDraft.enabled ? "已启用" : "未启用"}
                </span>
              </div>
            </div>
            <div className={s.rows}>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>自动同步到远端</div>
                  <div className={s.rowHint}>启用后，新建/编辑/删除/导入 Skill 都会自动推送到 Git 仓库；仅同步自建 Skills。</div>
                </div>
                <Toggle
                  checked={backupDraft.enabled}
                  onChange={(v) => handleBackupDraftChange("enabled", v)}
                />
              </div>

              <div className={`${s.row} ${s.rowFull}`}>
                <div className={s.backupField}>
                  <div className={s.rowLabel}>仓库 SSH 地址</div>
                  <div className={s.rowHint}>使用 <code className={s.code}>git@github.com:owner/repo.git</code> 格式。</div>
                  <input
                    className={`${s.repoInput} ${s.repoInputWide}`}
                    value={backupDraft.remoteUrl}
                    onChange={(e) => handleBackupDraftChange("remoteUrl", e.target.value)}
                    placeholder="git@github.com:DargonLee/My-Skills.git"
                  />
                </div>
              </div>

              <div className={`${s.row} ${s.rowFull}`}>
                <div className={s.backupField}>
                  <div className={s.rowLabel}>目标分支</div>
                  <input
                    className={`${s.repoInput} ${s.repoInputWide}`}
                    value={backupDraft.branch}
                    onChange={(e) => handleBackupDraftChange("branch", e.target.value)}
                    placeholder="main"
                  />
                </div>
              </div>

              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>上次同步</div>
                  <div className={s.rowHint}>{formatSyncTime(backupDraft.lastSyncedAt)}</div>
                </div>
              </div>

              <div className={`${s.row} ${s.rowFull}`}>
                <div className={s.backupField}>
                  <div className={s.rowLabel}>操作</div>
                  <div className={s.rowHint}>保存配置后自动连接远端；手动推拉可在自动同步之外额外操作。</div>
                </div>
                <div className={s.syncBtns}>
                  <button
                    className={s.btnPrimary}
                    disabled={backupAction !== null || !backupDraft.remoteUrl.trim()}
                    onClick={async () => {
                      const saved = await persistBackupSource(false);
                      if (!saved) return;
                      setBackupAction("test");
                      const connectResult = await backupSourceConnect();
                      if (!connectResult.ok) {
                        showToast(`连接失败：${connectResult.error}`);
                        setBackupAction(null);
                        return;
                      }
                      const connectedSource = syncBackupDraftFromStatus(connectResult.value);
                      await updateSettings({ backupSource: connectedSource });
                      refreshSources(BACKUP_SOURCE_REPO_ID);
                      await refreshSkills();
                      showToast(buildBackupToast("已保存并连接成功", connectResult.value.notice));
                      setBackupAction(null);
                    }}
                  >
                    {backupAction === "test" ? "连接中…" : "保存并连接"}
                  </button>
                  <button
                    className={s.btn}
                    disabled={backupAction !== null}
                    onClick={() => handleBackupSourceAction("push")}
                  >
                    {backupAction === "push" ? "推送中…" : <><Upload size={12} /> 手动推送</>}
                  </button>
                  <button
                    className={s.btn}
                    disabled={backupAction !== null}
                    onClick={() => handleBackupSourceAction("pull")}
                  >
                    {backupAction === "pull" ? "拉取中…" : <><Download size={12} /> 手动拉取</>}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* 外观 */}
          <section className={s.card} data-section="appearance">
            <div className={s.cardHeader}>
              <div className={s.cardTitleWrap}>
                <div className={s.cardTitleIcon}>
                  <Palette size={15} />
                </div>
                <h2 className={s.cardTitle}>外观</h2>
              </div>
            </div>
            <div className={s.rows}>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>主题</div>
                </div>
                <div className={s.themeGroup}>
                  {(["浅色", "深色", "跟随系统"] as const).map((t, i) => (
                    <label key={t} className={s.themeOption}>
                      <div
                        className={s.themePreview}
                        style={{
                          background:
                            i === 1
                              ? "#1e293b"
                              : i === 2
                              ? "linear-gradient(135deg,#fff 50%,#1e293b 50%)"
                              : "#fff",
                          borderColor: theme === t ? "var(--primary)" : "var(--border-default)",
                        }}
                      />
                      <div className={s.themeLabel}>
                        <input
                          type="radio"
                          name="theme"
                          checked={theme === t}
                          onChange={() => {
                            const themeValue =
                              t === "浅色" ? "light" : t === "深色" ? "dark" : "system";
                            handleSettingChange("theme", themeValue);
                          }}
 />{" "}
                        {t}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 危险操作 */}
          <section className={s.card} data-variant="danger">
            <div className={s.cardHeader}>
              <div className={s.cardTitleWrap}>
                <div className={s.cardTitleIcon}>
                  <AlertTriangle size={15} />
                </div>
                <h2 className={s.cardTitle}>危险操作</h2>
              </div>
            </div>
            <div className={s.rows}>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>清空所有备份</div>
                  <div className={s.rowHint}>删除全部快照文件，不可恢复</div>
                </div>
                <button className={s.btnDanger}>清空备份</button>
              </div>
              <div className={s.row}>
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>重置所有设置</div>
                  <div className={s.rowHint}>恢复默认配置，已安装 Skills 不受影响</div>
                </div>
                <button className={s.btnDanger}>重置设置</button>
              </div>
            </div>
          </section>

          <div className={s.versionRow}>SkillSwitch v0.1.0</div>
        </div>
      </div>
      {showBackupGuide && (
        <div className={s.guideModalOverlay} onClick={() => setShowBackupGuide(false)}>
          <div className={s.guideModal} onClick={(e) => e.stopPropagation()}>
            <div className={s.guideModalHeader}>
              <div>
                <div className={s.guideModalEyebrow}>SSH 备份说明</div>
                <h3 className={s.guideModalTitle}>按这个顺序接入 GitHub 备份</h3>
              </div>
              <button
                className={s.guideModalClose}
                onClick={() => setShowBackupGuide(false)}
                aria-label="关闭说明"
              >
                <X size={14} />
              </button>
            </div>
            <div className={s.guideModalBody}>
              <ol className={s.backupSteps}>
                <li>
                  <strong>1. 在 GitHub 新建仓库</strong>
                  <span>建议为 SkillSwitch 单独准备一个备份仓库。这个仓库只用来同步你自建的 Skills。</span>
                </li>
                <li>
                  <strong>2. 在本机生成 SSH key</strong>
                  <span>如果还没有 key，可以在终端运行 <code className={s.code}>ssh-keygen -t ed25519 -C "you@example.com"</code>。</span>
                </li>
                <li>
                  <strong>3. 把公钥上传到 GitHub</strong>
                  <span>运行 <code className={s.code}>cat ~/.ssh/id_ed25519.pub</code>，复制输出内容后到 GitHub 的 SSH keys 页面添加。</span>
                </li>
                <li>
                  <strong>4. 测试 SSH 连接</strong>
                  <span>运行 <code className={s.code}>ssh -T git@github.com</code>，确认 GitHub 认得这台电脑。</span>
                </li>
                <li>
                  <strong>5. 回到这里填写并同步</strong>
                  <span>填入 SSH 地址和分支，界面会自动解析出 <code className={s.code}>owner/repo</code>，然后再连接、推送或拉取。</span>
                </li>
              </ol>
              <div className={s.backupHintRow}>
                <Terminal size={12} />
                <span>远端仓库会维护一份独立备份工作树，只包含自建 Skills；第三方仓库安装项不会被推送进去。</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={s.toast}>{toast}</div>}
    </div>
  );
}
