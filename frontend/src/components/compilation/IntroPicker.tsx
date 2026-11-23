import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Play, Sparkles, Volume2, VolumeX } from "lucide-react";
import { hookSpan } from "../../lib/compilation";
import IntroCard, { INTRO_W, type IntroColors } from "../../lib/intro/IntroCard";
import { DEFAULT_HOOK_LOOK, defaultIntroSound, HOOK_MAX, HOOK_MIN, hookLook, INTRO_PACKS, INTRO_SOUND_IDS, introPack, introSpan, isIntro, isIntroSound, isJingle, NO_SOUND, type IntroChoice, type IntroPackId, type JingleId } from "../../lib/intro/intros";
import { snapToWords } from "../../lib/montage";
import { introSoundUrl } from "../../lib/music/sound";

const FPS = 30;
/** The sketches play their intro, show the video for a moment, then start again */
const LOOP = 96;
/** Where a sketch rests when nothing moves: everything has arrived */
const STILL = 40;
/** How long the sketch of a hook plays its moment (in a video: as long as the moment itself) */
const HOOK_SKETCH = 64;

export { introSoundUrl } from "../../lib/music/sound";

/** What an intro is drawn with: the channel, its colours, the font of the video's titles */
export interface IntroBrand {
  name: string;
  logo: string | null;
  colors: IntroColors;
  font: string;
}

/** The frame the sketches are on: they all share one clock */
export function useIntroLoop(): number {
  const [frame, setFrame] = useState(STILL);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setFrame(Math.floor(((now - start) / 1000) * FPS) % LOOP);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return frame;
}

/** An intro drawn small, as the video plays it, over a picture that stands for the video (`look`: the one that frames a hook) */
export function IntroSketch({ id, look, frame, brand, title, width = 60, follow = null }: { id: string; look?: string | null; frame: number; brand: IntroBrand; title: string; width?: number; follow?: [string, string] | null }) {
  const span = isIntro(id) ? introSpan(id, FPS) : null;
  const hold = id === "hook" ? HOOK_SKETCH : (span?.hold ?? 0);
  return (
    <div aria-hidden className="relative overflow-hidden rounded-[7px] bg-black" style={{ width, aspectRatio: "9 / 16" }}>
      <div className="sketch-picture sketch-after" />
      {isIntro(id) && span && frame < hold + span.out && (
        <div className="absolute left-0 top-0" style={{ width: INTRO_W, transform: `scale(${width / INTRO_W})`, transformOrigin: "0 0" }}>
          <IntroCard id={id} frame={frame} fps={FPS} title={title} name={brand.name} logo={brand.logo} colors={brand.colors} font={brand.font} follow={follow} hold={id === "hook" ? HOOK_SKETCH : undefined} look={look ?? undefined} />
        </div>
      )}
    </div>
  );
}

