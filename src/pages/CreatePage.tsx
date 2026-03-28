import { useEffect, useState } from "react";
import type { PageId } from "../App";
import type { StandardSkillDirectory } from "../types";
import { AlertTriangle, Check, File, Folder, Info, Loader2, Sparkles, X } from "lucide-react";
import { useSkills } from "../context/SkillContext";
import { formatSkillOperationError } from "../services/skill";
import s from "./CreatePage.module.css";

const SKILL_HINT = "SKILL.md 是 Skill 的入口，Claude 每次调用时都会读取它";

function defaultSkillContent(name: string): string {
  return `---
name: ${name || "my-skill"}
description:
---

# ${name || "My Skill"}

描述这个 Skill 的用途。

## 用法

\`/${name || "skill-name"} action\` — 描述操作`;
}

const STANDARD_DIRECTORIES = [
  {
    key: "scripts",
    icon: "⚙️",
    label: "scripts/",
    color: "#16a34a",
    hint: "存放可执行脚本，供 Skill 调用自动化任务。",
  },
  {
    key: "references",
    icon: "📚",
    label: "references/",
    color: "#0891b2",
    hint: "存放参考文档和知识库，补充背景信息。",
  },
  {
    key: "assets",
    icon: "🖼️",
    label: "assets/",
    color: "#f97316",
    hint: "存放模板、图片等静态资源，供 SKILL.md 引用。",
  },
] as const satisfies ReadonlyArray<{
  key: StandardSkillDirectory;
  icon: string;
  label: string;
  color: string;
  hint: string;
}>;

const COLORS = ["#2563eb", "#7c3aed", "#16a34a", "#ea580c", "#db2777"];
const EMPTY_DIRECTORIES: Record<StandardSkillDirectory, boolean> = {
  scripts: false,
  references: false,
  assets: false,
};

interface Props {
  onNavigate: (page: PageId) => void;
  editSkillId?: string;
}

