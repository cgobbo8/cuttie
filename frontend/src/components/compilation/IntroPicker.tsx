import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Volume2, VolumeX } from "lucide-react";
import IntroCard, { INTRO_W, type IntroColors } from "../../lib/intro/IntroCard";
import { defaultIntroSound, INTRO_IDS, INTRO_SOUND_IDS, introSpan, isIntro, isIntroSound, NO_SOUND, type IntroChoice } from "../../lib/intro/intros";

const FPS = 30;
/** The sketches play their intro, show the video for a moment, then start again */
const LOOP = 96;
/** Where a sketch rests when nothing moves: everything has arrived */
const STILL = 40;

/** Where an intro's sound is served from (frontend/public/sounds) */
export const introSoundUrl = (id: string) => `/sounds/intro-${id}.mp3`;

/** What an intro is drawn with: the channel, its colours, the font of the video's titles */
export interface IntroBrand {
  name: string;
  logo: string | null;
  colors: IntroColors;
  font: string;
}

/** The frame the sketches are on: they all share one clock */
function useLoop(): number {
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

/** An intro drawn small, as the video plays it, over a picture that stands for the video */
export function IntroSketch({ id, frame, brand, title, width = 72 }: { id: string; frame: number; brand: IntroBrand; title: string; width?: number }) {
  const span = isIntro(id) ? introSpan(id, FPS) : null;
  return (
    <div aria-hidden className="relative overflow-hidden rounded-[7px] bg-black" style={{ width, aspectRatio: "9 / 16" }}>
      <div className="sketch-picture sketch-after" />
      {isIntro(id) && span && frame < span.hold + span.out && (
        <div className="absolute left-0 top-0" style={{ width: INTRO_W, transform: `scale(${width / INTRO_W})`, transformOrigin: "0 0" }}>
          <IntroCard id={id} frame={frame} fps={FPS} title={title} name={brand.name} logo={brand.logo} colors={brand.colors} font={brand.font} />
        </div>
      )}
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
  /** Where it sits against what opened it */
  className?: string;
}

/** The ready-made intros to choose from, each one playing in small with the channel's own logo and colours */
export default function IntroPicker({ value, brand, name, onChange, onClose, className = "" }: Props) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const frame = useLoop();
  const [title, setTitle] = useState(value?.title ?? "");
  const playing = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      playing.current?.pause();
    };
  }, [onClose]);

  const shown = title.trim() || name;
  const style = value && isIntro(value.style) ? value.style : null;
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
  const pickStyle = (id: string | null) => {
    if (!id) return onChange(null);
    onChange({ ...(value ?? {}), style: id });
    const sound = value?.sound === NO_SOUND ? null : isIntroSound(value?.sound) ? value.sound : isIntro(id) ? defaultIntroSound(id) : null;
    if (sound) listen(sound);
  };
  const pickSound = (sound: string | null) => {
    if (!value) return;
    const { sound: _before, ...rest } = value;
    onChange(sound ? { ...rest, sound } : rest);
    if (sound && sound !== NO_SOUND) listen(sound);
    else if (!sound && style) listen(defaultIntroSound(style));
    else playing.current?.pause();
  };
  const commitTitle = () => {
    if (!value) return;
    const next = title.trim().slice(0, 80);
    if (next === (value.title ?? "")) return;
    const { title: _before, ...rest } = value;
    onChange(next ? { ...rest, title: next } : rest);
  };

  const tile = (id: string | null, label: string) => {
    const chosen = id === style;
    return (
      <button
        key={id ?? "none"}
        type="button"
        aria-pressed={chosen}
        onClick={() => pickStyle(id)}
        className={`relative flex flex-col items-center gap-1.5 pt-2 pb-1.5 rounded-[10px] border transition-colors ${chosen ? "border-accent bg-accent-soft" : "border-transparent hover:bg-white/[0.07]"}`}
      >
        <IntroSketch id={id ?? ""} frame={frame} brand={brand} title={shown} />
        <span className={`text-[11.5px] leading-none ${chosen ? "text-white font-[550]" : "text-ink-2"}`}>{label}</span>
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
      aria-label={t("compilation.intro.pick")}
      data-nodrag
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-40 w-[304px] p-3 rounded-[14px] bg-[#171a18]/[0.98] border border-white/[0.12] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] ${className}`}
    >
      <p className="px-0.5 pb-2 text-[12px] font-[550] text-ink-2">{t("compilation.intro.pick")}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {tile(null, t("compilation.intro.none"))}
        {INTRO_IDS.map((id) => tile(id, t(`compilation.intro.style.${id}`)))}
      </div>
      {style && (
        <>
          <label className="block mt-3">
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
          <p className="mt-3 px-0.5 pb-1.5 text-[11.5px] text-ink-3">{t("compilation.intro.sound")}</p>
          <div className="flex flex-wrap gap-1.5">
            {chip("style", t("compilation.intro.soundOfStyle", { name: t(`compilation.intro.sounds.${defaultIntroSound(style)}`) }), value?.sound === undefined || (!isIntroSound(value.sound) && value.sound !== NO_SOUND), () => pickSound(null))}
            {INTRO_SOUND_IDS.filter((id) => id !== defaultIntroSound(style)).map((id) => chip(id, t(`compilation.intro.sounds.${id}`), value?.sound === id, () => pickSound(id)))}
            {chip(NO_SOUND, t("compilation.intro.noSound"), value?.sound === NO_SOUND, () => pickSound(NO_SOUND), false)}
          </div>
        </>
      )}
    </div>
  );
}
