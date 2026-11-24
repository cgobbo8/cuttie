import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Contrast, Focus, Plus, ScanFace, Trash2, Vibrate, Zap, ZoomIn, type LucideIcon } from "lucide-react";
import type { CompilationItem } from "../../lib/api";
import { laneRows, MOVE_AMOUNTS, MOVE_SPANS, MOVE_TYPES, SHARP_KINDS, STRENGTHS, type LaneMove, type MovePatch, type MoveType } from "../../lib/effectMoves";
import { clock } from "../../lib/format";
import { gainAt, type MusicCurve } from "../../lib/music/curve";
import { soundHeights } from "../../lib/laneSound";

/**
 * The lanes of the montage's timeline that sit under its passages: how loud the live is, where
 * the picture moves (each move put down, moved, stretched, changed and taken out by hand), the
 * chat written on the video, and how loud the music plays under each passage (dragged up and
 * down). Each is drawn over the whole video's length, as the passages are.
 */

/** Where a passage plays in the whole video, frames */
interface Span {
  id: string;
  from: number;
  to: number;
}

export const MOVE_ICONS: Record<MoveType, LucideIcon> = { cam: ScanFace, zoom: ZoomIn, slow: Focus, shake: Vibrate, pulse: Activity, flash: Zap, gray: Contrast };

/** How each kind of move is drawn: the channel's color for what comes closer, white for what is laid over the picture */
const MOVE_LOOK: Record<MoveType, string> = {
  cam: "bg-accent shadow-[0_0_8px_var(--color-accent-glow)]",
  zoom: "bg-accent/60",
  slow: "bg-accent/15 border border-accent-line",
  shake: "bg-[repeating-linear-gradient(90deg,var(--color-accent)_0_2px,transparent_2px_4px)]",
  pulse: "bg-[repeating-linear-gradient(90deg,var(--color-accent)_0_5px,transparent_5px_8px)]",
  flash: "bg-white",
  gray: "bg-[linear-gradient(90deg,#fff,#555)]",
};

/** A press that moves less than this is a click (px), and how close to an end of a mark it takes that end */
const DRAG_FROM = 4;
const EDGE = 6;

/* ── The live's sound ───────────────────────────────────── */

/** How loud the live is under each passage: `points` are [frame of the video, 0 to 100] */
export function SoundLane({ points, total }: { points: [number, number][]; total: number }) {
  const shape = useMemo(() => {
    if (points.length === 0) return "";
    const x = (frame: number) => ((frame / total) * 100).toFixed(2);
    // (stretched between the calm of the video and its loudest moment: measured, a live is a grey band)
    const drawn = soundHeights(points);
    return [`${x(drawn[0][0])},100`, ...drawn.map(([frame, level]) => `${x(frame)},${(100 - level).toFixed(0)}`), `${x(drawn[drawn.length - 1][0])},100`].join(" ");
  }, [points, total]);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[24px] w-full" aria-hidden>
      <polygon points={shape} fill="#fff" opacity="0.4" />
    </svg>
  );
}

/* ── The chat ───────────────────────────────────────────── */

/** The chat's messages that are written on the video: a tick each where it comes up, its text when pointed at */
export function ChatLane({ messages, at, label }: { messages: { frame: number; author: string; text: string }[]; at: (frame: number) => string; label: string }) {
  return (
    <div data-lane role="list" aria-label={label} className="relative h-[12px] rounded-[3px] bg-white/[0.035]">
      {messages.slice(0, 400).map((message, k) => (
        <span key={k} role="listitem" title={`${message.author} : ${message.text}`} className="absolute top-[2px] bottom-[2px] w-[3px] -ml-px rounded-full bg-white/55 hover:bg-white hover:scale-y-150 transition-transform" style={{ left: at(message.frame) }} />
      ))}
    </div>
  );
}

/* ── The moves of the picture ───────────────────────────── */

interface MovesProps {
  moves: LaneMove[];
  /** Where each passage plays, and the passages themselves (a move is dated on its passage's clock) */
  spans: Span[];
  items: Map<string, CompilationItem>;
  fps: number;
  total: number;
  at: (frame: number) => string;
  lanes: RefObject<HTMLDivElement | null>;
  /** A click on a mark that was not dragged takes the video just before it */
  onSeek: (frame: number) => void;
  /** They can be put down, moved, stretched, changed and taken out (absent: only shown) */
  onAdd?: (item: string, at: number) => string | null;
  onChange?: (item: string, id: string, patch: MovePatch) => void;
  onRemove?: (item: string, id: string) => void;
}

