import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeftToLine, ArrowRightToLine, Loader2, Pause, Play, Plus, Volume2, VolumeX, X } from "lucide-react";
import { LiveError, liveWatchAt, liveWatchUrl, type LiveFailure, type TwitchStoryboard } from "../../lib/api";
import { liveClock } from "../../lib/compilation";
import { LONGEST_PICK, parseClock, pickedRange, spanText } from "../../lib/liveBrowse";
import { holds, playStream } from "../../lib/liveStream";
import { evenFrames, frameAt, tileStyle } from "../../lib/storyboard";

/** A live that can be gone through */
export interface BrowsedLive {
  job: string;
  label: string;
  duration: number;
  storyboard?: TwitchStoryboard;
  /** What the video already takes of it, seconds of the live */
  taken: [number, number][];
}

interface Props {
  lives: BrowsedLive[];
  /**
   * Where it opens: a live, and in it the time asked for (`at`: the passage open in the montage),
   * else where that live was left the last time, else `near` (the passage the video is on), else its beginning
   */
  initial?: { job: string; at: number | null; near?: number | null };
  /** A stretch of a live is added to the video; false: it could not be */
  onAdd: (job: string, start: number, end: number) => boolean;
  onClose: () => void;
}

/** Where each live was left, to come back there the next time (as long as the app stays open) */
const leftAt = new Map<string, number>();

/** Pictures across the strip */
const TILES = 22;
/** What the arrows move by, seconds (and with Shift) */
const STEP = 5;
const LEAP = 60;

/**
 * A live gone through by hand to take a passage of it: a player that goes to any time (typed, or
 * pointed at on the strip of the whole live), two marks set where it plays (« Début ici », « Fin
 * ici »), and the stretch between them added to the video. The live is watched in a small
 * rendition; the passage itself is cut from the full one once added, where it can be trimmed.
 */