export function CreatePage({ onNavigate, editSkillId }: Props) {
  const { skills, create, update } = useSkills();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [colorIdx, setColorIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState(defaultSkillContent(""));
  const [skillContentTouched, setSkillContentTouched] = useState(false);
  const [selectedDirectories, setSelectedDirectories] =
    useState<Record<StandardSkillDirectory, boolean>>(EMPTY_DIRECTORIES);

  // Load existing skill for edit mode
  useEffect(() => {
    if (editSkillId) {
      const skill = skills.find((s) => s.id === editSkillId);
      if (skill) {
        setName(skill.name);
        setDesc(skill.description || "");
        setSkillContent(skill.content);
        setSkillContentTouched(true);
      }
    }
  }, [editSkillId, skills]);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!editSkillId && !skillContentTouched) {
      setSkillContent(defaultSkillContent(v));
    }
  };

  const toggleDirectory = (key: StandardSkillDirectory) => {
    setSelectedDirectories((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const createDirectories = STANDARD_DIRECTORIES
    .filter((directory) => selectedDirectories[directory.key])
    .map((directory) => directory.key);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("请填写 Skill 名称");
      return;
    }

    setSaving(true);
    setError(null);

    if (editSkillId) {
      // Update existing skill
      const result = await update({
        id: editSkillId,
        name,
        description: desc || null,
        content: skillContent,
        tags: [],
        projectIds: [],
      });
      if (result.ok) {
        onNavigate("my-library");
      } else {
        setError(formatSkillOperationError(result.error, "保存"));
      }
    } else {
      // Create new skill
      const result = await create({
        name,
        description: desc || null,
        content: skillContent || "",
        directories: createDirectories,
        tags: [],
        projectIds: [],
      });
      if (result.ok) {
        onNavigate("my-library");
      } else {
        setError(formatSkillOperationError(result.error, "保存"));
      }
    }
    setSaving(false);
  };
  const previewEntries = editSkillId
    ? ["SKILL.md"]
    : ["SKILL.md", ...STANDARD_DIRECTORIES
      .filter((directory) => selectedDirectories[directory.key])
      .map((directory) => directory.label)];

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>{editSkillId ? "编辑 Skill" : "创建新 Skill"}</h1>
        <div className={s.headerActions}>
          <button className={s.cancelBtn} onClick={() => onNavigate("my-library")}>
            <X size={14} /> 取消
          </button>
          <button className={s.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className={s.spin} /> : <Check size={14} />}
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </header>

      {error && (
        <div className={s.errorBanner}>
          <span><AlertTriangle size={14} /> {error}</span>
          <button onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      <div className={s.body}>
        {/* Left: meta */}
        <aside className={s.aside}>
          <div className={s.asideHeader}>
            <div className={s.asideIcon}>
              <Sparkles size={18} />
            </div>
            <div>
              <div className={s.asideTitle}>Skill 配置</div>
              <div className={s.asideSubtitle}>定义名称、描述和文件结构</div>
            </div>
          </div>
          <div className={s.field}>
            <label className={s.label}>SKILL 名称</label>
            <input
              className={s.input}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="my-awesome-skill"
              spellCheck={false}
            />
            <div className={s.hint}>只能用小写字母、数字和连字符</div>
          </div>
          <div className={s.field}>
            <label className={s.label}>描述</label>
            <textarea
              className={s.textarea}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="一句话描述这个 Skill 的功能..."
              rows={3}
            />
          </div>
          <div className={s.field}>
            <label className={s.label}>图标颜色</label>
            <div className={s.colors}>
              {COLORS.map((c, i) => (
                <button
                  key={c}
                  className={`${s.colorBtn} ${colorIdx === i ? s.colorBtnActive : ""}`}
                  style={{ background: c }}
                  onClick={() => setColorIdx(i)}
                />
              ))}
            </div>
          </div>
          {editSkillId ? (
            <div className={s.field}>
              <label className={s.label}>目录结构</label>
              <div className={s.editNotice}>
                编辑模式仅更新 <code>SKILL.md</code>，已有附加目录保持不变。
              </div>
            </div>
          ) : (
            <div className={s.field}>
              <label className={s.label}>标准目录</label>
              <div className={s.directoryOptions}>
                {STANDARD_DIRECTORIES.map((directory) => (
                  <label key={directory.key} className={s.directoryOption}>
                    <input
                      type="checkbox"
                      checked={selectedDirectories[directory.key]}
                      onChange={() => toggleDirectory(directory.key)}
                      style={{ accentColor: directory.color }}
                    />
                    <span>{directory.icon}</span>
                    <span className={s.directoryMeta}>
                      <span className={s.directoryLabel} style={{ color: directory.color }}>
                        {directory.label}
                      </span>
                      <span className={s.directoryHint}>{directory.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className={s.hint}>勾选后会创建空目录，保存后前往「我的库」点击「在 Finder 中显示」添加脚本或资源文件。</div>
            </div>
          )}
          <div className={s.field}>
            <label className={s.label}>目录结构预览</label>
            <div className={s.dirPreview}>
              <div className={s.dirRoot}><Folder size={14} /> {name || "my-skill"}/</div>
              {previewEntries.map((entry) => (
                <div key={entry} className={s.dirFile}>
                  {entry.endsWith("/") ? <Folder size={12} /> : <File size={12} />} {entry}
                </div>
              ))}
            </div>
            {editSkillId && (
              <div className={s.hint}>仅展示当前可编辑入口文件，现有附加目录不会被删除。</div>
            )}
          </div>
        </aside>

        {/* Right: editor */}
        <div className={s.editor}>
          <div className={s.editorHeader}>
            <span className={s.editorFilename}>SKILL.md</span>
            <span className={s.editorNote}>唯一可编辑入口文件</span>
          </div>

          <textarea
            className={s.codeArea}
            value={skillContent}
            onChange={(e) => {
              setSkillContentTouched(true);
              setSkillContent(e.target.value);
            }}
            spellCheck={false}
          />

          <div className={s.hintBar}><Info size={12} /> {SKILL_HINT}</div>
        </div>
      </div>
    </div>
  );
}
