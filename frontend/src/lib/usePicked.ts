import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Compilation } from "./api";
import { allItems, itemsBetween } from "./compilation";

/**
 * Several passages of a video picked at once, to move, cut or take out together. One selection
 * for the whole montage: the list of passages and the timeline show and change the same one.
 */
export interface Picked {
  picked: Set<string>;
  /** The picked passages, in the order they play */
  ids: string[];
  /** One passage picked or let go; `range`: all from the one picked last to this one (Shift + click) */
  toggle: (id: string, range?: boolean) => void;
  /** Every passage of the video (Ctrl / Cmd + A) */
  all: () => void;
  clear: () => void;
}

export function usePicked(compilation: Pick<Compilation, "sections"> | null | undefined): Picked {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The passage picked last: Shift + click picks all from it to the one clicked
  const anchor = useRef<string | null>(null);
  const video = useRef(compilation);
  video.current = compilation;
  const order = compilation ? allItems(compilation).map((item) => item.id) : [];
  const key = order.join(",");
  // A passage that left the video is no longer picked
  useEffect(() => {
    setPicked((prev) => ([...prev].every((id) => order.includes(id)) ? prev : new Set([...prev].filter((id) => order.includes(id)))));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = useCallback((id: string, range = false) => {
    setPicked((prev) => {
      const next = new Set(prev);
      const from = anchor.current;
      if (range && from && from !== id && video.current) for (const between of itemsBetween(video.current, from, id)) next.add(between);
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }, []);
  const all = useCallback(() => setPicked(new Set(video.current ? allItems(video.current).map((item) => item.id) : [])), []);
  const clear = useCallback(() => setPicked((prev) => (prev.size === 0 ? prev : new Set())), []);
  // Escape lets them all go (not while typing, nor in a dialog)
  useEffect(() => {
    if (picked.size === 0) return;
    const escape = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest?.("input, textarea, [role=dialog]") && setPicked(new Set());
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [picked.size]);
  const ids = useMemo(() => order.filter((id) => picked.has(id)), [key, picked]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => ({ picked, ids, toggle, all, clear }), [all, clear, ids, picked, toggle]);
}
