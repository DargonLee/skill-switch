import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Project } from "../types";
import { projectList, projectCreate, projectUpdate, projectDelete } from "../services/project";
import type { CreateProjectInput, UpdateProjectInput } from "../types";

interface ProjectContextValue {
  projects: Project[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: CreateProjectInput) => Promise<Project | null>;
  update: (input: UpdateProjectInput) => Promise<Project | null>;
  remove: (id: string) => Promise<boolean>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load projects on mount
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await projectList();
    if (result.ok) {
      setProjects(result.value);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Create project
  const create = useCallback(async (input: CreateProjectInput): Promise<Project | null> => {
    const result = await projectCreate(input);
    if (result.ok) {
      setProjects((prev) => [...prev, result.value]);
      return result.value;
    }
    setError(result.error);
    return null;
  }, []);

  // Update project
  const update = useCallback(async (input: UpdateProjectInput): Promise<Project | null> => {
    const result = await projectUpdate(input);
    if (result.ok) {
      setProjects((prev) =>
        prev.map((p) => (p.id === input.id ? result.value : p))
      );
      return result.value;
    }
    setError(result.error);
    return null;
  }, []);

  // Delete project
  const remove = useCallback(async (id: string): Promise<boolean> => {
    const result = await projectDelete(id);
    if (result.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      return true;
    }
    setError(result.error);
    return false;
  }, []);

  return (
    <ProjectContext.Provider
      value={{ projects, loading, error, refresh, create, update, remove }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProjects must be used within ProjectProvider");
  }
  return context;
}