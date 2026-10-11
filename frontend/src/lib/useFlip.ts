import { useLayoutEffect, useRef, type RefObject } from "react";

const FALLBACK_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * Children marked data-flip="<key>" glide from where they were to where they
 * are after a render (a list that reorders) instead of jumping there.
 * Positions are layout ones (offsetLeft / offsetTop, the container being
 * their offset parent), so an animation in progress doesn't count as a move.
 */
export function useFlip(container: RefObject<HTMLElement | null>, duration = 650): void {
  const last = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const spring = getComputedStyle(root).getPropertyValue("--ease-glide").trim();
    const easing = spring && CSS.supports("transition-timing-function", spring) ? spring : FALLBACK_EASING;

    const next = new Map<string, { x: number; y: number }>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = el.dataset.flip ?? "";
      const pos = { x: el.offsetLeft, y: el.offsetTop };
      next.set(key, pos);
      const prev = last.current.get(key);
      if (!prev || still) continue;
      const dx = prev.x - pos.x;
      const dy = prev.y - pos.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration, easing });
    }
    last.current = next;
  });
}
