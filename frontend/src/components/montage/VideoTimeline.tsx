import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { PlayerRef } from "@remotion/player";
import { AudioLines, Check, Clapperboard, Eye, EyeOff, Loader2, MessageSquare, Music2, Pause, Play, X, ZoomIn } from "lucide-react";
import { clipThumbUrl, type Compilation } from "../../lib/api";
import { allItems } from "../../lib/compilation";
import type { LaneMove, MovePatch } from "../../lib/effectMoves";
import { ChatLane, MovesLane, MusicLane, SoundLane } from "./TimelineLanes";
import { clock } from "../../lib/format";
import { gainAt, type MusicCurve } from "../../lib/music/curve";
import { dropPlace, frameUnder, scrubClock, type DropPlace } from "../../lib/timelineDrop";

/** Where a passage plays in the whole video, frames */
export interface Mark {
  id: string;
  from: number;
  to: number;
  /** Its first frame once the transition it comes in with is over */
  clear: number;
}

interface Props {
  compilation: Compilation;
  marks: Mark[];
  fps: number;
  /** The whole video, frames (what it opens with included) */
  frames: number;
  /** What it opens with, and for how long (frames): a jingle, or a moment of the video played first (a hook) */
  opening: { frames: number; hook: boolean } | null;
  /** Each passage's clip, by passage id */
  pieces: Record<string, { job: string; file: string; file_start: number | null }>;
  /** The whole video's player (`playerKey` changes when it is another one) */
  player: RefObject<PlayerRef | null>;
  playerKey: string;
  playing: boolean;
  /** The passage open to be cut */
  selected: string | null;
  onSelect: (id: string) => void;
  /** The passages picked together (Ctrl / Cmd + click, Shift + click, Ctrl / Cmd + A): what the tools then work on */
  picked?: Set<string>;
  onPick?: (id: string, range: boolean) => void;
  onClearPicked?: () => void;
  /** Passages dragged to another place: into a part, right before one of its passages (null: at its end) */
  onMove?: (ids: string[], section: string, before: string | null) => void;
  /** The music's level over the video, when it plays one, and the track's name */
  music: { curve: MusicCurve; name: string } | null;
  /** The passages whose music level was set by hand, and what sets one (0 to 1 as it is heard; null: back to what the app does) */
  musicSet?: Set<string>;
  onMusicLevel?: (item: string, level: number | null) => void;
  /** How loud the live is under each passage: [frame of the video, 0 to 100] */
  sound?: [number, number][];
  /** Where the picture moves (the video's effects), each on its passage; with the three below they are put down, changed and taken out by hand */
  moves?: LaneMove[];
  onMoveAdd?: (item: string, at: number) => string | null;
  onMoveChange?: (item: string, id: string, patch: MovePatch) => void;
  onMoveRemove?: (item: string, id: string) => void;
  /** The chat's messages written on the video, when it shows the chat */
  chat?: { frame: number; author: string; text: string }[];
  /** Passages just added (lit) */
  fresh?: Set<string>;
  /** Passages whose clip is still being cut from the live */
  waiting: number;
  /** What cuts the passage under the playhead, on the right of the bar */
  tools?: ReactNode;
}

/** A press that moves less than this is a click, not a drag (px) */
const DRAG_FROM = 6;

/**
 * The whole video laid out over its length: what it opens with, its parts, each passage at its
 * own length, the music's level under them, and where the player is. All of it is moved by hand:
 * the playhead is dragged along it (anywhere that isn't a passage, or by its knob), a passage is
 * dragged to another place (all the picked ones with it), a click on one takes the video there and
 * opens it to be cut, Ctrl / Cmd + click picks several.
 */
