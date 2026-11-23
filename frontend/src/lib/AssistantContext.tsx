import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The assistant's panel: one column beside the page, on every screen. Open, it pushes the
 * whole page to the left (the top bar too) and sits side by side with it: it never covers
 * what the streamer is working on.
 *
 * A page can put something of its own in the panel (<AssistantSlot>): it is drawn there for
 * as long as the page is on screen.
 */

/** How wide the panel is, pixels (the page gives that much room up when it is open) */
export const ASSISTANT_WIDTH = 420;
const KEPT = "cuttie_assistant_open";

interface AssistantValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Where a page's own content goes in the panel, and how many pages have some there */
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
  filled: number;
  claim: () => () => void;
}

const AssistantContext = createContext<AssistantValue>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  slot: null,
  setSlot: () => {},
  filled: 0,
  claim: () => () => {},
});

function wasOpen(): boolean {
  try {
    return localStorage.getItem(KEPT) === "1";
  } catch {
    return false;
  }
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(wasOpen);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [filled, setFilled] = useState(0);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(KEPT, next ? "1" : "0");
    } catch {
      // No storage: it opens closed next time
    }
  }, []);
  const toggle = useCallback(() => setOpenState((before) => {
    try {
      localStorage.setItem(KEPT, before ? "0" : "1");
    } catch {
      // (as above)
    }
    return !before;
  }), []);
  const claim = useCallback(() => {
    setFilled((n) => n + 1);
    return () => setFilled((n) => n - 1);
  }, []);

  // The room it takes, for what is laid out against the window (the top bar)
  useEffect(() => {
    document.documentElement.style.setProperty("--assistant-w", open ? `${ASSISTANT_WIDTH}px` : "0px");
  }, [open]);

  // Ctrl / Cmd + J opens and closes it from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo(() => ({ open, setOpen, toggle, slot, setSlot, filled, claim }), [open, setOpen, toggle, slot, filled, claim]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export const useAssistant = () => useContext(AssistantContext);

/** What the page on screen shows in the assistant's panel */
export function AssistantSlot({ children }: { children: ReactNode }) {
  const { slot, claim } = useAssistant();
  useEffect(() => claim(), [claim]);
  return slot ? createPortal(children, slot) : null;
}
