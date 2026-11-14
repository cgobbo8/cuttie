import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Loader2, Maximize, Pause, Play, Plus, Scissors, Undo2, Volume2, VolumeX, X } from "lucide-react";
import { clipThumbUrl, clipUrl, type ClipChatLine, type TranscriptWord } from "../../lib/api";
import { clock } from "../../lib/format";
import type { Moment } from "../../lib/moments";
import {
  addPiece,
  gapsOf,
  joinTouching,
  MIN_PIECE,
  moveEdge,
  normalizeRanges,
  pieceAt,
  rangesLength,
  removePiece,
  sameRanges,
  snapToWords,
  splitAt,
  tighten,
  TOUCH,
  type Range,
} from "../../lib/montage";
import { stackChat } from "../../lib/chatActivity";
import { dragRatio } from "../../lib/drag";
import { Tooltip } from "../ui/Tooltip";
import { useToast } from "../Toast";

export interface MomentPlayerHandle {
  toggle: () => void;
  /** Jump to a time of the clip and play */
  playFrom: (seconds: number) => void;
  /** Cut at the playhead, or keep the part under it when it is cut out */
  cut: () => void;
  /** Take the last change of the cut back */
  undo: () => void;
  /** Replace the cut with these pieces (the AI's montage); it can be taken back like any change */
  setCut: (pieces: Range[]) => boolean;
}

interface Props {
  jobId: string;
  moment: Moment;
  categoryLabel: string | null;
  /** Start playing as soon as the clip is ready (after a user action) */
  autoPlay: boolean;
  /** The cut changed: one piece (a trim) or several played one after the other; null = the whole clip */
  onPiecesChange: (pieces: Range[] | null) => void;
  /** The chat's messages during the clip, shown on the trim strip */
  chat?: ClipChatLine[];
  /** The words said in the clip: cuts land between them, silences can be taken out */
  words?: TranscriptWord[];
  /** 30 s more cut on one side (the clip's file grows from the live when needed) */
  onExtend?: (side: "start" | "end") => Promise<void>;
  /** More cutting tools, after the built-in ones */
  tools?: ReactNode;
  /** Decision row, under the trim bar */
  children?: ReactNode;
}

const FILMSTRIP_FRAMES = 10;
/** A lone cut stays at least this long, seconds */
const MIN_TRIM = 1;
const CHAT_STACK_MAX = 4;
const UNDO_STEPS = 30;
/** How long a piece just made stays lit, ms */
const FRESH_MS = 1100;
/** Said once: what to do after the first cut */
const CUT_HINT_KEY = "cuttie_cut_hint";