export default function VideoTimeline({ compilation, marks, fps, frames, opening, pieces, player, playerKey, playing, selected, onSelect, picked, onPick, onClearPicked, onMove, music, musicSet, onMusicLevel, sound, moves, onMoveAdd, onMoveChange, onMoveRemove, chat, fresh, waiting, tools }: Props) {
  const { t } = useTranslation();
  const lanes = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState(0);
  const total = Math.max(1, frames);
  const at = (f: number) => `${Math.min(100, Math.max(0, (f / total) * 100))}%`;

  /** The playhead put where the video is (by hand, without a render per frame; the clock once a second) */
  const place = (f: number) => {
    if (head.current) head.current.style.left = at(f);
    if (bubble.current) bubble.current.textContent = scrubClock(f / fps);
    setFrame((before) => (Math.floor(before / fps) === Math.floor(f / fps) ? before : f));
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => placeRef.current(e.detail.frame);
    p.addEventListener("frameupdate", onFrame);
    placeRef.current(p.getCurrentFrame());
    setFrame(p.getCurrentFrame());
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [playerKey, total, fps]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => new Map(allItems(compilation).map((item) => [item.id, item])), [compilation]);
  const byId = useMemo(() => new Map(marks.map((mark) => [mark.id, mark])), [marks]);
  const partOf = useMemo(() => new Map(compilation.sections.flatMap((section) => section.items.map((item) => [item.id, section.id] as const))), [compilation]);
  // Each part over its passages
  const parts = compilation.sections.flatMap((section) => {
    const theirs = section.items.flatMap((item) => (byId.has(item.id) ? [byId.get(item.id)!] : []));
    return theirs.length > 0 ? [{ id: section.id, title: section.title.trim(), hidden: !!section.hidden, from: theirs[0].from, to: theirs[theirs.length - 1].to }] : [];
  });
  const named = compilation.titles && parts.some((part) => part.title);
  const itemsById = useMemo(() => new Map(allItems(compilation).map((item) => [item.id, item])), [compilation]);
  // The lanes under the passages: the live's sound, the moves of the picture (always there when one can be put down), the chat
  const showMoves = !!onMoveAdd || (moves?.length ?? 0) > 0;

  // The music's level, drawn over the video's length (a point every quarter of a second)
  const level = useMemo(() => {
    if (!music) return "";
    const seconds = total / fps;
    const points = Array.from({ length: Math.ceil(seconds * 4) + 1 }, (_, i) => {
      const time = Math.min(seconds, i / 4);
      return `${((time / seconds) * 100).toFixed(2)},${(100 - Math.min(1, gainAt(music.curve, time)) * 100).toFixed(1)}`;
    });
    return `0,100 ${points.join(" ")} 100,100`;
  }, [fps, music, total]);

  /* ── The playhead, dragged along the video ──────────────── */

  const [scrubbing, setScrubbing] = useState(false);
  /** A press anywhere that isn't a passage: the video goes there, and follows the pointer until it is let go */
  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-clip], [data-move], [data-lane], [data-move-menu]")) return;
    const p = player.current;
    const box = lanes.current?.getBoundingClientRect();
    if (!p || !box || box.width === 0) return;
    e.preventDefault();
    // Grabbed by its knob, it doesn't jump under the pointer: it keeps the place it was held at
    const held = (e.target as HTMLElement).closest("[data-knob]") ? e.clientX - (box.left + (p.getCurrentFrame() / Math.max(1, total - 1)) * box.width) : 0;
    // (the video stops while it is dragged, and plays on from where it is let go)
    const resume = p.isPlaying();
    if (resume) p.pause();
    let wanted = p.getCurrentFrame();
    let asked = 0;
    const go = () => {
      asked = 0;
      p.seekTo(wanted);
    };
    const to = (x: number) => {
      const now = lanes.current?.getBoundingClientRect() ?? box;
      wanted = frameUnder(x - held, now, total);
      place(wanted);
      // (the picture follows once per screen refresh, however fast the pointer moves)
      if (!asked) asked = requestAnimationFrame(go);
    };
    const move = (ev: PointerEvent) => to(ev.clientX);
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.classList.remove("scrubbing");
      if (asked) cancelAnimationFrame(asked);
      p.seekTo(wanted);
      setScrubbing(false);
      if (resume) p.play();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    document.body.classList.add("scrubbing");
    setScrubbing(true);
    to(e.clientX);
  };
  /** The playhead moved from the keyboard: a second at a time (five with Shift), or to either end */
  const step = (e: ReactKeyboardEvent) => {
    const p = player.current;
    if (!p) return;
    const by = (e.shiftKey ? 5 : 1) * fps;
    const now = p.getCurrentFrame();
    const next = e.key === "ArrowLeft" ? now - by : e.key === "ArrowRight" ? now + by : e.key === "Home" ? 0 : e.key === "End" ? total - 1 : null;
    if (next === null) return;
    e.preventDefault();
    p.seekTo(Math.min(total - 1, Math.max(0, next)));
  };

  /* ── Passages dragged to another place ──────────────────── */

  const [drag, setDrag] = useState<{ ids: string[]; dx: number; drop: DropPlace | null } | null>(null);
  // (the click that ends a drag is not a click on the passage)
  const justDragged = useRef(false);
  const press = (e: ReactPointerEvent, id: string) => {
    // (with a key held it is a pick, not a move)
    if (e.button !== 0 || !onMove || marks.length < 2 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const startX = e.clientX;
    // The picked ones move together when one of them is taken
    const ids = picked?.has(id) ? marks.filter((mark) => picked.has(mark.id)).map((mark) => mark.id) : [id];
    const around = marks.filter((mark) => mark.id === id || !ids.includes(mark.id));
    let active = false;
    let drop: DropPlace | null = null;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!active) {
        if (Math.abs(dx) < DRAG_FROM) return;
        active = true;
        document.body.classList.add("dragging-passages");
      }
      const box = lanes.current?.getBoundingClientRect();
      drop = box ? dropPlace(around, (one) => partOf.get(one), id, frameUnder(ev.clientX, box, total)) : null;
      setDrag({ ids, dx, drop });
    };
    const done = (moved: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      document.body.classList.remove("dragging-passages");
      setDrag(null);
      if (!active) return;
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      if (moved && drop) onMove(ids, drop.section, drop.before);
    };
    const up = () => done(true);
    const cancel = () => done(false);
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && done(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  };

  const marksEvery = total / fps > 150 ? 30 : total / fps > 50 ? 15 : 5;
  const picking = (picked?.size ?? 0) > 0;

  return (
    <section aria-label={t("montage.timeline")} className="mt-4 glass rounded-[20px] px-3.5 pt-3 pb-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <button
          onClick={() => player.current?.toggle()}
          aria-label={t(playing ? "montage.pause" : "montage.play")}
          className="w-9 h-9 flex-none rounded-full grid place-items-center bg-ink text-ground hover:brightness-90 transition-[filter]"
        >
          {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
        </button>
        <span className="mono text-[12.5px] text-ink-2 mx-1 tabular-nums">
          {clock(frame / fps)} / {clock(total / fps)}
        </span>
        {waiting > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
            <Loader2 className="w-3.5 h-3.5 spinner" /> {t("compilation.cuttingCount", { count: waiting })}
          </span>
        )}
        {/* Several passages picked: said here, where the tools that work on them are */}
        {picking && (
          <span className="inline-flex items-center h-7 pl-2.5 pr-1 gap-1 rounded-full bg-accent-soft border border-accent-line text-[12px] font-[550] text-white">
            {t("compilation.pickedCount", { count: picked!.size })}
            <button type="button" onClick={onClearPicked} aria-label={t("compilation.clearPicked")} title={t("compilation.clearPicked")} className="w-5 h-5 grid place-items-center rounded-full text-ink-2 hover:text-white hover:bg-white/15">
              <X className="w-3 h-3" strokeWidth={2.6} />
            </button>
          </span>
        )}
        <span className="flex-1" />
        {tools}
      </div>

      <div className="mt-4 flex gap-2.5">
        {/* What each lane is */}
        <div className="flex-none w-5 flex flex-col gap-1 text-ink-4">
          {named && <span className="h-[22px]" />}
          <span className="h-[52px]" />
          {sound && sound.length > 0 && (
            <span className="h-[20px] grid place-items-center" title={t("montage.soundLane")}>
              <AudioLines className="w-3.5 h-3.5" />
            </span>
          )}
          {showMoves && (
            <span className="h-[22px] grid place-items-center" title={t("montage.moves.label")}>
              <ZoomIn className="w-3.5 h-3.5" />
            </span>
          )}
          {chat && (
            <span className="h-[12px] grid place-items-center" title={t("montage.chatLane")}>
              <MessageSquare className="w-3 h-3" />
            </span>
          )}
          {music && (
            <span className="h-[26px] grid place-items-center" title={music.name}>
              <Music2 className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
        {/* Pressed anywhere but on a passage, the playhead comes under the pointer and follows it */}
        <div className="flex-1 min-w-0 select-none touch-pan-y cursor-pointer" onPointerDown={scrub}>
          <div ref={lanes} className="relative flex flex-col gap-1">
            {named && (
              <div className="relative h-[22px]">
                {parts.map((part) => (
                  <span
                    key={part.id}
                    className={`absolute inset-y-0 flex items-center gap-1.5 px-2 rounded-[6px] bg-white/[0.07] text-[11.5px] font-[600] whitespace-nowrap overflow-hidden ${part.hidden ? "text-ink-3" : "text-white"}`}
                    style={{ left: at(part.from), width: `calc(${at(part.to - part.from)} - 3px)` }}
                    title={part.title}
                  >
                    {part.title && (part.hidden ? <EyeOff className="w-3 h-3 flex-none" /> : <Eye className="w-3 h-3 flex-none text-ink-3" />)}
                    <span className="truncate">{part.title}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="relative h-[52px]">
              {opening && opening.frames > 0 && (
                <span className="absolute inset-y-0 left-0 flex items-center justify-center gap-1 rounded-[7px] bg-accent-soft text-accent text-[11px] font-[600] overflow-hidden" style={{ width: `calc(${at(opening.frames)} - 3px)` }} title={t(opening.hook ? "compilation.intro.style.hook" : "compilation.intro.label")}>
                  <Clapperboard className="w-3.5 h-3.5 flex-none" />
                </span>
              )}
              {marks.map((mark) => {
                const item = items.get(mark.id);
                const piece = pieces[mark.id];
                const on = mark.id === selected;
                const ticked = !!picked?.has(mark.id);
                const moving = !!drag?.ids.includes(mark.id);
                return (
                  <button
                    key={mark.id}
                    data-clip={mark.id}
                    onPointerDown={(e) => press(e, mark.id)}
                    onClick={(e) => {
                      if (justDragged.current) return;
                      if ((e.metaKey || e.ctrlKey) && onPick) onPick(mark.id, false);
                      else if (e.shiftKey && onPick) onPick(mark.id, true);
                      else onSelect(mark.id);
                    }}
                    title={item?.text || undefined}
                    aria-pressed={on || ticked}
                    className={`absolute inset-y-0 rounded-[7px] overflow-hidden bg-white/[0.06] bg-cover bg-center border-[1.5px] ${onMove && marks.length > 1 ? "cursor-grab" : ""} ${moving ? "z-[3] opacity-95 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.9)]" : "transition-[opacity,border-color]"} ${
                      ticked
                        ? "z-[1] opacity-100 border-accent shadow-[0_0_0_2px_var(--color-accent-soft)]"
                        : on
                          ? "z-[1] opacity-100 border-white shadow-[0_0_0_2px_rgba(255,255,255,0.2)]"
                          : fresh?.has(mark.id)
                            ? "opacity-100 border-accent"
                            : `${picking ? "opacity-55" : "opacity-75"} hover:opacity-100 border-transparent`
                    }`}
                    style={{
                      left: at(mark.from),
                      width: `calc(${at(mark.to - mark.from)} - 3px)`,
                      backgroundImage: piece && item && piece.file_start != null ? `url("${clipThumbUrl(piece.job, piece.file, { width: 480, time: Math.max(0, item.start - piece.file_start + 0.4) })}")` : undefined,
                      transform: moving ? `translateX(${drag!.dx}px)` : undefined,
                    }}
                  >
                    {ticked && (
                      <span aria-hidden className="absolute left-1 top-1 w-[15px] h-[15px] grid place-items-center rounded-[4px] bg-accent text-ground">
                        <Check className="w-2.5 h-2.5" strokeWidth={3.6} />
                      </span>
                    )}
                    <span className="mono absolute left-1 bottom-1 px-1 rounded-[3px] bg-black/65 text-[9.5px] leading-[14px] text-white">{clock((mark.to - mark.from) / fps)}</span>
                  </button>
                );
              })}
              {/* Where what is being dragged would land */}
              {drag?.drop && <span aria-hidden className="absolute -top-1 -bottom-1 z-[2] w-[3px] rounded-full bg-accent shadow-[0_0_10px_var(--color-accent-glow)] pointer-events-none" style={{ left: `calc(${at(drag.drop.at)} - 3px)` }} />}
            </div>
            {/* How loud the live is under each passage */}
            {sound && sound.length > 0 && <SoundLane points={sound} total={total} />}
            {/* Where the picture moves: put down, moved, stretched, changed and taken out by hand */}
            {showMoves && (
              <MovesLane
                moves={moves ?? []}
                spans={marks}
                items={itemsById}
                fps={fps}
                total={total}
                at={at}
                lanes={lanes}
                onSeek={(to) => player.current?.seekTo(Math.min(total - 1, Math.max(0, to)))}
                onAdd={onMoveAdd}
                onChange={onMoveChange}
                onRemove={onMoveRemove}
              />
            )}
            {/* The chat written on the video */}
            {chat && <ChatLane messages={chat} at={at} label={t("montage.chatLane")} />}
            {/* The music's level, dragged up and down under each passage */}
            {music && <MusicLane curve={music.curve} shape={level} spans={marks} fps={fps} at={at} set={musicSet ?? new Set()} onLevel={onMusicLevel} />}
            <span ref={head} className="absolute -top-1 -bottom-1 z-[4] w-[2px] -ml-px rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)] pointer-events-none" style={{ left: "0%" }}>
              {/* Its knob: what it is grabbed and moved by (the arrows move it a second at a time) */}
              <span
                data-knob
                role="slider"
                tabIndex={0}
                aria-label={t("montage.playhead")}
                aria-valuemin={0}
                aria-valuemax={Math.round(total / fps)}
                aria-valuenow={Math.round(frame / fps)}
                aria-valuetext={clock(frame / fps)}
                onKeyDown={step}
                className={`playhead-knob pointer-events-auto ${scrubbing ? "is-held" : ""}`}
              >
                <span ref={bubble} className="playhead-time mono" />
              </span>
            </span>
          </div>
          <div className="mono relative h-5 pt-1 text-[10px] text-ink-4">
            {Array.from({ length: Math.floor(total / fps / marksEvery) + 1 }, (_, i) => (
              <span key={i} className={`absolute top-1.5 ${i === 0 ? "" : "-translate-x-1/2"}`} style={{ left: at(i * marksEvery * fps) }}>
                {clock(i * marksEvery)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