/**
 * Where the picture moves, one mark a move at its place and its length. Pointing at an empty
 * place shows where a click would put one; a mark is dragged to another time, by an end to
 * another length; clicked, it says what it is and can become another kind, or go.
 */
export function MovesLane({ moves, spans, items, fps, total, at, lanes, onSeek, onAdd, onChange, onRemove }: MovesProps) {
  const { t, i18n } = useTranslation();
  const editable = !!onChange;
  const rows = useMemo(() => laneRows(moves), [moves]);
  // Where a click would put a move (the frame under the pointer), the mark being dragged, and the one whose menu is open
  const [ghost, setGhost] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: number; to: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  const frameAt = (clientX: number) => {
    const box = lanes.current?.getBoundingClientRect();
    return box && box.width > 0 ? Math.min(total - 1, Math.max(0, Math.round(((clientX - box.left) / box.width) * total))) : null;
  };
  const spanAt = (frame: number) => spans.find((span) => frame >= span.from && frame < span.to);
  /** A frame of the video as a time of its passage's live */
  const liveAt = (span: Span, frame: number) => (items.get(span.id)?.start ?? 0) + (frame - span.from) / fps;

  // The open menu closes on a click elsewhere and on Escape; Delete takes its move out
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !(e.target as HTMLElement).closest("[data-move], [data-move-menu]") && setOpen(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if ((e.key === "Delete" || e.key === "Backspace") && !(e.target as HTMLElement).closest("input, textarea")) {
        const move = moves.find((one) => one.id === open);
        if (move && onRemove) {
          e.preventDefault();
          onRemove(move.item, move.id);
          setOpen(null);
        }
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
    };
  }, [moves, onRemove, open]);
  // (a move that is gone has no menu)
  useEffect(() => {
    if (open && !moves.some((move) => move.id === open)) setOpen(null);
  }, [moves, open]);

  /** A mark pressed: dragged, it moves or one of its ends does; let go where it was, its menu opens */
  const press = (e: ReactPointerEvent, move: LaneMove) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const box = lanes.current?.getBoundingClientRect();
    const span = spans.find((one) => one.id === move.item);
    const item = items.get(move.item);
    if (!box || !span || !item || !editable) {
      onSeek(Math.max(0, move.from - Math.round(fps * 0.8)));
      return;
    }
    e.preventDefault();
    const mark = e.currentTarget.getBoundingClientRect();
    const mode = mark.width >= EDGE * 3 && e.clientX - mark.left < EDGE ? "start" : mark.width >= EDGE * 3 && mark.right - e.clientX < EDGE ? "end" : "move";
    const startX = e.clientX;
    const least = Math.max(1, Math.round(Math.min(MOVE_SPANS[move.kind].min, (span.to - span.from) / fps) * fps));
    const most = Math.round(MOVE_SPANS[move.kind].max * fps);
    let now = { from: move.from, to: move.to };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_FROM) return;
      moved = true;
      const by = Math.round(((ev.clientX - startX) / box.width) * total);
      if (mode === "move") {
        const length = move.to - move.from;
        const from = Math.min(Math.max(span.from, move.from + by), span.to - length);
        now = { from, to: from + length };
      } else if (mode === "start") {
        now = { from: Math.min(Math.max(span.from, move.from + by, move.to - most), move.to - least), to: move.to };
      } else {
        now = { from: move.from, to: Math.max(Math.min(span.to, move.to + by, move.from + most), move.from + least) };
      }
      setDrag({ id: move.id, ...now });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDrag(null);
      if (!moved) return setOpen((was) => (was === move.id ? null : move.id));
      onChange?.(move.item, move.id, { at: liveAt(span, now.from), for: (now.to - now.from) / fps });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /** The arrows nudge a mark that has the focus, a tenth of a second at a time (a second with Shift) */
  const nudge = (e: ReactKeyboardEvent, move: LaneMove) => {
    if (!editable || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const span = spans.find((one) => one.id === move.item);
    if (!span) return;
    e.preventDefault();
    e.stopPropagation();
    const by = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
    onChange?.(move.item, move.id, { at: liveAt(span, move.from) + by });
  };

  const opened = moves.find((move) => move.id === open);
  const length = (move: LaneMove) => ((move.to - move.from) / fps).toLocaleString(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const named = (move: LaneMove) => `${t(`montage.moves.${move.kind}`)} · ${clock(move.from / fps)} · ${length(move)} s`;
  const ghostSpan = ghost !== null && !drag && !open ? spanAt(ghost) : undefined;

  return (
    <div className="relative">
      <div
        data-lane
        role="list"
        aria-label={t("montage.moves.label")}
        className={`relative h-[22px] rounded-[4px] bg-white/[0.035] ${onAdd ? "cursor-copy" : ""}`}
        onPointerMove={(e) => onAdd && setGhost((e.target as HTMLElement).closest("[data-move]") ? null : frameAt(e.clientX))}
        onPointerLeave={() => setGhost(null)}
        onClick={(e) => {
          if (!onAdd || (e.target as HTMLElement).closest("[data-move]")) return;
          if (open) return setOpen(null);
          const frame = frameAt(e.clientX);
          const span = frame === null ? undefined : spanAt(frame);
          if (frame === null || !span) return;
          // (the mark starts a little before the pointer: it is put down around it)
          const made = onAdd(span.id, liveAt(span, Math.max(span.from, frame - Math.round(fps * 0.4))));
          setGhost(null);
          if (made) setOpen(made);
        }}
      >
        {moves.length === 0 && onAdd && ghost === null && <span className="absolute inset-0 grid place-items-center text-[10.5px] text-ink-4 pointer-events-none">{t("montage.moves.empty")}</span>}
        {/* Where a click would put one */}
        {ghostSpan && ghost !== null && (
          <span aria-hidden className="absolute top-[3px] h-[16px] min-w-[18px] rounded-[5px] border border-dashed border-accent-line bg-accent/10 grid place-items-center pointer-events-none" style={{ left: at(Math.max(ghostSpan.from, ghost - Math.round(fps * 0.4))), width: at(Math.round(fps * 1.5)) }}>
            <Plus className="w-2.5 h-2.5 text-accent" strokeWidth={3} />
          </span>
        )}
        {moves.map((move, k) => {
          const shown = drag?.id === move.id ? { ...move, from: drag.from, to: drag.to } : move;
          return (
            <button
              key={move.id}
              type="button"
              role="listitem"
              data-move
              title={named(shown)}
              aria-label={named(shown)}
              aria-expanded={open === move.id}
              onPointerDown={(e) => press(e, move)}
              onKeyDown={(e) => nudge(e, move)}
              className={`absolute h-2 min-w-[6px] rounded-full outline-none transition-[filter] hover:brightness-150 focus-visible:ring-2 focus-visible:ring-white ${MOVE_LOOK[move.kind]} ${open === move.id || drag?.id === move.id ? "ring-2 ring-white" : ""} ${editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
              style={{ left: at(shown.from), width: at(shown.to - shown.from), top: rows[k] === 0 ? 3 : 12 }}
            />
          );
        })}
      </div>

      {/* The move that was clicked: what it is, the other kinds it can be, and the way out */}
      {opened && (
        <div
          ref={menu}
          data-move-menu
          role="dialog"
          aria-label={named(opened)}
          className="absolute z-[6] bottom-full mb-2 -translate-x-1/2 p-1.5 rounded-[13px] bg-[#171a18]/[0.98] border border-white/[0.12] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] animate-fade-in"
          style={{ left: `clamp(150px, ${at((opened.from + opened.to) / 2)}, calc(100% - 150px))` }}
        >
          <p className="px-1.5 pb-1 text-[11.5px] text-ink-3 whitespace-nowrap">
            <b className="font-[600] text-white">{t(`montage.moves.${opened.kind}`)}</b> · <span className="mono">{clock(opened.from / fps)}</span> · {length(opened)} s
          </p>
          <div className="flex items-center gap-0.5">
            {MOVE_TYPES.map((kind) => {
              const Icon = MOVE_ICONS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={opened.kind === kind}
                  title={t(`montage.moves.${kind}`)}
                  aria-label={t(`montage.moves.${kind}`)}
                  disabled={!onChange}
                  onClick={() => onChange?.(opened.item, opened.id, { kind })}
                  className={`w-8 h-8 grid place-items-center rounded-[9px] transition-colors ${opened.kind === kind ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-white/[0.09] hover:text-white"}`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
          {/* Its own settings: how it comes (smoothly, or cut in), and how far it goes */}
          {onChange && (SHARP_KINDS.includes(opened.kind) || MOVE_AMOUNTS[opened.kind]) && (
            <div className="mt-1.5 flex items-center gap-1.5">
              {SHARP_KINDS.includes(opened.kind) && (
                <span role="group" aria-label={t("montage.moves.coming")} className="seg seg-sm">
                  {[false, true].map((sharp) => (
                    <button key={String(sharp)} type="button" aria-pressed={opened.sharp === sharp} onClick={() => onChange(opened.item, opened.id, { sharp })}>
                      {t(sharp ? "montage.moves.sharp" : "montage.moves.smooth")}
                    </button>
                  ))}
                </span>
              )}
              {MOVE_AMOUNTS[opened.kind] && (
                <span role="group" aria-label={t("montage.moves.strength")} className="seg seg-sm">
                  {STRENGTHS.map((strength) => (
                    <button key={strength} type="button" aria-pressed={opened.strength === strength} onClick={() => onChange(opened.item, opened.id, { strength })}>
                      {t(`montage.moves.${strength}`)}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between gap-1">
            <button type="button" title={t("montage.moves.see")} aria-label={t("montage.moves.see")} onClick={() => onSeek(Math.max(0, opened.from - Math.round(fps * 0.8)))} className="h-8 px-2 rounded-[9px] text-[12px] text-ink-2 hover:bg-white/[0.09] hover:text-white">
              {t("montage.moves.see")}
            </button>
            {onRemove && (
              <button
                type="button"
                title={t("montage.moves.remove")}
                aria-label={t("montage.moves.remove")}
                onClick={() => {
                  onRemove(opened.item, opened.id);
                  setOpen(null);
                }}
                className="w-8 h-8 grid place-items-center rounded-[9px] text-ink-2 hover:bg-[#ff8a7a]/15 hover:text-[#ff8a7a]"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The music's level under each passage ───────────────── */

interface MusicProps {
  curve: MusicCurve;
  /** Its level drawn over the video's length (the points of a polygon, 0-100 each way) */
  shape: string;
  spans: Span[];
  fps: number;
  at: (frame: number) => string;
  /** The passages whose level was set by hand */
  set: Set<string>;
  /** A passage's level set by hand, 0 to 1 as it is heard (null: back to what the app does by itself) */
  onLevel?: (item: string, level: number | null) => void;
}

/** How far the pointer travels for the whole range of the music's level, px */
const FULL_DRAG = 110;

/**
 * The music's level under the video. Under each passage it is dragged up and down (the value
 * is said while it moves); a double click gives the passage back to what the app does by
 * itself (lower where people talk).
 */
export function MusicLane({ curve, shape, spans, fps, at, set, onLevel }: MusicProps) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<{ id: string; level: number } | null>(null);
  const levelOf = (span: Span) => Math.min(1, gainAt(curve, (span.from + span.to) / 2 / fps));
  const press = (e: ReactPointerEvent, span: Span) => {
    if (e.button !== 0 || !onLevel) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const from = levelOf(span);
    let now = from;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < 3) return;
      moved = true;
      now = Math.round(Math.min(1, Math.max(0, from - (ev.clientY - startY) / FULL_DRAG)) * 100) / 100;
      setDrag({ id: span.id, level: now });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDrag(null);
      if (moved) onLevel(span.id, now);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  return (
    <div data-lane className="relative h-[26px]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon points={shape} fill="var(--color-accent)" opacity="0.5" />
      </svg>
      {onLevel &&
        spans.map((span) => {
          const level = drag?.id === span.id ? drag.level : levelOf(span);
          const said = `${t("montage.musicLevel", { percent: Math.round(level * 100) })}${set.has(span.id) ? ` · ${t("montage.musicLevelSet")}` : ""}`;
          return (
            <span
              key={span.id}
              role="slider"
              tabIndex={-1}
              aria-label={t("montage.musicLevelLabel")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
              title={`${said} — ${t("montage.musicLevelHint")}`}
              onPointerDown={(e) => press(e, span)}
              onDoubleClick={() => set.has(span.id) && onLevel(span.id, null)}
              className="group absolute inset-y-0 cursor-ns-resize"
              style={{ left: at(span.from), width: at(span.to - span.from) }}
            >
              {/* Its level: a line across the passage, lit when it was set by hand or is being dragged */}
              <span aria-hidden className={`absolute inset-x-[2px] h-[2px] -mt-px rounded-full transition-colors ${drag?.id === span.id ? "bg-white" : set.has(span.id) ? "bg-accent" : "bg-white/0 group-hover:bg-white/70"}`} style={{ top: `${(1 - level) * 100}%` }} />
              {drag?.id === span.id && <span className="mono absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-1.5 rounded-[5px] bg-white text-[#0b0b0c] text-[11px] leading-[17px] whitespace-nowrap pointer-events-none">{Math.round(level * 100)} %</span>}
            </span>
          );
        })}
    </div>
  );
}
