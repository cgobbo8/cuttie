import { useCallback, useEffect, useRef, useState } from "react";
import { getClipWords, trimClip, type LlmAnalysis, type HotPoint, type TranscriptWord } from "../lib/api";

/* ── Types ──────────────────────────────────────────────── */

interface ClipEditorProps {
  videoUrl: string;
  clipFilename: string;
  jobId: string;
  llm: LlmAnalysis | null;
  clips: HotPoint[];
  selectedIdx: number;
  onSelectClip: (idx: number) => void;
  onClose: () => void;
  onSaved?: (newFilename: string) => void;
}

/* ── Helpers ─────────────────────────────────────────────── */

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

function fmtShort(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/* ── Timeline ────────────────────────────────────────────── */

function Timeline({
  currentTime,
  duration,
  inTime,
  outTime,
  onSeek,
  onInChange,
  onOutChange,
}: {
  currentTime: number;
  duration: number;
  inTime: number;
  outTime: number;
  onSeek: (t: number) => void;
  onInChange: (t: number) => void;
  onOutChange: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"playhead" | "in" | "out" | null>(null);

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  const timeFromX = useCallback(
    (clientX: number) => {
      if (!trackRef.current || duration <= 0) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
    },
    [duration],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const t = timeFromX(e.clientX);
      if (dragging === "playhead") onSeek(t);
      else if (dragging === "in") onInChange(Math.min(t, outTime - 0.1));
      else if (dragging === "out") onOutChange(Math.max(t, inTime + 0.1));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, timeFromX, onSeek, onInChange, onOutChange, inTime, outTime]);

  const ticks: number[] = [];
  if (duration > 0) {
    const step = duration <= 10 ? 1 : duration <= 30 ? 2 : duration <= 60 ? 5 : 10;
    for (let t = 0; t <= duration; t += step) ticks.push(t);
  }

  return (
    <div className="select-none px-4">
      {/* Ruler */}
      <div className="relative h-4 text-[9px] text-zinc-600 font-mono">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${pct(t)}%` }}>
            {fmtShort(t)}
          </span>
        ))}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-12 bg-white/[0.03] rounded-lg cursor-pointer"
        onMouseDown={(e) => {
          onSeek(timeFromX(e.clientX));
          setDragging("playhead");
        }}
      >
        {/* Dimmed before in */}
        <div
          className="absolute top-0 h-full bg-black/50 rounded-l-lg"
          style={{ left: 0, width: `${pct(inTime)}%` }}
        />
        {/* Dimmed after out */}
        <div
          className="absolute top-0 h-full bg-black/50 rounded-r-lg"
          style={{ left: `${pct(outTime)}%`, right: 0 }}
        />
        {/* Active region */}
        <div
          className="absolute top-0 h-full bg-white/[0.06] border-y border-white/[0.1]"
          style={{ left: `${pct(inTime)}%`, width: `${pct(outTime) - pct(inTime)}%` }}
        />

        {/* In handle */}
        <div
          className="absolute top-0 h-full cursor-col-resize z-10 flex items-center"
          style={{ left: `${pct(inTime)}%`, transform: "translateX(-50%)" }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging("in"); }}
        >
          <div className="w-1.5 h-8 bg-white rounded-full shadow-lg shadow-white/20 hover:bg-zinc-200 transition-colors" />
        </div>

        {/* Out handle */}
        <div
          className="absolute top-0 h-full cursor-col-resize z-10 flex items-center"
          style={{ left: `${pct(outTime)}%`, transform: "translateX(-50%)" }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging("out"); }}
        >
          <div className="w-1.5 h-8 bg-white rounded-full shadow-lg shadow-white/20 hover:bg-zinc-200 transition-colors" />
        </div>

        {/* Playhead */}
        <div
          className="absolute top-0 h-full z-20 pointer-events-none"
          style={{ left: `${pct(currentTime)}%` }}
        >
          <div className="w-0.5 h-full bg-white/90 -translate-x-1/2" />
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-2 bg-white rounded-b-sm" />
        </div>
      </div>
    </div>
  );
}

/* ── Left panel (Moments clés / Transcription toggle) ──── */

type LeftTab = "moments" | "transcript";

function MomentsView({
  llm,
  currentTime,
  onSeek,
}: {
  llm: LlmAnalysis | null;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const moments = llm?.key_moments ?? [];

  if (moments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-xs">
        Pas de moments cles
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-0.5 pr-1">
      {moments.map((moment, i) => {
        const isActive =
          currentTime >= moment.time &&
          (i === moments.length - 1 || currentTime < moments[i + 1].time);
        return (
          <button
            key={i}
            onClick={() => onSeek(moment.time)}
            className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs ${
              isActive
                ? "bg-white/[0.08] text-zinc-100"
                : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <span className={`font-mono text-[10px] shrink-0 mt-0.5 ${isActive ? "text-white" : "text-zinc-600"}`}>
                {fmtShort(moment.time)}
              </span>
              <div>
                <span className={`font-medium block ${isActive ? "text-zinc-100" : "text-zinc-300"}`}>
                  {moment.label}
                </span>
                {moment.description && (
                  <span className="text-zinc-500 text-[11px] leading-snug block mt-0.5">
                    {moment.description}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Group words into segments (~4 words each) for readable display */
function groupWords(words: TranscriptWord[], maxWords = 4, maxDuration = 3.0): { start: number; end: number; text: string }[] {
  const groups: { start: number; end: number; text: string }[] = [];
  let current: TranscriptWord[] = [];

  for (const w of words) {
    if (current.length > 0) {
      const dur = w.end - current[0].start;
      if (current.length >= maxWords || dur > maxDuration) {
        groups.push({
          start: current[0].start,
          end: current[current.length - 1].end,
          text: current.map((c) => c.word).join(" "),
        });
        current = [];
      }
    }
    current.push(w);
  }
  if (current.length > 0) {
    groups.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((c) => c.word).join(" "),
    });
  }
  return groups;
}

function TranscriptView({
  words,
  loading,
  currentTime,
  onSeek,
  fallbackText,
}: {
  words: TranscriptWord[];
  loading: boolean;
  currentTime: number;
  onSeek: (t: number) => void;
  fallbackText: string;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const el = activeRef.current;
      const top = el.offsetTop - container.offsetTop - container.clientHeight / 3;
      container.scrollTo({ top, behavior: "smooth" });
    }
  }, [currentTime]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-xs">
        <svg className="w-4 h-4 spinner text-white mr-2" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" opacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Chargement...
      </div>
    );
  }

  if (words.length === 0) {
    if (fallbackText) {
      return (
        <div className="h-full overflow-y-auto pr-1 px-3">
          <p className="text-[11px] text-zinc-400 leading-relaxed italic">{fallbackText}</p>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-xs">
        Pas de transcription
      </div>
    );
  }

  const segments = groupWords(words);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto space-y-0.5 pr-1">
      {segments.map((seg, i) => {
        const isActive = currentTime >= seg.start && currentTime < seg.end;
        const isPast = currentTime >= seg.end;
        return (
          <button
            key={i}
            ref={isActive ? activeRef : undefined}
            onClick={() => onSeek(seg.start)}
            className={`w-full text-left px-3 py-2 rounded-lg transition-all text-xs ${
              isActive
                ? "bg-white/[0.08] text-white"
                : isPast
                  ? "text-zinc-600 hover:bg-white/[0.03] hover:text-zinc-400"
                  : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <span className={`font-mono text-[10px] shrink-0 mt-0.5 ${isActive ? "text-white" : "text-zinc-600"}`}>
                {fmtShort(seg.start)}
              </span>
              <span className={isActive ? "font-medium" : ""}>{seg.text}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function LeftPanel({
  jobId,
  clipFilename,
  llm,
  currentTime,
  onSeek,
}: {
  jobId: string;
  clipFilename: string;
  llm: LlmAnalysis | null;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const hasMoments = (llm?.key_moments?.length ?? 0) > 0;
  const [tab, setTab] = useState<LeftTab>(hasMoments ? "moments" : "transcript");
  const [words, setWords] = useState<TranscriptWord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);
  const [wordsFetched, setWordsFetched] = useState(false);

  // Fetch words when switching to transcript tab
  useEffect(() => {
    if (tab !== "transcript" || wordsFetched) return;
    setWordsLoading(true);
    getClipWords(jobId, clipFilename)
      .then(setWords)
      .finally(() => {
        setWordsLoading(false);
        setWordsFetched(true);
      });
  }, [tab, jobId, clipFilename, wordsFetched]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab toggle */}
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06] flex gap-1">
        {(["moments", "transcript"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[11px] px-3 py-1.5 rounded-md transition-all font-medium ${
              tab === t
                ? "bg-white/[0.08] text-zinc-200"
                : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.03]"
            }`}
          >
            {t === "moments" ? "Moments cles" : "Transcription"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 p-2">
        {tab === "moments" ? (
          <MomentsView llm={llm} currentTime={currentTime} onSeek={onSeek} />
        ) : (
          <TranscriptView
            words={words}
            loading={wordsLoading}
            currentTime={currentTime}
            onSeek={onSeek}
            fallbackText={llm?.transcript ?? ""}
          />
        )}
      </div>
    </div>
  );
}

/* ── Main editor ─────────────────────────────────────────── */

export default function ClipEditor({
  videoUrl,
  clipFilename,
  jobId,
  llm,
  clips,
  selectedIdx,
  onSelectClip,
  onClose,
  onSaved,
}: ClipEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inTime, setInTime] = useState(0);
  const [outTime, setOutTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const onLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setOutTime(v.duration);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      if (v.currentTime >= outTime) v.currentTime = inTime;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [inTime, outTime]);

  const seek = useCallback((t: number) => {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, Math.min(t, duration));
  }, [duration]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < inTime || v.currentTime >= outTime) v.currentTime = inTime;
      v.play();
    } else {
      v.pause();
    }
  }, [inTime, outTime]);

  const markIn = useCallback(() => setInTime(Math.min(currentTime, outTime - 0.1)), [currentTime, outTime]);
  const markOut = useCallback(() => setOutTime(Math.max(currentTime, inTime + 0.1)), [currentTime, inTime]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const res = await trimClip(jobId, clipFilename, inTime, outTime);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Trim failed" }));
        throw new Error(err.detail || "Trim failed");
      }
      const data = await res.json();
      onSaved?.(data.filename);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }, [jobId, clipFilename, inTime, outTime, onSaved, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "i" || e.key === "I") markIn();
      if (e.key === "o" || e.key === "O") markOut();
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markIn, markOut, togglePlay, onClose]);

  /* ── Loading state ──────────────── */
  if (duration === 0) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <svg className="w-8 h-8 spinner text-white" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" opacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <video ref={videoRef} src={videoUrl} preload="metadata" onLoadedMetadata={onLoaded} className="hidden" />
      </div>
    );
  }

  /* ── Fullscreen editor ──────────── */
  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* ─── Top bar ─── */}
      <div className="shrink-0 h-12 border-b border-white/[0.06] flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1.5 text-xs"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Retour
          </button>
          <div className="h-5 w-px bg-white/[0.06]" />
          <span className="text-sm font-semibold text-white">Cuttie</span>
          <span className="text-[10px] text-zinc-600 font-mono">{clipFilename}</span>
        </div>

        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving || inTime >= outTime}
            className="text-xs px-4 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Export..." : "Exporter le trim"}
          </button>
        </div>
      </div>

      {/* ─── Clip selector (if multiple) ─── */}
      {clips.length > 1 && (
        <div className="shrink-0 border-b border-white/[0.06] px-4 py-2 flex gap-1.5 overflow-x-auto">
          {clips.map((hp, i) => {
            const score = hp.final_score ?? hp.score;
            return (
              <button
                key={i}
                onClick={() => onSelectClip(i)}
                className={`shrink-0 text-[11px] px-2.5 py-1 rounded-md transition-all ${
                  selectedIdx === i
                    ? "bg-white/[0.1] text-white border border-white/[0.15]"
                    : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.03]"
                }`}
              >
                {hp.timestamp_display}
                <span className="ml-1.5 opacity-50">{Math.round(score * 100)}%</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Main area: transcript + video ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Moments / Transcript */}
        <div className="w-72 shrink-0 border-r border-white/[0.06]">
          <LeftPanel
            jobId={jobId}
            clipFilename={clipFilename}
            llm={llm}
            currentTime={currentTime}
            onSeek={seek}
          />
        </div>

        {/* Center: Video */}
        <div className="flex-1 bg-black flex items-center justify-center min-w-0 relative">
          <div className="h-full py-4" style={{ aspectRatio: "9/16" }}>
            <video
              ref={videoRef}
              src={videoUrl}
              onLoadedMetadata={onLoaded}
              onClick={togglePlay}
              className="w-full h-full object-contain rounded-lg cursor-pointer"
              playsInline
            />
          </div>

          {/* Play overlay */}
          {!playing && (
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center transition-opacity"
            >
              <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center hover:bg-white/20 transition-colors">
                <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </button>
          )}

          {/* Timecode */}
          <div className="absolute bottom-6 right-4 bg-black/70 backdrop-blur-sm px-2.5 py-1 rounded-md text-[11px] font-mono text-white/70">
            {fmt(currentTime)} / {fmt(duration)}
          </div>
        </div>
      </div>

      {/* ─── Bottom: Timeline + Controls ─── */}
      <div className="shrink-0 border-t border-white/[0.06] bg-zinc-950/80 backdrop-blur-sm">
        {/* Timeline */}
        <div className="pt-3 pb-2">
          <Timeline
            currentTime={currentTime}
            duration={duration}
            inTime={inTime}
            outTime={outTime}
            onSeek={seek}
            onInChange={setInTime}
            onOutChange={setOutTime}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-2">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-md bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-zinc-300 hover:text-white transition-colors"
            >
              {playing ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div className="h-5 w-px bg-white/[0.06] mx-1" />

            <button
              onClick={markIn}
              className="text-[11px] px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors font-medium"
            >
              In [I]
            </button>
            <button
              onClick={markOut}
              className="text-[11px] px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors font-medium"
            >
              Out [O]
            </button>

            <div className="h-5 w-px bg-white/[0.06] mx-1" />

            <span className="text-[10px] text-zinc-600 font-mono">
              {fmt(inTime)} → {fmt(outTime)}
            </span>
            <span className="text-[10px] text-zinc-500 ml-1">
              ({(outTime - inTime).toFixed(1)}s)
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-zinc-600">
            <span><kbd className="text-zinc-500">Space</kbd> play</span>
            <span><kbd className="text-zinc-500">I</kbd> / <kbd className="text-zinc-500">O</kbd> in/out</span>
            <span><kbd className="text-zinc-500">Esc</kbd> quitter</span>
          </div>
        </div>
      </div>
    </div>
  );
}
