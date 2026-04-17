import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Skill, ExternalSkill, CreateSkillResult } from "../types";
import { skillList, skillSearch, skillCreate, skillUpdate, skillDelete, scanExternalSkills } from "../services/skill";
import type { CreateSkillInput, UpdateSkillInput } from "../types";
import { APP_LIST } from "./AppContext";
import type { Result } from "../services/tauri";

interface SkillContextValue {
  skills: Skill[];
  externalSkills: ExternalSkill[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  search: (query: string) => Promise<void>;
  create: (input: CreateSkillInput) => Promise<Result<CreateSkillResult>>;
  update: (input: UpdateSkillInput) => Promise<Result<Skill>>;
  remove: (id: string) => Promise<boolean>;
}

const SkillContext = createContext<SkillContextValue | null>(null);

export function SkillProvider({ children }: { children: ReactNode }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [externalSkills, setExternalSkills] = useState<ExternalSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load skills on mount
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [managedResult, externalResults] = await Promise.all([
      skillList(),
      Promise.allSettled(APP_LIST.map((app) => scanExternalSkills(app.id))),
    ]);

    if (managedResult.ok) {
      setSkills(managedResult.value);
    } else {
      setError(managedResult.error);
    }

    const unmanagedExternal = externalResults.flatMap((result, index) => {
      const appId = APP_LIST[index]?.id;
      if (!appId || result.status !== "fulfilled" || !result.value.ok) {
        return [];
      }

      return result.value.value.filter((skill) => !skill.isSymlink);
    });
    setExternalSkills(unmanagedExternal);

    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Search skills
  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      refresh();
      return;
    }
    setLoading(true);
    setError(null);
    const result = await skillSearch(query);
    if (result.ok) {
      setSkills(result.value);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [refresh]);

  // Create skill
  const create = useCallback(async (input: CreateSkillInput): Promise<Result<CreateSkillResult>> => {
    const result = await skillCreate(input);
    if (result.ok) {
      setSkills((prev) => [...prev, result.value.skill]);
      return result;
    }
    setError(result.error);
    return result;
  }, []);

  // Update skill
  const update = useCallback(async (input: UpdateSkillInput): Promise<Result<Skill>> => {
    const result = await skillUpdate(input);
    if (result.ok) {
      setSkills((prev) =>
        prev.map((s) => (s.id === input.id ? result.value : s))
      );
      return result;
    }
    setError(result.error);
    return result;
  }, []);

  // Delete skill
  const remove = useCallback(async (id: string): Promise<boolean> => {
    const result = await skillDelete(id);
    if (result.ok) {
      setSkills((prev) => prev.filter((s) => s.id !== id));
      return true;
    }
    setError(result.error);
    return false;
  }, []);

  return (
    <SkillContext.Provider
      value={{ skills, externalSkills, loading, error, refresh, search, create, update, remove }}
    >
      {children}
    </SkillContext.Provider>
  );
}

export function useSkills() {
  const context = useContext(SkillContext);
  if (!context) {
    throw new Error("useSkills must be used within SkillProvider");
  }
  return context;
}