export default function LiveBrowser({ lives, initial, onAdd, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [job, setJob] = useState(initial && lives.some((l) => l.job === initial.job) ? initial.job : lives[0].job);
  const live = lives.find((l) => l.job === job) ?? lives[0];
  const sheet = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  // The stream on screen: the live it is of, where it starts in it (the player's clock is that plus what it has played), and which one it is
  const [stream, setStream] = useState<{ job: string; from: number; turn: number } | null>(null);
  const originRef = useRef<number | null>(null);
  // Where to go inside a stream once it has come that far, and whether it plays from there
  const pending = useRef<{ offset: number; play: boolean } | null>(null);
  const asked = useRef(0);
  const [now, setNow] = useState(0);
  const nowRef = useRef(0);
  nowRef.current = now;
  const [loading, setLoading] = useState(false);
  // The player ran out of what it holds while playing, and waits for more
  const [stalled, setStalled] = useState(false);
  const [failure, setFailure] = useState<LiveFailure | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [marks, setMarks] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  // The time being typed (null: the field shows where the player is)
  const [typed, setTyped] = useState<string | null>(null);
  // Where the pointer is on the strip, and whether it is being dragged along it
  const [aim, setAim] = useState<{ at: number; x: number; held: boolean } | null>(null);
  const [added, setAdded] = useState(0);

  const goTo = useCallback(
    async (time: number, play?: boolean) => {
      const target = Math.min(Math.max(0, time), Math.max(0, live.duration - 1));
      const v = video.current;
      const start = play ?? (v ? !v.paused : false);
      nowRef.current = target;
      setNow(target);
      // Already in what the player holds: it goes there at once
      if (v && originRef.current !== null && !pending.current && holds(v, target - originRef.current)) {
        asked.current++;
        v.currentTime = Math.max(0, target - originRef.current);
        setLoading(false);
        if (start) v.play().catch(() => {});
        return;
      }
      const turn = ++asked.current;
      setLoading(true);
      setFailure(null);
      v?.pause();
      try {
        const { from } = await liveWatchAt(live.job, target);
        if (turn !== asked.current) return;
        pending.current = { offset: Math.max(0, target - from), play: start };
        originRef.current = from;
        setStream({ job: live.job, from, turn });
      } catch (err) {
        if (turn !== asked.current) return;
        setFailure(err instanceof LiveError ? err.reason : "failed");
        setLoading(false);
      }
    },
    [live.duration, live.job],
  );

  // The stream on screen has come far enough: the player goes where it was asked to, and plays if it was playing
  const settle = () => {
    const v = video.current;
    const wait = pending.current;
    if (!v || !wait || !holds(v, wait.offset)) return;
    pending.current = null;
    if (wait.offset > 0.05) v.currentTime = wait.offset;
    setLoading(false);
    if (wait.play) v.play().catch(() => {});
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // A stream asked for: read and fed to the player as it comes, until another one is asked for
  useEffect(() => {
    const v = video.current;
    if (!stream || !v) return;
    const fed = playStream(v, liveWatchUrl(stream.job, stream.from), {
      grown: () => settleRef.current(),
      wanted: () => pending.current?.offset ?? null,
      failed: () => {
        pending.current = null;
        setLoading(false);
        setFailure("failed");
      },
    });
    return () => fed.stop();
  }, [stream]);

  // It opens where it was asked to (the passage open in the montage), else where this live was left, stopped
  const opened = useRef(false);
  useEffect(() => {
    const first = !opened.current;
    opened.current = true;
    originRef.current = null;
    pending.current = null;
    setStream(null);
    setMarks({ start: null, end: null });
    const asked = first && initial?.job === live.job ? initial : null;
    goTo(asked?.at ?? leftAt.get(live.job) ?? asked?.near ?? 0, false);
    return () => {
      leftAt.set(live.job, nowRef.current);
    };
  }, [live.job]); // eslint-disable-line react-hooks/exhaustive-deps
  // While it is open the page behind takes no focus and no key: its own player would answer Space
  // and Enter in its place (it takes the focus back each time a passage is added to the video)
  useEffect(() => {
    const page = document.getElementById("root");
    const was = page?.inert ?? false;
    if (page) page.inert = true;
    sheet.current?.focus({ preventScroll: true });
    return () => {
      if (page) page.inert = was;
    };
  }, []);

  const picked = pickedRange(marks.start, marks.end, live.duration);
  const mark = (side: "start" | "end") => setMarks((before) => ({ ...before, [side]: Math.round(nowRef.current * 10) / 10 }));
  const add = () => {
    if (!picked) return;
    if (onAdd(live.job, picked.start, picked.end)) setAdded((count) => count + 1);
    setMarks({ start: null, end: null });
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  // Space plays, the arrows move (a minute with Shift), I and O set the two marks, Enter adds, Escape leaves
  const keys = useRef({ goTo, add, mark, toggle, onClose });
  keys.current = { goTo, add, mark, toggle, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return keys.current.onClose();
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      // (a button of the sheet that has the focus keeps its own Space and Enter)
      const onButton = !!el?.closest("[role=dialog] button");
      if (key === " " && !onButton) {
        e.preventDefault();
        keys.current.toggle();
      } else if (key === "arrowleft" || key === "arrowright") {
        e.preventDefault();
        keys.current.goTo(nowRef.current + (key === "arrowleft" ? -1 : 1) * (e.shiftKey ? LEAP : STEP));
      } else if (key === "i") keys.current.mark("start");
      else if (key === "o") keys.current.mark("end");
      else if (key === "enter" && !onButton) keys.current.add();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = Math.max(1, live.duration);
  const at = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / total) * 100))}%`;
  const under = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return { at: share * total, x: share * box.width };
  };
  // The strip of the whole live: pointed at, it says the time and shows the picture there; pressed, the player goes there
  const point = (e: ReactPointerEvent) => {
    const place = under(e.clientX);
    if (place) setAim((before) => ({ ...place, held: before?.held ?? false }));
  };
  const press = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const place = under(e.clientX);
    if (!place) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setAim({ ...place, held: true });
  };
  const release = (e: ReactPointerEvent) => {
    const place = under(e.clientX);
    const was = aim?.held;
    setAim(place ? { ...place, held: false } : null);
    if (was && place) goTo(place.at);
  };

  const submit = () => {
    const read = typed === null ? null : parseClock(typed);
    setTyped(null);
    if (read !== null) goTo(read);
  };
  const frames = live.storyboard;
  const nudge = "btn btn-glass btn-sm px-2.5 tabular-nums";

  // (over the whole window, the bar that floats at its top included: the page keeps its own layer under it)
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/55 backdrop-blur-[6px] animate-fade-in" onClick={onClose}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-browser-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        // (a button clicked does not take the focus: Space goes on playing and stopping the live)
        onMouseDown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}
        className="glass-strong rounded-[22px] p-4 sm:p-5 w-full max-w-[960px] max-h-full overflow-y-auto flex flex-col gap-3.5 outline-none animate-rise"
      >
        <div className="flex items-center gap-3 min-w-0">
          <h2 id="live-browser-title" className="flex-none text-[19px] font-semibold tracking-[-0.02em] text-white">
            {t("browse.title")}
          </h2>
          {lives.length > 1 ? (
            <select value={live.job} onChange={(e) => setJob(e.target.value)} aria-label={t("browse.live")} className="select-arrow flex-1 min-w-0 h-9 px-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line [color-scheme:dark]">
              {lives.map((one) => (
                <option key={one.job} value={one.job}>
                  {one.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="flex-1 min-w-0 truncate text-[13px] text-ink-3">{live.label}</span>
          )}
          {added > 0 && <span className="flex-none chip chip-accent h-7">{t("browse.added", { count: added })}</span>}
          <button type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="flex-none btn btn-ghost btn-icon w-9 h-9 text-ink-2 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* The live itself, from the time asked for: as wide as the sheet, or as the window's height leaves it */}
        <div className="relative aspect-video mx-auto rounded-[14px] overflow-hidden bg-black" style={{ width: "min(100%, calc((100dvh - 330px) * 16 / 9))", minWidth: "min(100%, 320px)" }}>
          {stream && (
            <video
              key={stream.turn}
              ref={video}
              playsInline
              muted={muted}
              className="absolute inset-0 w-full h-full object-contain"
              onClick={toggle}
              onTimeUpdate={(e) => !pending.current && originRef.current !== null && setNow(originRef.current + e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onWaiting={() => setStalled(true)}
              onPlaying={() => setStalled(false)}
              onCanPlay={() => setStalled(false)}
              // (a stream is a quarter of an hour of the live: at its end, the next one)
              onEnded={(e) => originRef.current !== null && goTo(originRef.current + e.currentTarget.currentTime + 0.05, true)}
              onError={() => {
                pending.current = null;
                setLoading(false);
                setFailure("failed");
              }}
            />
          )}
          {/* While the pointer is dragged along the strip, the picture of the live there (as Twitch keeps them: one every minute or so) */}
          {aim?.held && frames && <div aria-hidden className="absolute inset-0" style={{ ...tileStyle(frames, frameAt(frames, aim.at)), width: "100%", height: "100%" }} />}
          {(loading || failure || (stalled && playing)) && (
            <div className={`absolute inset-0 grid place-items-center text-center px-6 ${failure ? "bg-black/60" : "bg-black/30"}`}>
              {failure ? (
                <div className="flex flex-col items-center gap-3 max-w-[420px] text-[13px] leading-snug text-ink-2">
                  <span>{t(`compilation.failure.${failure}`)}</span>
                  {failure !== "live_gone" && (
                    <button type="button" onClick={() => goTo(nowRef.current)} className="btn btn-glass btn-sm">
                      {t("browse.retry")}
                    </button>
                  )}
                </div>
              ) : (
                <Loader2 className="w-6 h-6 spinner text-white" />
              )}
            </div>
          )}
        </div>

        {/* Where the player is, and how to go elsewhere: play, small steps, a time typed */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <button type="button" onClick={toggle} disabled={!stream || !!failure} aria-label={t(playing ? "montage.pause" : "montage.play")} className="w-10 h-10 flex-none rounded-full grid place-items-center bg-ink text-ground hover:brightness-90 transition-[filter] disabled:opacity-40">
            {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
          </button>
          <button type="button" onClick={() => setMuted((was) => !was)} aria-label={t(muted ? "browse.unmute" : "browse.mute")} title={t(muted ? "browse.unmute" : "browse.mute")} className="btn btn-ghost btn-icon w-9 h-9 text-ink-2 hover:text-white">
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
            {t("browse.goTo")}
            <input
              // (a player sits a hair before the second it was sent to: said as that second)
              value={typed ?? liveClock(now + 0.03)}
              inputMode="text"
              placeholder="3:20:00"
              aria-label={t("browse.goToHint")}
              title={t("browse.goToHint")}
              onFocus={(e) => {
                setTyped(liveClock(now + 0.03));
                e.currentTarget.select();
              }}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={submit}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
                  // (Escape in the field gives the time up, not the whole sheet)
                  e.nativeEvent.stopImmediatePropagation();
                  setTyped(null);
                  window.setTimeout(() => sheet.current?.focus({ preventScroll: true }));
                }
              }}
              className={`mono w-[104px] h-9 px-2.5 rounded-[10px] bg-black/30 border text-[14px] text-white text-center outline-none focus:border-accent-line ${typed !== null && parseClock(typed) === null ? "border-[#ff8a7a]/60" : "border-white/10"}`}
            />
            <span className="mono text-ink-4">/ {liveClock(live.duration)}</span>
          </label>
          {/* (the four steps stay together: in a narrow window they go to the next line as one) */}
          <div className="flex gap-2 ml-auto">
            {([-LEAP, -10, 10, LEAP] as const).map((by) => (
              <button key={by} type="button" onClick={() => goTo(nowRef.current + by)} className={nudge}>
                {by < 0 ? "−" : "+"}
                {Math.abs(by) >= 60 ? "1 min" : `${Math.abs(by)} s`}
              </button>
            ))}
          </div>
        </div>

        {/* The whole live: pointed at, it says the time; pressed, the player goes there */}
        <div className="relative pt-1">
          <div
            ref={strip}
            role="slider"
            tabIndex={-1}
            aria-label={t("browse.strip")}
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(now)}
            aria-valuetext={liveClock(now)}
            onPointerMove={point}
            onPointerDown={press}
            onPointerUp={release}
            onPointerLeave={() => setAim((before) => (before?.held ? before : null))}
            className="relative h-[58px] rounded-[10px] overflow-hidden flex bg-white/[0.05] cursor-pointer select-none touch-none"
          >
            {frames && evenFrames(frames, TILES).map((frame, k) => <div key={k} className="flex-1 h-full brightness-[0.62]" style={tileStyle(frames, frame)} />)}
            {/* What the video already takes of this live */}
            {live.taken.map(([from, to], k) => (
              <span key={k} aria-hidden className="absolute top-0 h-[5px] min-w-[3px] rounded-b-[2px] bg-accent" style={{ left: at(from), width: at(to - from) }} />
            ))}
            {/* The two marks, and the stretch between them */}
            {marks.start !== null && <span aria-hidden className="absolute inset-y-0 w-[2px] -ml-px bg-accent" style={{ left: at(marks.start) }} />}
            {marks.end !== null && <span aria-hidden className="absolute inset-y-0 w-[2px] -ml-px bg-accent" style={{ left: at(marks.end) }} />}
            {picked && <span aria-hidden className="absolute inset-y-0 min-w-[3px] bg-accent/35" style={{ left: at(picked.start), width: at(picked.end - picked.start) }} />}
            <span aria-hidden className="absolute inset-y-0 w-[2px] -ml-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" style={{ left: at(aim?.held ? aim.at : now) }} />
          </div>
          {aim && (
            <span aria-hidden className="mono pointer-events-none absolute bottom-full mb-0.5 -translate-x-1/2 px-1.5 rounded-[5px] bg-white text-[#0b0b0c] text-[11px] leading-[17px] whitespace-nowrap" style={{ left: Math.min(Math.max(aim.x, 30), (strip.current?.clientWidth ?? 60) - 30) }}>
              {liveClock(aim.at)}
            </span>
          )}
        </div>

        {/* The passage: two marks set where the player is, and the stretch between them added to the video */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <button type="button" onClick={() => mark("start")} disabled={!stream} title={`${t("browse.startHint")} (I)`} className="btn btn-glass btn-sm">
            <ArrowLeftToLine className="w-3.5 h-3.5" /> {t("browse.start")}
            {marks.start !== null && <span className="mono text-accent">{liveClock(marks.start)}</span>}
          </button>
          <button type="button" onClick={() => mark("end")} disabled={!stream} title={`${t("browse.endHint")} (O)`} className="btn btn-glass btn-sm">
            {t("browse.end")} <ArrowRightToLine className="w-3.5 h-3.5" />
            {marks.end !== null && <span className="mono text-accent">{liveClock(marks.end)}</span>}
          </button>
          <span className="flex-1 min-w-[160px] text-[12.5px] leading-snug text-ink-3">
            {picked
              ? t(picked.capped ? "browse.pickedCapped" : "browse.picked", { length: spanText(picked.end - picked.start, i18n.language), longest: Math.round(LONGEST_PICK / 60) })
              : marks.start !== null || marks.end !== null
                ? t(marks.start !== null && marks.end !== null ? "browse.tooShort" : marks.start !== null ? "browse.needEnd" : "browse.needStart")
                : t("browse.how")}
          </span>
          <button type="button" onClick={add} disabled={!picked} className="btn btn-primary btn-sm h-9 px-3.5 flex-none">
            <Plus className="w-4 h-4" strokeWidth={2.4} /> {t("browse.add")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
