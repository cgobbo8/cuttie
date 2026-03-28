import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { listCreators, type CreatorSummary } from "./api";
import { useAuth } from "./AuthContext";

const STORAGE_KEY = "cuttie_workspace_creator_id";

interface CreatorWorkspaceContextValue {
  creator: CreatorSummary | null;
  creators: CreatorSummary[];
  loading: boolean;
  setCreator: (creator: CreatorSummary | null) => void;
  selectByStreamer: (streamerName: string) => Promise<void>;
  isAllMode: boolean;
}

const CreatorWorkspaceContext = createContext<CreatorWorkspaceContextValue>({
  creator: null,
  creators: [],
  loading: true,
  setCreator: () => {},
  selectByStreamer: async () => {},
  isAllMode: true,
});

export function CreatorWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [creators, setCreators] = useState<CreatorSummary[]>([]);
  const [creator, setCreatorState] = useState<CreatorSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setCreators([]);
      setCreatorState(null);
      setLoading(false);
      return;
    }

    listCreators()
      .then((list) => {
        setCreators(list);
        // Restore selection from localStorage
        const storedId = localStorage.getItem(STORAGE_KEY);
        if (storedId) {
          const found = list.find((c) => c.id === Number(storedId));
          if (found) setCreatorState(found);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const setCreator = useCallback((c: CreatorSummary | null) => {
    setCreatorState(c);
    if (c) {
      localStorage.setItem(STORAGE_KEY, String(c.id));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const selectByStreamer = useCallback(async (streamerName: string) => {
    const login = streamerName.toLowerCase();
    // Check current list first
    let found = creators.find((c) => c.login === login || c.display_name.toLowerCase() === login);
    if (found) {
      setCreator(found);
      return;
    }
    // New creator — refresh list then select
    try {
      const fresh = await listCreators();
      setCreators(fresh);
      found = fresh.find((c) => c.login === login || c.display_name.toLowerCase() === login);
      if (found) setCreator(found);
    } catch {}
  }, [creators, setCreator]);

  return (
    <CreatorWorkspaceContext.Provider
      value={{
        creator,
        creators,
        loading,
        setCreator,
        selectByStreamer,
        isAllMode: creator === null,
      }}
    >
      {children}
    </CreatorWorkspaceContext.Provider>
  );
}

export function useCreatorWorkspace() {
  return useContext(CreatorWorkspaceContext);
}
