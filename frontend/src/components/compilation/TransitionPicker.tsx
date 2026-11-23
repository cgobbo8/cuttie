import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { PLAIN_CUT } from "../../lib/compilation";
import { isTransition, lookStyle, transitionAt, TRANSITION_IDS } from "../../lib/transitions";

const FPS = 30;
/** A sketch plays this many frames before its cut and after it, then starts again */
const LEAD = 12;
const TAIL = 30;
/** Where a sketch rests when nothing moves: just after the cut, the transition half done */
const STILL = 3;

/** The frame the sketches are on, counted from their cut: they all share one clock */
function useLoop(): number {
  const [frame, setFrame] = useState(STILL);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setFrame((Math.floor(((now - start) / 1000) * FPS) % (LEAD + TAIL)) - LEAD);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return frame;
}

/**
 * A transition drawn small, with the very numbers the video plays it with: the
 * picture before (grey), the one after (the channel's colour), `frame` frames
 * from the cut.
 */
export function TransitionSketch({ id, frame, width = 36 }: { id: string; frame: number; width?: number }) {
  const now = isTransition(id) ? transitionAt(id, frame, FPS) : null;
  const after = frame >= 0;
  return (
    <span aria-hidden className="relative block overflow-hidden rounded-[6px] bg-black" style={{ width, aspectRatio: "9 / 16" }}>
      {after && now?.held && <span className="sketch-picture sketch-before" style={lookStyle(now.held, width)} />}
      <span className={`sketch-picture ${after ? "sketch-after" : "sketch-before"}`} style={now ? lookStyle(now.piece, width) : undefined} />
      {now && now.flash > 0 && <span className="absolute inset-0 bg-white" style={{ opacity: now.flash }} />}
    </span>
  );
}

interface Props {
  title: string;
  /** What is chosen now: a transition, "cut" (none), or null: as the rest of the video */
  value: string | null;
  /** The video's own transition, offered as "like the video" (undefined: this picker chooses the video's) */
  video?: string | null;
  onPick: (value: string | null) => void;
  onClose: () => void;
  /** Where it sits against what opened it */
  className?: string;
  /** Laid inside the panel that opened it (not floating over it): it takes its width, and a click elsewhere leaves it open */
  inline?: boolean;
}

/** The ready-made transitions to choose from, each one playing in small */
export default function TransitionPicker({ title, value, video, onPick, onClose, className = "", inline = false }: Props) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const frame = useLoop();
  useEffect(() => {
    // (laid inside a panel, it stays open while the video is looked at: its panel closes it)
    const outside = (e: PointerEvent) => !inline && !box.current?.contains(e.target as Node) && onClose();
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [inline, onClose]);

  const choices: { value: string | null; sketch: string; label: string }[] = [
    ...(video !== undefined ? [{ value: null, sketch: video ?? PLAIN_CUT, label: t("compilation.transition.asVideo") }] : []),
    { value: PLAIN_CUT, sketch: PLAIN_CUT, label: t("compilation.transition.cut") },
    ...TRANSITION_IDS.map((id) => ({ value: id as string, sketch: id as string, label: t(`compilation.transition.${id}`) })),
  ];
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={title}
      data-nodrag
      onClick={(e) => e.stopPropagation()}
      className={inline ? "w-full" : `absolute z-40 w-[268px] p-2.5 rounded-[14px] bg-[#171a18]/[0.98] border border-white/[0.12] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] ${className}`}
    >
      {!inline && <p className="px-0.5 pb-2 text-[12px] font-[550] text-ink-2">{title}</p>}
      <div className="grid grid-cols-4 gap-1.5">
        {choices.map((choice) => {
          const chosen = choice.value === value;
          return (
            <button
              key={choice.value ?? "video"}
              type="button"
              aria-pressed={chosen}
              onClick={() => onPick(choice.value)}
              className={`relative flex flex-col items-center gap-1 pt-1.5 pb-1 rounded-[9px] border transition-colors ${chosen ? "border-accent bg-accent-soft" : "border-transparent hover:bg-white/[0.07]"}`}
            >
              <TransitionSketch id={choice.sketch} frame={frame} />
              <span className={`w-full min-h-[25px] px-0.5 grid place-items-center text-center text-[10.5px] leading-[1.15] ${chosen ? "text-white font-[550]" : "text-ink-2"}`}>{choice.label}</span>
              {chosen && (
                <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 grid place-items-center rounded-full bg-accent text-ground">
                  <Check className="w-2.5 h-2.5" strokeWidth={3.2} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