/** What a "hook" intro can open the video on, and what it opens on now */
export interface HookMenu {
  /** The video's passages a hook can play (all but the first, which would play twice in a row): `number` is its place in the video, times are its live's seconds */
  passages: { id: string; number: number; text: string; start: number; end: number }[];
  /** What plays now (null: the video has no passage to give) */
  moment: { item: string; start: number; end: number; auto: boolean } | null;
  /** The moment the app chose is the one the AI named as the video's hook */
  named?: boolean;
  /** The words of that moment's passage (live seconds): its cut lands between them */
  words?: { start: number; end: number }[];
  /** Plays the video from its first frame, to see the hook */
  onPlay?: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const hundredth = (s: number) => Math.round(s * 100) / 100;

/** The part of a passage a hook plays, set with two handles on the passage's own length (they land between words; Alt: freely) */
function HookTrim({ passage, moment, words, onChange }: { passage: HookMenu["passages"][number]; moment: { start: number; end: number }; words?: { start: number; end: number }[]; onChange: (start: number, end: number) => void }) {
  const { t, i18n } = useTranslation();
  const bar = useRef<HTMLDivElement>(null);
  const length = Math.max(0.01, passage.end - passage.start);
  const share = (time: number) => `${clamp(((time - passage.start) / length) * 100, 0, 100)}%`;
  const seconds = (s: number) => new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(s);
  const set = (edge: "start" | "end", time: number, from = moment) => {
    if (edge === "start") onChange(hundredth(clamp(time, Math.max(passage.start, from.end - HOOK_MAX), from.end - Math.min(HOOK_MIN, length))), from.end);
    else onChange(from.start, hundredth(clamp(time, from.start + Math.min(HOOK_MIN, length), Math.min(passage.end, from.start + HOOK_MAX))));
  };
  const drag = (edge: "start" | "end" | "all") => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !bar.current) return;
    e.preventDefault();
    e.stopPropagation();
    const box = bar.current.getBoundingClientRect();
    const from = { x: e.clientX, start: moment.start, end: moment.end };
    const move = (ev: PointerEvent) => {
      if (edge === "all") {
        // The whole window slides along the passage, its length kept
        const start = clamp(from.start + ((ev.clientX - from.x) / box.width) * length, passage.start, passage.end - (from.end - from.start));
        return onChange(hundredth(start), hundredth(start + from.end - from.start));
      }
      const raw = passage.start + clamp((ev.clientX - box.left) / box.width, 0, 1) * length;
      set(edge, !ev.altKey && words?.length ? snapToWords(raw, words as Parameters<typeof snapToWords>[1]) : raw, from);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const nudge = (edge: "start" | "end") => (e: ReactKeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? -0.1 : e.key === "ArrowRight" ? 0.1 : 0;
    if (!step) return;
    e.preventDefault();
    set(edge, (edge === "start" ? moment.start : moment.end) + step);
  };
  const handle = (edge: "start" | "end") => (
    <span
      role="slider"
      tabIndex={0}
      aria-label={t(edge === "start" ? "compilation.intro.hook.from" : "compilation.intro.hook.until")}
      aria-valuemin={0}
      aria-valuemax={Math.round(length * 10) / 10}
      aria-valuenow={Math.round(((edge === "start" ? moment.start : moment.end) - passage.start) * 10) / 10}
      onPointerDown={drag(edge)}
      onKeyDown={nudge(edge)}
      className={`absolute top-1/2 -translate-y-1/2 w-3 h-7 rounded-[4px] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent ${edge === "start" ? "-translate-x-full" : ""}`}
      style={{ left: share(edge === "start" ? moment.start : moment.end) }}
    />
  );
  return (
    <div>
      <div className="flex items-baseline justify-between px-0.5 pb-1.5">
        <span className="text-[11.5px] text-ink-3">{t("compilation.intro.hook.trim")}</span>
        <span className="text-[11.5px] text-ink-2 tabular-nums">{t("compilation.intro.hook.kept", { seconds: seconds(moment.end - moment.start), of: seconds(length) })}</span>
      </div>
      <div ref={bar} className="relative h-7 mx-3 rounded-[6px] bg-white/[0.08]">
        {/* What is said, word by word: where the cut can land */}
        {words?.map((word, i) => word.end > passage.start && word.start < passage.end && <span key={i} className="absolute top-2.5 bottom-2.5 rounded-full bg-white/20" style={{ left: share(word.start), right: `calc(100% - ${share(word.end)})` }} />)}
        <span onPointerDown={drag("all")} className="absolute inset-y-0 rounded-[3px] bg-accent/45 border-y-2 border-accent cursor-grab active:cursor-grabbing touch-none" style={{ left: share(moment.start), right: `calc(100% - ${share(moment.end)})` }} />
        {handle("start")}
        {handle("end")}
      </div>
    </div>
  );
}

interface Props {
  /** The intro the video has (null: none) */
  value: IntroChoice | null;
  brand: IntroBrand;
  /** The video's name: the intro's title unless it has its own */
  name: string;
  onChange: (next: IntroChoice | null) => void;
  onClose: () => void;
  /** What the picker is for (default: the video's intro) */
  heading?: string;
  /** What is chosen besides the style: its title and its sound ("all", a compilation), its sound (clips: each has its own title), nothing (a preferred intro) */
  fields?: "all" | "sound" | "style";
  /** Where it sits against what opened it */
  className?: string;
  /** Laid inside the panel that opened it (not floating over it): it takes its width, and a click elsewhere leaves it open */
  inline?: boolean;
  /** The pack shown first when nothing is chosen yet: the one of the look the video is dressed in */
  pack?: IntroPackId;
  /**
   * The "hook" intro (the best moment of the video played first): the passages it can play and
   * the one it plays. Without it that intro isn't offered here, except as a preferred intro.
   */
  hook?: HookMenu;
}

/** What a video opens with: nothing, a jingle, or its hook */
type Mode = "none" | "jingle" | "hook";

/**
 * What a video opens with, chosen in two steps. First the kind: nothing, a jingle (a ready-made
 * opening over the whole screen), or the hook (the best moment of the video played first). Then
 * its graphics: the jingles, or the looks that can frame a hook, which have the names of the
 * jingles. They come in packs, one shown at a time: Cuttie's twelve, drawn with the channel's
 * colours, and the GTA pack, drawn with its own. Each one plays in small with the channel's logo.
 */
export default function IntroPicker({ value, brand, name, onChange, onClose, heading, fields = "all", className = "", hook, pack: preferred, inline = false }: Props) {
  const { t, i18n } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const frame = useIntroLoop();
  const [title, setTitle] = useState(value?.title ?? "");
  const playing = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    // (laid inside a panel, it stays open while the video is looked at: its panel closes it)
    const outside = (e: PointerEvent) => !inline && !box.current?.contains(e.target as Node) && onClose();
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      playing.current?.pause();
    };
  }, [inline, onClose]);

  const shown = title.trim() || name;
  const follow: [string, string] = [t("compilation.intro.followLabel"), t("compilation.intro.followDone")];
  const style = value && isIntro(value.style) ? value.style : null;
  const mode: Mode = style === "hook" ? "hook" : style ? "jingle" : "none";
  // The jingle chosen, or the look of the hook: the same twelve names
  const graphic = style === "hook" ? hookLook(value) : isJingle(style) ? style : null;
  // The one chosen last: what going from "none" to a kind, or from one kind to the other, starts from
  const last = useRef<JingleId | null>(graphic);
  if (graphic) last.current = graphic;
  // The pack whose graphics are shown: the one of the graphic chosen, until another is opened
  const [pack, setPack] = useState<IntroPackId>(graphic ? introPack(graphic) : (preferred ?? "cuttie"));
  // The video's own pack comes first among the tabs
  const packs = [...INTRO_PACKS].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  // A hook needs a video made of several passages: it is offered there, and as the channel's preferred intro
  const modes: Mode[] = hook || fields === "style" ? ["none", "jingle", "hook"] : ["none", "jingle"];
  // Opened from a row near an edge of the window, it is pushed back inside (under the top bar, above the bottom)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || inline) return;
    el.style.transform = "";
    const { top, bottom } = el.getBoundingClientRect();
    const [min, max] = [76, window.innerHeight - 12];
    const shift = top < min ? min - top : bottom > max ? Math.max(min - top, max - bottom) : 0;
    if (shift) el.style.transform = `translateY(${Math.round(shift)}px)`;
  }, [inline, mode, fields, pack, hook?.passages.length]);
  /** Heard as soon as it is chosen */
  const listen = (id: string) => {
    try {
      playing.current?.pause();
      playing.current = new Audio(introSoundUrl(id));
      playing.current.volume = 0.6;
      void playing.current.play()?.catch(() => {});
    } catch {
      // Nothing to play it with: the choice is made all the same
    }
  };
  /** A jingle: what the video had set on its intro stays (its title, its sound, the follow button), what was the hook's goes */
  const pickJingle = (id: JingleId) => {
    const { hook: _moment, look: _look, ...rest } = value ?? { style: id };
    onChange({ ...rest, style: id });
    const sound = rest.sound === NO_SOUND ? null : isIntroSound(rest.sound) ? rest.sound : defaultIntroSound(id);
    if (sound) listen(sound);
  };
  /** The hook, framed by this look: it plays no sound of its own */
  const pickLook = (id: JingleId) => {
    const { sound: _sound, ...rest } = value ?? { style: "hook" };
    playing.current?.pause();
    onChange({ ...rest, style: "hook", look: id });
  };
  const pickMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "none") {
      playing.current?.pause();
      return onChange(null);
    }
    // The same graphics on the other side: a hook framed like the jingle it replaces, and the other way round
    const first = (INTRO_PACKS.find((one) => one.id === pack) ?? INTRO_PACKS[0]).jingles[0];
    if (next === "jingle") pickJingle(last.current ?? first);
    else pickLook(last.current ?? (pack === "cuttie" ? DEFAULT_HOOK_LOOK : first));
  };
  const pickSound = (sound: string | null) => {
    if (!value) return;
    const { sound: _before, ...rest } = value;
    onChange(sound ? { ...rest, sound } : rest);
    if (sound && sound !== NO_SOUND) listen(sound);
    else if (!sound && style && defaultIntroSound(style)) listen(defaultIntroSound(style)!);
    else playing.current?.pause();
  };
  const commitTitle = () => {
    if (!value) return;
    const next = title.trim().slice(0, 80);
    if (next === (value.title ?? "")) return;
    const { title: _before, ...rest } = value;
    onChange(next ? { ...rest, title: next } : rest);
  };
  const played = hook?.moment ? hook.passages.find((p) => p.id === hook.moment!.item) : undefined;
  /** The hook plays this passage (null: the app chooses), this part of it */
  const pickMoment = (passage: HookMenu["passages"][number] | null, span?: [number, number]) => {
    if (!value) return;
    const { hook: _before, ...rest } = value;
    if (!passage) return onChange(rest);
    const [start, end] = span ?? hookSpan(passage);
    onChange({ ...rest, hook: { item: passage.id, start, end } });
  };

  // The graphics shown: the looks of the hook when it is chosen, else the jingles (a click on one chooses a jingle)
  const looks = mode === "hook";
  const tile = (id: JingleId) => {
    const chosen = id === graphic;
    return (
      <button
        key={id}
        type="button"
        aria-pressed={chosen}
        onClick={() => (looks ? pickLook(id) : pickJingle(id))}
        className={`relative flex flex-col items-center gap-1.5 pt-2 pb-1.5 rounded-[10px] border transition-colors ${chosen ? "border-accent bg-accent-soft" : "border-transparent hover:bg-white/[0.07]"}`}
      >
        <IntroSketch id={looks ? "hook" : id} look={id} frame={frame} brand={brand} title={shown} follow={value?.follow === false ? null : follow} />
        <span className={`text-[11.5px] leading-none ${chosen ? "text-white font-[550]" : "text-ink-2"}`}>{t(`compilation.intro.style.${id}`)}</span>
        {chosen && (
          <span className="absolute top-1 right-1 w-4 h-4 grid place-items-center rounded-full bg-accent text-ground">
            <Check className="w-2.5 h-2.5" strokeWidth={3.2} />
          </span>
        )}
      </button>
    );
  };
  const chip = (key: string, label: string, chosen: boolean, onClick: () => void, icon = true) => (
    <button
      key={key}
      type="button"
      aria-pressed={chosen}
      onClick={onClick}
      className={`h-7 px-2.5 rounded-full border text-[11.5px] inline-flex items-center gap-1.5 transition-colors ${chosen ? "border-accent bg-accent-soft text-white" : "border-white/10 text-ink-2 hover:bg-white/[0.07]"}`}
    >
      {icon ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
      {label}
    </button>
  );

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={heading ?? t("compilation.intro.pick")}
      data-nodrag
      onClick={(e) => e.stopPropagation()}
      // Three rows of four graphics; what is set on the chosen one sits beside them, not under (the picker stays in the window)
      className={inline ? "w-full" : `absolute z-40 max-w-[calc(100vw-24px)] p-3 rounded-[14px] bg-[#171a18]/[0.98] border border-white/[0.12] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] ${fields === "style" ? "w-[304px]" : "w-[556px]"} ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
        {!inline && <p className="px-0.5 text-[12px] font-[550] text-ink-2">{heading ?? t("compilation.intro.pick")}</p>}
        {/* First what the video opens with; the graphics below are the ones of that kind */}
        <div role="group" aria-label={t("compilation.intro.kind")} className="seg">
          {modes.map((kind) => (
            <button key={kind} type="button" aria-pressed={mode === kind} onClick={() => pickMode(kind)}>
              {t(`compilation.intro.mode.${kind}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        <div className={inline ? "w-full" : "w-[280px] flex-none"}>
          <div role="tablist" aria-label={t("compilation.intro.pack.label")} className="flex gap-1 pb-2">
            {packs.map((one) => (
              <button
                key={one.id}
                type="button"
                role="tab"
                aria-selected={pack === one.id}
                onClick={() => setPack(one.id)}
                className={`h-6 px-2.5 rounded-full text-[11.5px] transition-colors ${pack === one.id ? "bg-white/[0.14] text-white font-[550]" : "text-ink-3 hover:text-white hover:bg-white/[0.07]"}`}
              >
                {t(`compilation.intro.pack.${one.id}`)}
              </button>
            ))}
          </div>
          <div className={`grid grid-cols-4 gap-1 content-start transition-opacity ${mode === "none" ? "opacity-55" : ""}`}>{(INTRO_PACKS.find((one) => one.id === pack) ?? INTRO_PACKS[0]).jingles.map(tile)}</div>
        </div>
        {mode === "none" && fields !== "style" && <p className="flex-1 min-w-[200px] px-0.5 pt-2 text-[12px] leading-relaxed text-ink-3">{t("compilation.intro.noneHint")}</p>}
        {style && fields !== "style" && (
          <div className="flex-1 min-w-[200px]">
            {mode === "hook" && <p className="px-0.5 pb-2.5 text-[12px] leading-relaxed text-ink-3">{t("compilation.intro.hook.hint")}</p>}
            <label className={fields === "all" ? "block" : "hidden"}>
              <span className="block px-0.5 pb-1 text-[11.5px] text-ink-3">{t("compilation.intro.title")}</span>
              <input
                value={title}
                maxLength={80}
                placeholder={name}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === "Enter" && commitTitle()}
                className="w-full h-8 px-2.5 rounded-[9px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line placeholder:text-ink-4"
              />
            </label>
            {/* The moment a hook plays: one of the video's passages, and the part of it that is kept */}
            {mode === "hook" && hook && (
              <div className="mt-3">
                <div className="flex items-center justify-between px-0.5 pb-1.5">
                  <span className="text-[11.5px] text-ink-3">{t("compilation.intro.hook.label")}</span>
                  {hook.onPlay && hook.moment && (
                    <button type="button" onClick={hook.onPlay} className="inline-flex items-center gap-1 text-[11.5px] text-accent hover:text-white transition-colors">
                      <Play className="w-3 h-3 fill-current" /> {t("compilation.intro.hook.play")}
                    </button>
                  )}
                </div>
                {hook.passages.length === 0 || !hook.moment ? (
                  <p className="px-0.5 text-[12px] leading-relaxed text-[#f0c987]">{t("compilation.intro.hook.needs")}</p>
                ) : (
                  <>
                    <div role="radiogroup" aria-label={t("compilation.intro.hook.label")} className="max-h-[138px] overflow-y-auto rounded-[9px] border border-white/10 bg-black/20">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={hook.moment.auto}
                        onClick={() => pickMoment(null)}
                        className={`w-full flex items-center gap-2 px-2.5 h-8 text-left text-[12px] transition-colors ${hook.moment.auto ? "bg-accent-soft text-white" : "text-ink-2 hover:bg-white/[0.06]"}`}
                      >
                        <Sparkles className="w-3 h-3 flex-none text-accent" />
                        <span className="flex-1 min-w-0 truncate">
                          {t(hook.named ? "compilation.intro.hook.autoAi" : "compilation.intro.hook.auto")}
                          {hook.moment.auto && played && <span className="text-ink-3"> · {t("compilation.intro.hook.passage", { number: played.number })}</span>}
                        </span>
                      </button>
                      {hook.passages.map((passage) => {
                        const chosen = !hook.moment!.auto && hook.moment!.item === passage.id;
                        return (
                          <button
                            key={passage.id}
                            type="button"
                            role="radio"
                            aria-checked={chosen}
                            onClick={() => pickMoment(passage)}
                            className={`w-full flex items-center gap-2 px-2.5 h-8 border-t border-white/[0.06] text-left text-[12px] transition-colors ${chosen ? "bg-accent-soft text-white" : "text-ink-2 hover:bg-white/[0.06]"}`}
                          >
                            <span className="w-4 flex-none text-right tabular-nums text-ink-3">{passage.number}</span>
                            <span className="flex-1 min-w-0 truncate">{passage.text || t("compilation.intro.hook.passage", { number: passage.number })}</span>
                            <span className="flex-none tabular-nums text-ink-3">{new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(passage.end - passage.start)} s</span>
                          </button>
                        );
                      })}
                    </div>
                    {played && (
                      <div className="mt-3">
                        <HookTrim passage={played} moment={hook.moment} words={hook.words} onChange={(start, end) => pickMoment(played, [start, end])} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <div className={`${fields === "all" ? "mt-3 " : "pt-1 "}flex items-center gap-3`}>
              <span className="flex-1 min-w-0 px-0.5 text-[12px] text-ink-2">{t("compilation.intro.followToggle")}</span>
              <button
                role="switch"
                aria-checked={value?.follow !== false}
                aria-label={t("compilation.intro.followToggle")}
                onClick={() => {
                  if (!value) return;
                  const { follow: _before, ...rest } = value;
                  onChange(value.follow === false ? rest : { ...rest, follow: false });
                }}
                className="switch flex-none"
              >
                <span />
              </button>
            </div>
            {/* A hook plays no sound of its own: its moment is heard */}
            {defaultIntroSound(style) && (
              <>
                <p className="mt-3 px-0.5 pb-1.5 text-[11.5px] text-ink-3">{t("compilation.intro.sound")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {chip("style", t("compilation.intro.soundOfStyle", { name: t(`compilation.intro.sounds.${defaultIntroSound(style)}`) }), value?.sound === undefined || (!isIntroSound(value.sound) && value.sound !== NO_SOUND), () => pickSound(null))}
                  {INTRO_SOUND_IDS.filter((id) => id !== defaultIntroSound(style)).map((id) => chip(id, t(`compilation.intro.sounds.${id}`), value?.sound === id, () => pickSound(id)))}
                  {chip(NO_SOUND, t("compilation.intro.noSound"), value?.sound === NO_SOUND, () => pickSound(NO_SOUND), false)}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
