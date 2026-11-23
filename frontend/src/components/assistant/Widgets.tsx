import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Check, Download, Loader2, Play, Plus, Square } from "lucide-react";
import {
  clipThumbUrl,
  clipUrl,
  ensurePieces,
  updateSelection,
  type AssistantBlock,
  type AssistantClip,
  type AssistantLive,
  type AssistantPassage,
  type AssistantVideo,
  type PieceState,
} from "../../lib/api";
import { useAssistant } from "../../lib/AssistantContext";
import { COSTS } from "../../lib/assistantSuggestions";
import { liveClock, newId } from "../../lib/compilation";
import { clock } from "../../lib/format";
import { SOURCE_ICONS } from "../live/SourceName";
import { useToast } from "../Toast";

/**
 * What the assistant shows in an answer instead of listing it, and what is done from there
 * without asking again: a video opens in its editor, an idea is built, a set of videos is
 * exported, a clip is kept, a passage is heard and added to the video on screen.
 */

const row = "flex items-center gap-2.5 p-1.5 rounded-[10px] text-left";
const thumb = "relative flex-none w-[58px] aspect-video rounded-[6px] overflow-hidden bg-black/60";
const small = "flex-none inline-flex items-center gap-1 h-7 px-2 rounded-[8px] text-[11.5px] font-[560] transition-colors";
const quiet = `${small} text-ink-2 hover:text-white hover:bg-white/[0.08]`;
const strong = `${small} bg-accent-soft text-accent hover:bg-accent/25`;

