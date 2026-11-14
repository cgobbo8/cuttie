import type { PointerEvent as ReactPointerEvent } from "react";

/** Pointer drag helper: calls `onMove` with the pointer's position as a 0-1 ratio of `el` (and whether Alt is held) */
export function dragRatio(e: ReactPointerEvent, el: HTMLElement, onMove: (ratio: number, alt: boolean) => void, onEnd?: () => void) {
  e.preventDefault();
  e.stopPropagation();
  const update = (clientX: number, alt: boolean) => {
    const rect = el.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)), alt);
  };
  update(e.clientX, e.altKey);
  // Listen on the window so the drag survives leaving the element
  const move = (ev: PointerEvent) => update(ev.clientX, ev.altKey);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onEnd?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
