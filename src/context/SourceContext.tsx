import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useSettings } from "./SettingsContext";
import { BACKUP_SOURCE_REPO_ID } from "../services/backupSource";
import { repoSourceListSkills } from "../services/repoSource";
import {
  MARKET_SOURCE_ID,
  marketplaceLoadFeed,
  transformMarketItemToRemoteSkill,
  DEFAULT_PAGE_SIZE,
} from "../services/marketplace";
import {
  REGISTRY_SOURCE_ID,
  registrySearch,
  transformRegistrySkillToDisplay,
  type RegistrySkillDisplay,
} from "../services/registry";
import type {
  BackupSource,
  RemoteSkill,
  RepoFetchState,
  ThirdPartyRepo,
  Source,
  MarketplaceFeedPage,
} from "../types";

interface MarketState {
  items: RemoteSkill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  fetchedAt: number | null;
}

interface RegistryState {
  skills: RegistrySkillDisplay[];
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  query: string;
  fetchedAt: number | null;
}

interface SourceContextValue {
  /** Fetch states keyed by sourceId */
  sourceStates: Map<string, RepoFetchState>;
  /** Market state with pagination info */
  marketState: MarketState;
  /** Registry state with search results */
  registryState: RegistryState;
  /** All fetched remote skills across all sources (excluding paginated market) */
  allRemoteSkills: RemoteSkill[];
  /** Whether any source is currently loading */
  anyLoading: boolean;
  /** Refresh a specific source (or all if sourceId is undefined) */
  refresh: (sourceId?: string) => void;
  /** Load more market items (next page) */
  loadMoreMarket: () => void;
  /** Search market items */
  searchMarket: (query: string) => void;
  /** Search registry skills */
  searchRegistry: (query: string) => void;
  /** Get all sources for sidebar rendering */
  getSources: () => Source[];
  /** Check if a source is the built-in market */
  isMarketSource: (sourceId: string) => boolean;
  /** Check if a source is the registry */
  isRegistrySource: (sourceId: string) => boolean;
}

const SourceContext = createContext<SourceContextValue | null>(null);

function buildBackupRepo(source: BackupSource | null): ThirdPartyRepo | null {
  if (!source || !source.enabled || !source.remoteUrl.trim()) {
    return null;
  }

  return {
    id: BACKUP_SOURCE_REPO_ID,
    url: source.remoteUrl,
    label: source.repo || source.label || "备份源",
    enabled: true,
    addedAt: 0,
    localPath: source.localPath ?? null,
    lastSyncedAt: source.lastSyncedAt ?? null,
  };
}

const initialMarketState: MarketState = {
  items: [],
  total: 0,
  page: 0,
  pageSize: DEFAULT_PAGE_SIZE,
  totalPages: 0,
  status: "idle",
  error: null,
  fetchedAt: null,
};

const initialRegistryState: RegistryState = {
  skills: [],
  status: "idle",
  error: null,
  query: "",
  fetchedAt: null,
};