function VideoRow({ video, cost }: { video: AssistantVideo; cost: (dollars: number) => string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const Icon = SOURCE_ICONS[video.source] ?? SOURCE_ICONS.compilation;
  const idea = video.state === "idea";
  // An idea nobody built is looked at on its live's page; a video opens in its editor
  const open = () => navigate(idea ? `/${video.job}?video=${video.id}` : `/${video.job}/montage?v=${video.id}`);
  return (
    <div className={`${row} hover:bg-white/[0.05] transition-colors`}>
      <button onClick={open} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
        <span className={`${thumb} grid place-items-center`}>
          {video.cover && video.cover_job ? <img src={clipThumbUrl(video.cover_job, video.cover, { width: 480 })} alt="" className="w-full h-full object-cover" /> : <Icon className="w-4 h-4 text-ink-3" />}
        </span>
        <span className="flex-1 min-w-0">
          <b className="block truncate text-[12.5px] font-[560] text-white">{video.name}</b>
          <span className="block truncate text-[11px] text-ink-3">
            {t(`sources.one.${video.source}`)} · {idea ? t("assistant.widget.idea", { score: video.score ?? 0 }) : `${clock(video.seconds)} · ${t("assistant.widget.passages", { count: video.passages })}`}
            {video.state === "exported" && ` · ${t("assistant.widget.exported")}`}
          </span>
        </span>
      </button>
      {idea ? (
        // Built where it will be edited, as from its card on the live's page
        <button onClick={() => navigate(`/${video.job}/montage?v=${video.id}&build=1`)} className={strong} title={t("assistant.widget.buildHint")}>
          {t("assistant.widget.build")} <span className="mono opacity-70">{cost(COSTS.build)}</span>
        </button>
      ) : (
        <button onClick={open} className={quiet}>
          {t("assistant.widget.edit")}
        </button>
      )}
    </div>
  );
}

function ClipRow({ clip }: { clip: AssistantClip }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { notify } = useAssistant();
  const [state, setState] = useState<"kept" | "keeping" | null>(clip.state === "kept" ? "kept" : null);
  const keep = async () => {
    setState("keeping");
    try {
      await updateSelection(clip.job, clip.filename, { state: "kept" });
      setState("kept");
      notify([clip.job]);
    } catch {
      setState(null);
      toast.error(t("common.error"));
    }
  };
  return (
    <div className={`${row} hover:bg-white/[0.05] transition-colors`}>
      <button onClick={() => navigate(`/${clip.job}?clip=${encodeURIComponent(clip.filename)}`)} title={clip.seen} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
        <span className={thumb}>
          <img src={clipThumbUrl(clip.job, clip.filename, { width: 480 })} alt="" className="w-full h-full object-cover" />
        </span>
        <span className="flex-1 min-w-0">
          <b className="block truncate text-[12.5px] font-[560] text-white">{clip.name}</b>
          <span className="mono block truncate text-[11px] text-ink-3">
            {clip.score} · {clock(clip.length)} · {liveClock(clip.at)}
          </span>
        </span>
      </button>
      {state === "kept" ? (
        <span className={`${small} text-accent`}>
          <Check className="w-3 h-3" strokeWidth={2.6} /> {t("assistant.widget.kept")}
        </span>
      ) : (
        <button onClick={keep} disabled={state === "keeping"} className={quiet}>
          {state === "keeping" ? <Loader2 className="w-3 h-3 spinner" /> : <Plus className="w-3 h-3" strokeWidth={2.6} />} {t("assistant.widget.keep")}
        </button>
      )}
    </div>
  );
}

function LiveRow({ live, cost }: { live: AssistantLive; cost: (dollars: number) => string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { send, busy } = useAssistant();
  const day = live.date ? new Date(live.date).toLocaleDateString(i18n.language, { day: "numeric", month: "short" }) : "";
  const title = live.title || t("compilations.untitledLive");
  return (
    <div className={`${row} hover:bg-white/[0.05] transition-colors`}>
      <span className="flex-1 min-w-0">
        <b className="block truncate text-[12.5px] font-[560] text-white">{title}</b>
        <span className="block truncate text-[11px] text-ink-3">{[day, live.game, live.analysed ? null : t("assistant.widget.notAnalysed")].filter(Boolean).join(" · ")}</span>
      </span>
      {live.job && live.analysed ? (
        <button onClick={() => navigate(`/${live.job}`)} className={quiet}>
          {t("assistant.widget.open")}
        </button>
      ) : live.job ? (
        // (being analysed, or its analysis stopped: its page says where it stands)
        <button onClick={() => navigate(`/${live.job}`)} className={quiet}>
          {t("assistant.widget.follow")}
        </button>
      ) : (
        // Never analysed: asked of the assistant, which says the price and waits for a yes
        <button onClick={() => send(t("assistant.suggest.analyseNamed", { name: title }))} disabled={busy} className={strong}>
          {t("assistant.widget.analyse")} <span className="mono opacity-70">{cost(COSTS.analyse)}</span>
        </button>
      )}
    </div>
  );
}

interface PassageProps {
  passage: AssistantPassage;
  /** It is in the video on screen (added from here, or all at once) */
  added: "no" | "adding" | "yes";
  /** Adds it to the video on screen (none: no video is being edited) */
  onAdd?: () => void;
}

function PassageRow({ passage, added, onAdd }: PassageProps) {
  const { t } = useTranslation();
  const toast = useToast();
  // Its clip, cut from the live the first time it is played
  const id = useRef(newId());
  const [piece, setPiece] = useState<PieceState | null>(null);
  const [state, setState] = useState<"idle" | "cutting" | "playing">("idle");
  const video = useRef<HTMLVideoElement>(null);

  const play = async () => {
    if (state === "playing") {
      video.current?.pause();
      return setState("idle");
    }
    if (piece?.ready) return setState("playing");
    setState("cutting");
    try {
      const done = await ensurePieces(passage.job, [{ id: id.current, start: passage.start, end: passage.end }]);
      const cut = done.pieces.find((one) => one.id === id.current);
      if (!cut?.ready) throw new Error("not cut");
      setPiece(cut);
      setState("playing");
    } catch {
      setState("idle");
      toast.error(t("assistant.widget.noClip"));
    }
  };
  const from = piece ? Math.max(0, passage.start - (piece.file_start ?? passage.start)) : 0;
  const to = from + (passage.end - passage.start);

  return (
    <div className="p-1.5">
      <div className="flex items-start gap-2.5">
        <button onClick={play} aria-label={t(state === "playing" ? "assistant.widget.stop" : "assistant.widget.play")} className="flex-none mt-0.5 w-7 h-7 rounded-full grid place-items-center bg-white/[0.1] text-white hover:bg-white/[0.18] transition-colors">
          {state === "cutting" ? <Loader2 className="w-3.5 h-3.5 spinner" /> : state === "playing" ? <Square className="w-3 h-3" fill="currentColor" /> : <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />}
        </button>
        <span className="flex-1 min-w-0">
          <span className="block text-[12.5px] leading-snug text-white line-clamp-2">{passage.text || passage.why || "…"}</span>
          <span className="mono block text-[11px] text-ink-3">
            {liveClock(passage.start)} · {clock(passage.end - passage.start)}
          </span>
        </span>
        {onAdd && (
          <button onClick={onAdd} disabled={added !== "no"} className={added === "yes" ? `${small} text-accent` : quiet}>
            {added === "adding" ? <Loader2 className="w-3 h-3 spinner" /> : added === "yes" ? <Check className="w-3 h-3" strokeWidth={2.6} /> : <Plus className="w-3 h-3" strokeWidth={2.6} />}
            {t(added === "yes" ? "assistant.widget.added" : "assistant.widget.add")}
          </button>
        )}
      </div>
      {state === "playing" && piece && (
        <video
          ref={video}
          src={clipUrl(passage.job, piece.file)}
          autoPlay
          playsInline
          className="mt-2 w-full aspect-video rounded-[8px] bg-black"
          onLoadedMetadata={(e) => (e.currentTarget.currentTime = from)}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= to) {
              e.currentTarget.pause();
              setState("idle");
            }
          }}
          onEnded={() => setState("idle")}
        />
      )}
    </div>
  );
}

