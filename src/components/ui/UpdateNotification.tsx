import { useState } from "react";
import { Download, X, RefreshCw } from "lucide-react";
import { useUpdater } from "../../context/UpdaterContext";
import s from "./UpdateNotification.module.css";

export function UpdateNotification() {
  const {
    updateInfo,
    isDownloading,
    downloadProgress,
    downloadUpdate,
    dismissUpdate,
  } = useUpdater();

  const [installing, setInstalling] = useState(false);

  if (!updateInfo) return null;

  const handleInstall = async () => {
    setInstalling(true);
    await downloadUpdate();
    setInstalling(false);
  };

  const progressPercent = downloadProgress?.total
    ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
    : downloadProgress
    ? 50
    : 0;

  return (
    <div className={s.notification}>
      <div className={s.content}>
        <div className={s.icon}>
          <RefreshCw size={16} />
        </div>
        <div className={s.info}>
          <div className={s.title}>
            发现新版本 v{updateInfo.version}
          </div>
          <div className={s.subtitle}>
            当前版本 v{updateInfo.currentVersion}
          </div>
          {updateInfo.body && (
            <div className={s.changelog}>
              {updateInfo.body}
            </div>
          )}
        </div>
        <button className={s.closeBtn} onClick={dismissUpdate}>
          <X size={14} />
        </button>
      </div>

      {isDownloading ? (
        <div className={s.progressSection}>
          <div className={s.progressBar}>
            <div
              className={s.progressFill}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className={s.progressText}>
            {downloadProgress?.total
              ? `${Math.round(downloadProgress.downloaded / 1024 / 1024)}MB / ${Math.round(downloadProgress.total / 1024 / 1024)}MB`
              : "下载中..."}
          </div>
        </div>
      ) : (
        <div className={s.actions}>
          <button className={s.laterBtn} onClick={dismissUpdate}>
            稍后提醒
          </button>
          <button
            className={s.installBtn}
            onClick={handleInstall}
            disabled={installing}
          >
            {installing ? (
              <>安装中...</>
            ) : (
              <>
                <Download size={14} />
                立即更新
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}