const MomentPlayer = forwardRef<MomentPlayerHandle, Props>(function MomentPlayer(
  { jobId, moment, categoryLabel, autoPlay, onPiecesChange, chat, words, onExtend, tools, children },
  ref,
) {
  const { t } = useTranslation();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(moment.duration);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  // What gets exported: one piece (a trim) or several, played one after the other
  const [pieces, setPieces] = useState<Range[]>(moment.pieces);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  // The cuts before each change, to take them back (the count is state: the Undo button shows)
  const undoRef = useRef<Range[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const remember = (before: Range[]) => {
    undoRef.current = [...undoRef.current.slice(-(UNDO_STEPS - 1)), before];
    setUndoCount(undoRef.current.length);
  };
  const forget = () => {
    undoRef.current = [];
    setUndoCount(0);
  };
  const wordsRef = useRef(words);
  wordsRef.current = words;
  // Pieces just made (by a cut, or kept from a part that was cut out): lit for a moment so they are seen
  const [fresh, setFresh] = useState<number[]>([]);
  const freshTimer = useRef(0);
  const light = (indexes: number[]) => {
    setFresh(indexes);
    window.clearTimeout(freshTimer.current);
    freshTimer.current = window.setTimeout(() => setFresh([]), FRESH_MS);
  };
  useEffect(() => () => window.clearTimeout(freshTimer.current), []);

  const show = (next: Range[]) => {
    piecesRef.current = next;
    setPieces(next);
  };

  // New moment: reset everything (the <video> is keyed on the file)
  useEffect(() => {
    setDuration(moment.duration);
    setCurrent(moment.pieces[0]?.[0] ?? 0);
    show(moment.pieces);
    forget();
    setPlaying(false);
  }, [moment.filename]); // eslint-disable-line react-hooks/exhaustive-deps

  // The clip's file grew (30 s more): its length until the video says
  useEffect(() => {
    setDuration(moment.duration);
  }, [moment.duration]);

  // Same moment, cut changed from outside (back to the AI's cut, 30 s more, the AI's montage): the handles glide there
  const [glide, setGlide] = useState(false);
  const cutFile = useRef(moment.filename);
  const outsideCut = JSON.stringify(moment.pieces);
  useEffect(() => {
    // A new moment is the reset's job
    if (cutFile.current !== moment.filename) {
      cutFile.current = moment.filename;
      return;
    }
    const next = moment.trim || moment.pieces.length > 1 ? moment.pieces : [[0, durationRef.current] as Range];
    // The server rounds a trim to 0.1 s: not a change
    if (sameRanges(piecesRef.current, next, 0.15)) return;
    show(next);
    setGlide(true);
    const video = videoRef.current;
    if (video && pieceAt(next, video.currentTime) === -1) {
      video.currentTime = next[0][0];
      setCurrent(next[0][0]);
    }
    const settled = window.setTimeout(() => setGlide(false), 750);
    return () => window.clearTimeout(settled);
  }, [moment.filename, outsideCut]); // eslint-disable-line react-hooks/exhaustive-deps

  // "+30 s" on one side, one at a time
  const [extending, setExtending] = useState<"start" | "end" | null>(null);
  const extend = async (side: "start" | "end") => {
    if (!onExtend || extending) return;
    setExtending(side);
    try {
      await onExtend(side);
      // The clip's clock may have moved: the steps before it no longer stand
      forget();
    } finally {
      setExtending(null);
    }
  };
  // The clip's file changes when it grows: its video and frames are asked for again
  const version = `${moment.start}-${moment.end}`;
  const gliding = glide ? "transition-[left,width] duration-700 ease-glide" : "";
  const plus = (side: "start" | "end") => {
    if (!onExtend) return null;
    const label = t(side === "start" ? "project.extendStart" : "project.extendEnd");
    return (
      <Tooltip content={label}>
        <button
          type="button"
          onClick={() => extend(side)}
          disabled={!!extending}
          aria-label={label}
          data-busy={extending === side || undefined}
          className={`extend-plus absolute top-1/2 ${side === "start" ? "right-0" : "left-0"}`}
        >
          {extending === side ? <Loader2 className="w-4 h-4 spinner" /> : <Plus className="w-4 h-4" strokeWidth={2.4} />}
        </button>
      </Tooltip>
    );
  };

  /** Save the cut as it stands: tidy pieces, the whole clip when nothing is cut */
  const commit = useCallback(() => {
    const length = durationRef.current;
    const clean = normalizeRanges(piecesRef.current, length);
    if (clean.length === 0) return;
    if (!sameRanges(clean, piecesRef.current)) show(clean);
    const [a, b] = clean[0];
    const whole = clean.length === 1 && a <= 0.05 && b >= length - 0.05;
    // With a suggested cut, "the whole clip" is a choice of its own (null would bring the suggestion back)
    onPiecesChange(whole && !moment.suggested ? null : clean);
  }, [moment.suggested, onPiecesChange]);

  /** A change of the cut made in one go (cut, keep, remove, tighten): shown, saved, and it can be taken back */
  const change = useCallback(
    (next: Range[]): boolean => {
      const before = piecesRef.current;
      if (sameRanges(before, next)) return false;
      remember(before);
      show(next);
      commit();
      return true;
    },
    [commit],
  );

  const undo = useCallback(() => {
    const before = undoRef.current.pop();
    if (!before) return;
    setUndoCount(undoRef.current.length);
    show(before);
    commit();
  }, [commit]);

  /** At the playhead: cut the piece playing there in two, or keep the part under it when it is cut out */
  const cut = useCallback(() => {
    const time = videoRef.current?.currentTime ?? 0;
    const list = piecesRef.current;
    const heard = wordsRef.current;
    const playing = pieceAt(list, time);
    if (playing === -1) {
      // A new piece from here: 8 s, or up to the next piece
      const next = addPiece(list, time, durationRef.current);
      if (!change(next)) {
        toast.info(t("project.keepTooClose"));
        return;
      }
      light([piecesRef.current.findIndex(([a]) => Math.abs(a - time) < 0.02)]);
      return;
    }
    // Between two words rather than through one
    if (!change(splitAt(list, heard?.length ? snapToWords(time, heard) : time))) {
      toast.info(t("project.cutTooClose"));
      return;
    }
    light([playing, playing + 1]);
    // The first time: what a cut is for
    try {
      if (!localStorage.getItem(CUT_HINT_KEY)) {
        localStorage.setItem(CUT_HINT_KEY, "1");
        toast.info(t("project.cutDone"));
      }
    } catch {
      // No storage: no hint
    }
  }, [change, t, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const tightenUp = () => {
    const before = piecesRef.current;
    const next = tighten(before, wordsRef.current ?? [], durationRef.current);
    const saved = rangesLength(before) - rangesLength(next);
    if (saved < 0.3 || !change(next)) {
      toast.info(t("project.nothingToTighten"));
      return;
    }
    toast.success(t("project.tightened", { seconds: Math.round(saved) }));
  };

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const list = piecesRef.current;
      const i = pieceAt(list, video.currentTime);
      // At the end of a piece: on with the next one (the first after the last). In a part
      // that is cut out, it plays from there: that's how you hear what you would add
      const next = list[i + 1];
      if (i !== -1 && video.currentTime >= list[i][1] - 0.1 && !(next && next[0] - list[i][1] <= TOUCH)) video.currentTime = (next ?? list[0])[0];
      beforeRef.current = video.currentTime;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);
  const playFrom = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(seconds, 0), Math.max(0, durationRef.current - 0.1));
    beforeRef.current = video.currentTime;
    video.play().catch(() => {});
  }, []);
  const setCut = useCallback(
    (next: Range[]) => {
      const clean = normalizeRanges(next, durationRef.current);
      if (clean.length === 0 || !change(clean)) return false;
      // The handles glide to the new cut, the video goes to its start
      setGlide(true);
      window.setTimeout(() => setGlide(false), 750);
      const video = videoRef.current;
      if (video && pieceAt(clean, video.currentTime) === -1) {
        video.currentTime = clean[0][0];
        setCurrent(clean[0][0]);
      }
      return true;
    },
    [change],
  );
  useImperativeHandle(ref, () => ({ toggle, playFrom, cut, undo, setCut }), [toggle, playFrom, cut, undo, setCut]);

  // While it plays, the end of a piece goes straight on to the next one: the cuts as they will be
  const beforeRef = useRef(0);
  const follow = useCallback((video: HTMLVideoElement): boolean => {
    const time = video.currentTime;
    const before = beforeRef.current;
    const list = piecesRef.current;
    const i = pieceAt(list, before);
    // Played up to the end of its piece (a jump elsewhere is the streamer's)
    if (!video.paused && i !== -1 && time >= list[i][1] - 0.03 && time >= before && time - before < 1) {
      const next = list[i + 1];
      // The next piece starts right here: nothing to jump over
      if (next && next[0] - list[i][1] <= TOUCH) {
        beforeRef.current = Math.max(time, next[0]);
        return false;
      }
      const to = (next ?? list[0])[0];
      if (!next) video.pause();
      video.currentTime = to;
      beforeRef.current = to;
      setCurrent(to);
      return true;
    }
    beforeRef.current = time;
    return false;
  }, []);
  // Checked on every frame drawn (the video's own time events come 4 times a second: a cut would be late)
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let count = 0;
    const tick = () => {
      const video = videoRef.current;
      // The playhead moves smoothly without redrawing 60 times a second
      if (video && !video.paused && !follow(video) && ++count % 4 === 0) setCurrent(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, follow]);

  const seek = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(time, 0), duration);
    beforeRef.current = video.currentTime;
    setCurrent(video.currentTime);
  };

  /** Drag an edge of piece `index`: lands between two words (Alt: anywhere) */
  const dragEdge = (e: ReactPointerEvent, index: number, side: "start" | "end") => {
    const before = piecesRef.current;
    dragRatio(
      e,
      stripRef.current!,
      (ratio, alt) => {
        const heard = wordsRef.current;
        const time = ratio * duration;
        const next = moveEdge(piecesRef.current, index, side, !alt && heard?.length ? snapToWords(time, heard) : time, duration, before.length === 1 ? MIN_TRIM : MIN_PIECE);
        // Keep the ref in step: the drag can end before React renders
        show(next);
        if (videoRef.current) videoRef.current.currentTime = side === "start" ? next[index][0] : next[index][1];
      },
      () => {
        if (sameRanges(before, piecesRef.current)) return;
        // Dragged onto its neighbor: the two become one
        show(joinTouching(piecesRef.current, index, side));
        remember(before);
        commit();
      },
    );
  };

  const pct = (time: number) => `${(time / Math.max(duration, 0.1)) * 100}%`;
  const keys = moment.hp.llm?.key_moments ?? [];
  const first = pieces[0] ?? [0, duration];
  const last = pieces[pieces.length - 1] ?? first;
  const total = rangesLength(pieces);
  const inPiece = pieceAt(pieces, current) !== -1;
  const gaps = gapsOf(pieces, duration);

  // The chat: a dot per message (bots aside), stacked when they come together
  const chatColumns = useMemo(() => stackChat(chat ?? []), [chat]);

  return (
    <article className="glass-strong rounded-[20px] p-2.5">
      <div ref={boxRef} className="relative aspect-video rounded-[13px] overflow-hidden bg-black group/player">
        <video
          key={moment.filename}
          ref={videoRef}
          src={clipUrl(jobId, moment.filename, version)}
          poster={clipThumbUrl(jobId, moment.filename, { width: 1280, version })}
          preload="metadata"
          playsInline
          muted={muted}
          className="w-full h-full object-contain rounded-none"
          onClick={toggle}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) {
              setDuration(d);
              durationRef.current = d;
              if (!moment.trim && moment.pieces.length === 1) show([[0, d]]);
              e.currentTarget.currentTime = piecesRef.current[0]?.[0] ?? 0;
            }
            if (autoPlay) e.currentTarget.play().catch(() => {});
          }}
          onTimeUpdate={(e) => {
            // Also follows the cuts when no frame is drawn (window in the background)
            if (!follow(e.currentTarget)) setCurrent(e.currentTarget.currentTime);
          }}
          onPlay={(e) => {
            beforeRef.current = e.currentTarget.currentTime;
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
        />

        <div className="absolute top-3 left-3 flex gap-1.5">
          <span className="chip glass-chip text-white h-[26px] mono">#{moment.rank}</span>
          {categoryLabel && <span className="chip glass-chip text-white h-[26px]">{categoryLabel}</span>}
        </div>
        <span className="absolute top-3 right-3 chip h-[26px] bg-accent text-accent-ink">
          <span className="mono">{moment.score}</span>
          <span className="font-medium opacity-70">/ 100</span>
        </span>

        {/* Glass transport bar over the video */}
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 h-[52px] pl-2 pr-3 rounded-[14px] glass-bar">
          <button onClick={toggle} aria-label={playing ? t("project.pause") : t("project.play")} className="btn btn-primary btn-icon w-9 h-9 rounded-[10px]">
            {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 translate-x-[1px]" fill="currentColor" />}
          </button>
          <span className="mono text-[12.5px] text-ink-2 whitespace-nowrap">
            {clock(current)} / {clock(duration)}
          </span>
          <div
            ref={scrubRef}
            className="relative flex-1 h-[22px] cursor-pointer"
            onPointerDown={(e) => dragRatio(e, scrubRef.current!, (r) => seek(r * duration))}
          >
            <div className="absolute inset-x-0 top-[9px] h-1 rounded-full bg-white/[0.22]" />
            {pieces.map(([a, b], i) => (
              <div key={i} className="absolute top-[9px] h-1 rounded-full bg-white/[0.18]" style={{ left: pct(a), width: pct(b - a) }} />
            ))}
            <div className="absolute left-0 top-[9px] h-1 rounded-full bg-ink" style={{ width: pct(current) }} />
            {keys.map((k) => (
              <span
                key={`${k.time}-${k.label}`}
                title={k.label}
                className="absolute top-[7px] w-2 h-2 -ml-1 rounded-full bg-accent shadow-[0_0_0_2px_rgba(11,11,12,0.7)]"
                style={{ left: pct(Math.min(k.time, duration)) }}
              />
            ))}
            <span className="absolute top-1 w-3.5 h-3.5 -ml-[7px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]" style={{ left: pct(current) }} />
          </div>
          <button onClick={() => setMuted((m) => !m)} aria-label={muted ? t("project.unmute") : t("project.mute")} className="text-ink-2 hover:text-white transition-colors">
            {muted ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
          </button>
          <button onClick={() => boxRef.current?.requestFullscreen?.()} aria-label={t("project.fullscreen")} className="text-ink-2 hover:text-white transition-colors">
            <Maximize className="w-[17px] h-[17px]" />
          </button>
        </div>
      </div>

      {/* The cut: drag the handles of a piece; click or drag elsewhere to move through the clip; + for 30 s more */}
      <div className="group/trim flex items-center gap-3 px-1.5 pt-3 pb-1">
        <div className="relative w-[92px] flex-none">
          <div className="text-[11.5px] text-ink-3">{t("project.start")}</div>
          <div className="mono text-[13px] font-medium text-white">{clock(first[0])}</div>
          {plus("start")}
        </div>
        <div
          ref={stripRef}
          className="relative flex-1 h-[52px] rounded-[9px] overflow-hidden bg-black select-none cursor-pointer touch-none"
          onPointerDown={(e) => dragRatio(e, stripRef.current!, (r) => seek(r * duration))}
        >
          <div className="absolute inset-0 flex">
            {Array.from({ length: FILMSTRIP_FRAMES }, (_, i) => (
              <img
                key={i}
                src={clipThumbUrl(jobId, moment.filename, { time: ((i + 0.5) * moment.duration) / FILMSTRIP_FRAMES, version })}
                alt=""
                draggable={false}
                className="flex-1 min-w-0 h-full object-cover"
              />
            ))}
          </div>
          {/* What is cut out, darkened */}
          {gaps.map(([a, b], i) => (
            <div key={`gap-${i}`} className={`absolute inset-y-0 bg-black/70 ${gliding}`} style={{ left: pct(a), width: pct(b - a) }} />
          ))}
          {pieces.map(([a, b], i) => (
            <div
              key={`piece-${i}`}
              data-fresh={fresh.includes(i) || undefined}
              className={`group/piece piece absolute inset-y-0 border-y-2 border-accent ${gliding}`}
              style={{ left: pct(a), width: pct(b - a) }}
            >
              {pieces.length > 1 && (
                <Tooltip content={t("project.removePiece")}>
                  <button
                    type="button"
                    aria-label={t("project.removePiece")}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      change(removePiece(piecesRef.current, i));
                    }}
                    className="piece-remove absolute top-1 left-1/2 -translate-x-1/2"
                  >
                    <X className="w-3 h-3" strokeWidth={2.6} />
                  </button>
                </Tooltip>
              )}
            </div>
          ))}
          {extending && <div className="extend-glow absolute inset-y-0 w-1/4 pointer-events-none" data-side={extending} />}
          {keys.map((k) => (
            <span
              key={`${k.time}-${k.label}`}
              className="absolute top-0 w-1.5 h-1.5 -ml-[3px] rounded-b-full bg-accent pointer-events-none"
              style={{ left: pct(Math.min(k.time, duration)) }}
            />
          ))}
          {chatColumns.map((column, i) => (
            <span
              key={`${moment.filename}-${column.t}`}
              title={column.lines.map((m) => `${m.author} : ${m.text}`).join("\n")}
              className="chat-stack"
              style={{ left: pct(Math.min(column.t, duration)), "--d": `${Math.min(i * 35, 700)}ms` } as CSSProperties}
            >
              {column.lines.slice(0, CHAT_STACK_MAX).map((_, k) => (
                <span key={k} />
              ))}
            </span>
          ))}
          <span className="absolute inset-y-0 w-0.5 -ml-px bg-white shadow-[0_0_6px_rgba(0,0,0,0.6)] pointer-events-none" style={{ left: pct(current) }}>
            <span className="absolute -top-px left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white" />
          </span>
          {pieces.flatMap(([a, b], i) =>
            (["start", "end"] as const).map((side) => (
              <span
                key={`${i}-${side}`}
                role="slider"
                aria-label={side === "start" ? t("project.trimStart") : t("project.trimEnd")}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(side === "start" ? a : b)}
                tabIndex={0}
                onPointerDown={(e) => dragEdge(e, i, side)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  e.stopPropagation();
                  const step = e.key === "ArrowLeft" ? -1 : 1;
                  const list = piecesRef.current;
                  if (!list[i]) return;
                  change(moveEdge(list, i, side, (side === "start" ? list[i][0] : list[i][1]) + step, duration, list.length === 1 ? MIN_TRIM : MIN_PIECE));
                }}
                // Several pieces: slim handles, the frames stay visible between them
                className={`absolute inset-y-0 ${pieces.length > 1 ? "w-[7px] rounded-[3px]" : "w-3 rounded-[4px]"} bg-accent shadow-[0_0_0_1px_rgba(11,11,12,0.7)] cursor-ew-resize grid place-items-center ${side === "start" ? "" : "-translate-x-full"} ${gliding}`}
                style={{ left: pct(side === "start" ? a : b) }}
              >
                <span className={`${pieces.length > 1 ? "w-px h-3" : "w-0.5 h-4"} rounded-full bg-accent-ink/60`} />
              </span>
            )),
          )}
        </div>
        <div className="relative w-[92px] flex-none text-right">
          <div className="text-[11.5px] text-ink-3">{t("project.end")}</div>
          <div className="mono text-[13px] font-medium text-white">{clock(last[1])}</div>
          {plus("end")}
        </div>
      </div>

      {/* Cutting tools: at the playhead, on the silences; what the cut makes in the end */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-1.5 pt-1.5">
        <Tooltip content={t(inPiece ? "project.cutHereHint" : "project.keepHereHint")}>
          <button type="button" onClick={cut} className="btn btn-ghost btn-sm h-7 px-2 -ml-2">
            {inPiece ? <Scissors className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" strokeWidth={2.4} />}
            {t(inPiece ? "project.cutHere" : "project.keepHere")}
            <kbd className="bg-white/[0.08] border-white/10 text-ink-2">C</kbd>
          </button>
        </Tooltip>
        <Tooltip content={t(words?.length ? "project.tightenHint" : "project.tightenNoWords")}>
          <button type="button" onClick={tightenUp} disabled={!words?.length} className="btn btn-ghost btn-sm h-7 px-2">
            <AudioLines className="w-3.5 h-3.5" /> {t("project.tighten")}
          </button>
        </Tooltip>
        {tools}
        {undoCount > 0 && (
          <button type="button" onClick={undo} className="btn btn-ghost btn-sm h-7 px-2">
            <Undo2 className="w-3.5 h-3.5" /> {t("project.undo")}
          </button>
        )}
        <span className="ml-auto pl-2 text-[12.5px] text-ink-3 whitespace-nowrap">
          {pieces.length > 1 && <>{t("project.pieces", { count: pieces.length })} · </>}
          <span className="mono text-ink-2">{clock(total)}</span>
        </span>
      </div>

      {children}
    </article>
  );
});

export default MomentPlayer;