/** What is done with everything a card shows, under it */
const Foot = ({ children }: { children: ReactNode }) => <div className="mt-0.5 pt-1.5 px-1 pb-0.5 border-t border-white/[0.07] flex justify-end">{children}</div>;

function Videos({ items }: { items: AssistantVideo[] }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { act } = useAssistant();
  const [exporting, setExporting] = useState<"no" | "doing" | "done">("no");
  const cost = (dollars: number) => `≈ ${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(dollars)} $`;
  // Videos that exist and were never exported: all at once, one after the other
  const ready = items.filter((video) => video.state === "draft" && video.passages > 0);
  const exportAll = async () => {
    setExporting("doing");
    const done = (await act("export_videos", { videos: ready.map(({ job, id }) => ({ job, id })) })) as { started?: unknown[]; failed?: unknown[] } | null;
    const started = done?.started?.length ?? 0;
    setExporting(started > 0 ? "done" : "no");
    if (started > 0) toast.success(t("exportStep.started", { count: started }));
    if (done?.failed?.length || started === 0) toast.error(t("exportStep.someFailed", { count: done?.failed?.length ?? ready.length }));
  };
  return (
    <>
      {items.map((video) => (
        <VideoRow key={`${video.job}/${video.id}`} video={video} cost={cost} />
      ))}
      {ready.length > 1 && (
        <Foot>
          <button onClick={exportAll} disabled={exporting !== "no"} className={exporting === "done" ? `${small} text-accent` : strong}>
            {exporting === "doing" ? <Loader2 className="w-3 h-3 spinner" /> : exporting === "done" ? <Check className="w-3 h-3" strokeWidth={2.6} /> : <Download className="w-3 h-3" strokeWidth={2.4} />}
            {t(exporting === "done" ? "assistant.widget.exporting" : "assistant.widget.exportAll", { count: ready.length })}
          </button>
        </Foot>
      )}
    </>
  );
}

function Passages({ items, editing }: { items: AssistantPassage[]; editing: { job: string; video: string } | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { act } = useAssistant();
  const [added, setAdded] = useState<Record<number, "adding" | "yes">>({});
  const left = items.flatMap((_, n) => (added[n] ? [] : [n]));
  /** These passages go into the video on screen, at the end of its last part */
  const add = async (which: number[]) => {
    if (!editing || which.length === 0) return;
    setAdded((before) => ({ ...before, ...Object.fromEntries(which.map((n) => [n, "adding" as const])) }));
    const done = (await act("add_passages", { ...editing, passages: which.map((n) => items[n]) })) as { added?: number; error?: string } | null;
    const ok = !!done?.added || done?.error === "already there";
    setAdded((before) => {
      const next = { ...before };
      for (const n of which) {
        if (ok) next[n] = "yes";
        else delete next[n];
      }
      return next;
    });
    if (!ok) toast.error(t("assistant.widget.notAdded"));
  };
  return (
    <>
      {items.map((passage, n) => (
        <PassageRow key={`${passage.job}/${passage.start}/${n}`} passage={passage} added={added[n] ?? "no"} onAdd={editing ? () => add([n]) : undefined} />
      ))}
      {editing && items.length > 1 && (
        <Foot>
          <button onClick={() => add(left)} disabled={left.length === 0 || Object.values(added).includes("adding")} className={left.length === 0 ? `${small} text-accent` : strong}>
            {left.length === 0 ? <Check className="w-3 h-3" strokeWidth={2.6} /> : <Plus className="w-3 h-3" strokeWidth={2.6} />}
            {left.length === 0 ? t("assistant.widget.allAdded") : t("assistant.widget.addAll", { count: left.length })}
          </button>
        </Foot>
      )}
    </>
  );
}

/** One card of an answer */
export default function Widget({ block }: { block: Extract<AssistantBlock, { type: "widget" }> }) {
  const { i18n } = useTranslation();
  const { place } = useAssistant();
  const cost = (dollars: number) => `≈ ${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(dollars)} $`;
  // A passage goes into the video being edited, when there is one
  const editing = place?.page === "edit" && place.job && place.video ? { job: place.job, video: place.video.id } : null;
  return (
    <div className="mt-1 mb-2 p-1.5 rounded-[13px] bg-white/[0.05] border border-white/[0.08] flex flex-col gap-0.5">
      {block.kind === "videos" && <Videos items={block.items} />}
      {block.kind === "clips" && block.items.map((clip) => <ClipRow key={`${clip.job}/${clip.filename}`} clip={clip} />)}
      {block.kind === "lives" && block.items.map((live, n) => <LiveRow key={live.job ?? live.vod ?? n} live={live} cost={cost} />)}
      {block.kind === "passages" && <Passages items={block.items} editing={editing} />}
    </div>
  );
}