export function SourceProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [sourceStates, setSourceStates] = useState<Map<string, RepoFetchState>>(
    new Map()
  );
  const [marketState, setMarketState] = useState<MarketState>(initialMarketState);
  const [marketSearch, setMarketSearch] = useState<string>("");
  const [registryState, setRegistryState] = useState<RegistryState>(initialRegistryState);
  const registrySearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRepoSource = useCallback(async (repo: ThirdPartyRepo) => {
    // Set loading state
    setSourceStates((prev) => {
      const next = new Map(prev);
      next.set(repo.id, {
        repoId: repo.id,
        status: "loading",
        skills: prev.get(repo.id)?.skills ?? [],
        error: null,
        fetchedAt: prev.get(repo.id)?.fetchedAt ?? null,
      });
      return next;
    });

    try {
      const result = await repoSourceListSkills(repo);
      if (!result.ok) {
        throw new Error(result.error);
      }
      const skills = result.value;
      setSourceStates((prev) => {
        const next = new Map(prev);
        next.set(repo.id, {
          repoId: repo.id,
          status: "success",
          skills,
          error: null,
          fetchedAt: Date.now(),
        });
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSourceStates((prev) => {
        const next = new Map(prev);
        next.set(repo.id, {
          repoId: repo.id,
          status: "error",
          skills: prev.get(repo.id)?.skills ?? [],
          error: message,
          fetchedAt: prev.get(repo.id)?.fetchedAt ?? null,
        });
        return next;
      });
    }
  }, []);

  const loadMarketSource = useCallback(async (page: number = 1, search: string = "", append: boolean = false) => {
    // Set loading state
    setMarketState((prev) => ({
      ...prev,
      status: "loading",
      error: null,
    }));

    try {
      const result = await marketplaceLoadFeed({
        page,
        pageSize: DEFAULT_PAGE_SIZE,
        search: search || undefined,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      const pageData: MarketplaceFeedPage = result.value;
      const newItems = pageData.items.map(transformMarketItemToRemoteSkill);

      setMarketState((prev) => ({
        items: append ? [...prev.items, ...newItems] : newItems,
        total: pageData.total,
        page: pageData.page,
        pageSize: pageData.pageSize,
        totalPages: pageData.totalPages,
        status: "success",
        error: null,
        fetchedAt: Date.now(),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMarketState((prev) => ({
        ...prev,
        status: "error",
        error: message,
      }));
    }
  }, []);

  // Load/refresh on settings change
  useEffect(() => {
    const backupRepo = buildBackupRepo(settings.backupSource);
    const thirdPartyRepos = settings.thirdPartyRepos ?? [];

    // Build list of all source IDs
    const allSourceIds = new Set([
      MARKET_SOURCE_ID, // Always include market source
      ...(backupRepo ? [backupRepo.id] : []),
      ...thirdPartyRepos.map((r) => r.id),
    ]);

    // Remove states for sources that no longer exist
    setSourceStates((prev) => {
      const next = new Map<string, RepoFetchState>();
      for (const [sourceId, state] of prev.entries()) {
        if (allSourceIds.has(sourceId)) {
          next.set(sourceId, state);
        }
      }
      return next;
    });

    // Load market source if not already loaded
    if (marketState.status === "idle") {
      loadMarketSource(1, marketSearch);
    }

    // Load backup source
    if (backupRepo) {
      const existing = sourceStates.get(backupRepo.id);
      if (!existing || existing.status === "idle") {
        loadRepoSource(backupRepo);
      }
    }

    // Load third-party repos
    for (const repo of thirdPartyRepos) {
      const existing = sourceStates.get(repo.id);
      if (!existing || existing.status === "idle") {
        loadRepoSource(repo);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.backupSource, settings.thirdPartyRepos]);

  const refresh = useCallback(
    (sourceId?: string) => {
      const backupRepo = buildBackupRepo(settings.backupSource);
      const thirdPartyRepos = settings.thirdPartyRepos ?? [];

      if (sourceId) {
        if (sourceId === MARKET_SOURCE_ID) {
          setMarketSearch("");
          loadMarketSource(1, "");
        } else if (sourceId === BACKUP_SOURCE_REPO_ID && backupRepo) {
          loadRepoSource(backupRepo);
        } else {
          const repo = thirdPartyRepos.find((r) => r.id === sourceId);
          if (repo) {
            loadRepoSource(repo);
          }
        }
      } else {
        // Refresh all
        setMarketSearch("");
        loadMarketSource(1, "");
        if (backupRepo) {
          loadRepoSource(backupRepo);
        }
        for (const repo of thirdPartyRepos) {
          loadRepoSource(repo);
        }
      }
    },
    [settings.backupSource, settings.thirdPartyRepos, loadMarketSource, loadRepoSource]
  );

  const loadMoreMarket = useCallback(() => {
    if (marketState.status === "loading") return;
    if (marketState.page >= marketState.totalPages) return;

    loadMarketSource(marketState.page + 1, marketSearch, true);
  }, [marketState.status, marketState.page, marketState.totalPages, marketSearch, loadMarketSource]);

  const searchMarket = useCallback((query: string) => {
    setMarketSearch(query);
    loadMarketSource(1, query, false);
  }, [loadMarketSource]);

  const searchRegistry = useCallback((query: string) => {
    // Clear previous timeout
    if (registrySearchTimeoutRef.current) {
      clearTimeout(registrySearchTimeoutRef.current);
    }

    // Update query immediately
    setRegistryState((prev) => ({ ...prev, query }));

    // Require at least 2 characters
    if (query.length < 2) {
      setRegistryState((prev) => ({ ...prev, skills: [], status: "idle", error: null }));
      return;
    }

    // Debounce search (300ms)
    registrySearchTimeoutRef.current = setTimeout(async () => {
      setRegistryState((prev) => ({ ...prev, status: "loading", error: null }));

      const result = await registrySearch(query, 30);

      if (result.ok) {
        const skills = result.value.skills.map(transformRegistrySkillToDisplay);
        setRegistryState({
          skills,
          status: "success",
          error: null,
          query,
          fetchedAt: Date.now(),
        });
      } else {
        setRegistryState((prev) => ({
          ...prev,
          status: "error",
          error: result.error,
        }));
      }
    }, 300);
  }, []);

  const getSources = useCallback((): Source[] => {
    const backupRepo = buildBackupRepo(settings.backupSource);
    const thirdPartyRepos = settings.thirdPartyRepos ?? [];

    const sources: Source[] = [];

    // Add backup source
    if (backupRepo) {
      sources.push({
        kind: "backup",
        id: backupRepo.id,
        label: backupRepo.label,
        repo: backupRepo,
      });
    }

    // Add market source (always present, at the top of repo sources)
    sources.push({
      kind: "market",
      id: MARKET_SOURCE_ID,
      label: "技能市场",
    });

    // Add registry source
    sources.push({
      kind: "registry",
      id: REGISTRY_SOURCE_ID,
      label: "Registry",
    });

    // Add third-party repo sources
    for (const repo of thirdPartyRepos) {
      sources.push({
        kind: "repo",
        id: repo.id,
        label: repo.label,
        repo,
      });
    }

    return sources;
  }, [settings.backupSource, settings.thirdPartyRepos]);

  const isMarketSource = useCallback((sourceId: string): boolean => {
    return sourceId === MARKET_SOURCE_ID;
  }, []);

  const isRegistrySource = useCallback((sourceId: string): boolean => {
    return sourceId === REGISTRY_SOURCE_ID;
  }, []);

  const allRemoteSkills: RemoteSkill[] = Array.from(sourceStates.values()).flatMap(
    (s) => s.skills
  );

  const anyLoading = marketState.status === "loading" ||
    registryState.status === "loading" ||
    Array.from(sourceStates.values()).some((s) => s.status === "loading");

  return (
    <SourceContext.Provider
      value={{
        sourceStates,
        marketState,
        registryState,
        allRemoteSkills,
        anyLoading,
        refresh,
        loadMoreMarket,
        searchMarket,
        searchRegistry,
        getSources,
        isMarketSource,
        isRegistrySource,
      }}
    >
      {children}
    </SourceContext.Provider>
  );
}

export function useSource() {
  const ctx = useContext(SourceContext);
  if (!ctx) throw new Error("useSource must be used within SourceProvider");
  return ctx;
}