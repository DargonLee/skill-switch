import { useState, useRef, useEffect } from "react";
import { backupSourceBootstrap } from "../../services/backupSource";
import type { BackupSourceStatus } from "../../types";
import { Loader, AlertTriangle, GitBranch } from "lucide-react";
import s from "./BackupSetupModal.module.css";

interface Props {
  onConnected: (status: BackupSourceStatus) => void;
}

export function BackupSetupModal({ onConnected }: Props) {
  const [remoteUrl, setRemoteUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const getErrorHint = (err: string): string => {
    if (err.includes("git is not available")) return "请先安装 Git 命令行工具";
    if (err.includes("无法访问远程仓库")) return "请检查仓库地址、网络连接，并确保 SSH key 或 Git 凭据已正确配置";
    if (err.includes("认证") || err.includes("auth") || err.includes("permission")) return "认证失败，请确认 SSH agent 已启动或 Git credential helper 已配置";
    return err;
  };

  const handleConnect = async () => {
    const trimmed = remoteUrl.trim();
    if (!trimmed) { setError("请输入仓库地址"); return; }
    setLoading(true);
    setError(null);
    const result = await backupSourceBootstrap({ remoteUrl: trimmed, branch: branch.trim() || undefined });
    setLoading(false);
    if (result.ok) {
      onConnected(result.value);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className={s.overlay}>
      <div className={s.modal}>
        <div className={s.header}>
          <GitBranch size={20} />
          <h2 className={s.title}>配置技能仓库</h2>
        </div>
        <p className={s.description}>
          SkillSwitch 使用 GitHub 仓库作为技能主存储。请输入仓库地址以开始。
        </p>
        <div className={s.form}>
          <label className={s.label}>仓库地址</label>
          <input
            ref={inputRef}
            className={s.input}
            value={remoteUrl}
            onChange={e => { setRemoteUrl(e.target.value); setError(null); }}
            placeholder="git@github.com:user/skills.git 或 https://github.com/user/skills.git"
            onKeyDown={e => e.key === "Enter" && handleConnect()}
            disabled={loading}
          />
          <label className={s.label}>分支</label>
          <input
            className={s.input}
            value={branch}
            onChange={e => setBranch(e.target.value)}
            placeholder="main"
            disabled={loading}
          />
          <p className={s.hint}>
            支持 SSH 和 HTTPS。认证依赖系统已配置的 SSH agent 或 Git credential helper。
          </p>
        </div>
        {error && (
          <div className={s.error}>
            <AlertTriangle size={14} />
            <span>{getErrorHint(error)}</span>
          </div>
        )}
        <div className={s.footer}>
          <button className={s.connectBtn} onClick={handleConnect} disabled={loading}>
            {loading ? <><Loader size={14} className={s.spin} /> 连接中…</> : "连接"}
          </button>
        </div>
      </div>
    </div>
  );
}
