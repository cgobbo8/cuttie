import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Pencil, Search, Sparkles } from "lucide-react";
import type { VideoSource } from "../../lib/videoSources";

const TARGETS = [30, 60, 90, 180];
/** Longest description of a video the app takes (the API's own limit) */
const MAX_BRIEF = 4000;

interface Props {
  /** What the video is made from (a clip, a sequence, a compilation): the AI builds that */
  source: VideoSource;
  /**
   * The video is one the AI proposed and that is not built yet: what it noticed, the request it
   * wrote in the streamer's place, the length the video should have
   */
  idea?: { pitch: string; tags: string[]; score: number; brief: string; target: number } | null;
  /** About what building costs, as written on the button */
  cost: string | null;
  /** The AI is building it: what it did so far, a line each */
  working: string[] | null;
  /** The live can't be read (no transcript on this machine) */
  unreadable: boolean;
  onBuild: (brief: string, target: number) => void;
  /** Passages looked for by hand instead */
  onSearch: () => void;
}

/**
 * A video with nothing in it yet, where it will play: described in a few words, the AI builds
 * it (parts, passages, look); or it is one the AI proposed, built from the request it wrote.
 * Passages can also be looked for by hand. Once it exists, changes are asked of the assistant.
 */
export default function DescribeVideo({ source, idea = null, cost, working, unreadable, onBuild, onSearch }: Props) {
  const { t } = useTranslation();
  const [brief, setBrief] = useState("");
  const [target, setTarget] = useState(idea?.target ?? (source === "compilation" ? 90 : 60));
  // The request the AI wrote, open to be rewritten before the video is built
  const [rewriting, setRewriting] = useState(false);

  if (working) {
    return (
      <div role="status" aria-live="polite" className="glass rounded-[20px] p-5 w-full">
        <p className="flex items-center gap-2.5 text-[14px] font-[600] text-white">
          <Loader2 className="w-4 h-4 spinner text-accent" /> {t("describe.building")}
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {working.map((line, n) => (
            <li key={n} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-3">
              {n < working.length - 1 ? <Check className="flex-none mt-[2px] w-3 h-3 text-accent" strokeWidth={2.6} /> : <Loader2 className="flex-none mt-[2px] w-3 h-3 spinner text-accent" />}
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-snug text-ink-4">{t("describe.buildingHint")}</p>
      </div>
    );
  }

  if (idea && !rewriting) {
    return (
      <div className="glass rounded-[20px] p-5 w-full">
        <p className="flex items-center gap-2 text-[12px] font-[600] text-accent">
          <Sparkles className="w-3.5 h-3.5" /> {t("describe.ideaOf", { score: idea.score })}
        </p>
        <p className="mt-2 text-[14px] leading-[1.5] text-white">{idea.pitch}</p>
        {idea.tags.length > 0 && (
          <p className="mt-2.5 flex flex-wrap gap-1.5">
            {idea.tags.map((tag) => (
              <span key={tag} className="chip chip-neutral">
                {tag}
              </span>
            ))}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => onBuild(idea.brief, idea.target)} disabled={unreadable} className="btn btn-primary btn-sm">
            <Sparkles className="w-3.5 h-3.5" /> {t("compilation.buildVideo")}
            {cost && <span className="mono text-[11.5px] opacity-60">{cost}</span>}
          </button>
          <button
            onClick={() => {
              setBrief(idea.brief);
              setRewriting(true);
            }}
            className="btn btn-ghost btn-sm"
          >
            <Pencil className="w-3.5 h-3.5" /> {t("describe.rewrite")}
          </button>
        </div>
        {unreadable && <p className="mt-2.5 text-[12px] leading-snug text-ink-3">{t("compilation.noTranscript")}</p>}
      </div>
    );
  }

  const build = (e: FormEvent) => {
    e.preventDefault();
    if (brief.trim()) onBuild(brief.trim(), target);
  };
  return (
    <form onSubmit={build} className="glass rounded-[20px] p-4 w-full">
      <h2 className="px-0.5 text-[15px] font-[620] text-white">{t(`describe.title.${source}`)}</h2>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={5}
        maxLength={MAX_BRIEF}
        placeholder={t(source === "compilation" ? "compilation.briefPlaceholder" : `compilation.briefFor.${source}`)}
        aria-label={t(`describe.title.${source}`)}
        className="mt-2.5 w-full p-3 rounded-[11px] bg-black/30 border border-white/10 text-[14px] leading-snug text-white outline-none focus:border-accent-line placeholder:text-ink-3 resize-y"
      />
      <div role="group" aria-label={t("compilation.length")} className="seg mt-2">
        {TARGETS.map((seconds) => (
          <button key={seconds} type="button" aria-pressed={target === seconds} onClick={() => setTarget(seconds)}>
            {t(`compilation.target.${seconds}`)}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!brief.trim() || unreadable} className="btn btn-primary btn-sm">
          <Sparkles className="w-3.5 h-3.5" /> {t("compilation.buildVideo")}
          {cost && <span className="mono text-[11.5px] opacity-60">{cost}</span>}
        </button>
        <button type="button" onClick={onSearch} className="btn btn-ghost btn-sm">
          <Search className="w-3.5 h-3.5" /> {t("describe.byHand")}
        </button>
      </div>
      {unreadable && <p className="mt-2.5 text-[12px] leading-snug text-ink-3">{t("compilation.noTranscript")}</p>}
    </form>
  );
}
