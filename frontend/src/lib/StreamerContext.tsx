import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { listStreamers, type StreamerInfo } from "./api";
import { useAuth } from "./AuthContext";

const STORAGE_KEY = "cuttie_active_streamer";

interface StreamerContextValue {
  streamers: StreamerInfo[];
  activeStreamer: StreamerInfo | null;
  setActiveStreamer: (streamer: StreamerInfo | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const StreamerContext = createContext<StreamerContextValue>(null!);

export function StreamerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [streamers, setStreamers] = useState<StreamerInfo[]>([]);
  const [activeStreamer, setActiveStreamerState] = useState<StreamerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const setActiveStreamer = useCallback((streamer: StreamerInfo | null) => {
    setActiveStreamerState(streamer);
    if (streamer) {
      localStorage.setItem(STORAGE_KEY, String(streamer.id));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const list = await listStreamers();
      setStreamers(list);

      // Restore from localStorage or pick first
      const savedId = localStorage.getItem(STORAGE_KEY);
      if (savedId) {
        const found = list.find((s) => s.id === Number(savedId));
        if (found) {
          setActiveStreamerState(found);
        } else if (list.length > 0) {
          setActiveStreamer(list[0]);
        }
      } else if (list.length > 0) {
        setActiveStreamer(list[0]);
      }
    } catch {
      setStreamers([]);
    } finally {
      setLoading(false);
    }
  }, [user, setActiveStreamer]);

  useEffect(() => {
    if (user) {
      refresh();
    } else {
      setStreamers([]);
      setActiveStreamerState(null);
      setLoading(false);
    }
  }, [user, refresh]);

  return (
    <StreamerContext.Provider value={{ streamers, activeStreamer, setActiveStreamer, loading, refresh }}>
      {children}
    </StreamerContext.Provider>
  );
}

export function useStreamer() {
  return useContext(StreamerContext);
}
