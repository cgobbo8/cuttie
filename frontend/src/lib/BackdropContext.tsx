import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The image blurred behind the whole app ("the content behind the glass").
 * Defaults to the streamer's latest live; a page can show its own content
 * (a VOD, a clip frame, the channel banner) with useBackdrop().
 */

interface BackdropContextValue {
  pageImage: string | null;
  setPageImage: (url: string | null) => void;
  defaultImage: string | null;
  setDefaultImage: (url: string | null) => void;
}

const BackdropContext = createContext<BackdropContextValue>({
  pageImage: null,
  setPageImage: () => {},
  defaultImage: null,
  setDefaultImage: () => {},
});

export function BackdropProvider({ children }: { children: ReactNode }) {
  const [pageImage, setPageImage] = useState<string | null>(null);
  const [defaultImage, setDefaultImage] = useState<string | null>(null);
  return (
    <BackdropContext.Provider value={{ pageImage, setPageImage, defaultImage, setDefaultImage }}>
      {children}
    </BackdropContext.Provider>
  );
}

/** Show `url` behind the current page (restores the default on unmount) */
export function useBackdrop(url: string | null | undefined) {
  const { setPageImage } = useContext(BackdropContext);
  useEffect(() => {
    if (!url) return;
    setPageImage(url);
    return () => setPageImage(null);
  }, [url, setPageImage]);
}

/** Set the app-wide default backdrop (the latest live) */
export function useDefaultBackdrop(url: string | null | undefined) {
  const { setDefaultImage } = useContext(BackdropContext);
  useEffect(() => {
    if (url) setDefaultImage(url);
  }, [url, setDefaultImage]);
}

interface Layer {
  id: number;
  url: string;
  shown: boolean;
}

/** Fixed, blurred, cross-fading image layer behind the app */
export function AppBackdrop() {
  const { pageImage, defaultImage } = useContext(BackdropContext);
  const target = pageImage ?? defaultImage;
  const [layers, setLayers] = useState<Layer[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!target) return;
    setLayers((prev) => (prev[prev.length - 1]?.url === target ? prev : [...prev, { id: nextId.current++, url: target, shown: false }]));
  }, [target]);

  const reveal = (id: number) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, shown: true } : l)));
    // Drop the layers underneath once the fade is over
    window.setTimeout(() => setLayers((prev) => prev.slice(prev.findIndex((l) => l.id === id))), 900);
  };

  return (
    <div aria-hidden="true" className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-ground">
      {layers.map((layer) => (
        <img
          key={layer.id}
          src={layer.url}
          alt=""
          onLoad={() => reveal(layer.id)}
          className="absolute -inset-[12%] w-[124%] h-[124%] max-w-none object-cover transition-opacity duration-700 ease-out"
          style={{ opacity: layer.shown ? 1 : 0, filter: "blur(90px) saturate(1.6) brightness(0.56)" }}
        />
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,11,12,0.08)_0%,rgba(11,11,12,0.42)_42%,rgba(11,11,12,0.86)_78%,#0b0b0c_100%)]" />
    </div>
  );
}
