import type { ReactNode } from "react";
import claudeCodeIcon from "../assets/cli-icons/claude-code.png";
import codexIcon from "../assets/cli-icons/codex.png";
import cursorIcon from "../assets/cli-icons/cursor.png";

// Supported AI CLI applications
export const APP_LIST = [
  { id: "claude", label: "Claude Code", iconSrc: claudeCodeIcon, accentColor: "#2563eb", skillPathLabel: "~/.claude/skills/" },
  { id: "codex", label: "Codex CLI", iconSrc: codexIcon, accentColor: "#7c3aed", skillPathLabel: "~/.codex/skills/" },
  { id: "cursor", label: "Cursor", iconSrc: cursorIcon, accentColor: "#0891b2", skillPathLabel: "~/.cursor/skills/" },
] as const;

export type AppId = (typeof APP_LIST)[number]["id"];

export function AppProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
