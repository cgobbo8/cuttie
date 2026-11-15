import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pause, Play, Star } from "lucide-react";
import { MUSIC_KINDS, MUSIC_VOLUMES, MUSICS, musicUrl, type MusicChoice, type MusicTrack } from "../../lib/music/mix";

interface Props {
  /** The music the video has (null: none) */
  value: MusicChoice | null;
  /** The tracks whose file is on this machine */
  available: string[];
  /** The streamer's favourite for each kind of video (brand kit), by kind */
  favourites?: Record<string, string>;
  onChange: (next: MusicChoice | null) => void;
  onClose: () => void;
  /** Where it sits against what opened it */
  className?: string;
}

/** Plays a track from where it is in full swing: one at a time, stopped when the picker closes */
export function useListen() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  const toggle = (track: MusicTrack) => {
    if (playing === track.id) return stop();
    stop();
    try {
      const next = new Audio(musicUrl(track.id));
      next.volume = 0.5;
      next.currentTime = track.start;
      next.onended = () => setPlaying(null);
      audio.current = next;
      setPlaying(track.id);
      void next.play()?.catch(() => setPlaying(null));
    } catch {
      setPlaying(null);
    }
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { playing, toggle };
}

/** The musics a video can play in the background, by the kind of video they suit, each one to listen to */
export default function MusicPicker({ value, available, favourites = {}, onChange, onClose, className = "" }: Props) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const { playing, toggle } = useListen();
  useEffect(() => {
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  const tracks = MUSICS.filter((track) => available.includes(track.id));
  // Each track under the first kind it suits
  const groups = MUSIC_KINDS.map((kind) => ({ kind, tracks: tracks.filter((track) => track.kinds[0] === kind) })).filter((group) => group.tracks.length > 0);
  const volume = value?.volume ?? MUSIC_VOLUMES.normal;
  const pick = (track: string | null) => onChange(track ? { ...(value ?? {}), track } : null);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={t("compilation.music.pick")}
      data-nodrag
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-40 w-[340px] max-h-[min(460px,50dvh)] flex flex-col p-3 rounded-[14px] bg-[#171a18]/[0.98] border border-white/[0.12] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] ${className}`}
    >
      <p className="px-0.5 pb-2 text-[12px] font-[550] text-ink-2">{t("compilation.music.pick")}</p>
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 flex flex-col gap-0.5">
        <button
          type="button"
          aria-pressed={!value}
          onClick={() => pick(null)}
          className={`flex-none h-9 px-2.5 rounded-[9px] border text-left text-[13px] transition-colors ${!value ? "border-accent bg-accent-soft text-white" : "border-transparent text-ink-2 hover:bg-white/[0.07]"}`}
        >
          {t("compilation.music.none")}
        </button>
        {groups.map(({ kind, tracks: list }) => (
          <div key={kind}>
            <p className="px-1 pt-2.5 pb-1 text-[11px] font-[600] tracking-[0.04em] uppercase text-ink-3">{t(`compilation.music.kind.${kind}`)}</p>
            {list.map((track) => {
              const chosen = value?.track === track.id;
              const loved = Object.entries(favourites).filter(([, id]) => id === track.id).map(([liked]) => t(`compilation.music.kind.${liked}`));
              return (
                <div key={track.id} className={`flex items-start gap-2 p-1.5 rounded-[10px] border transition-colors ${chosen ? "border-accent bg-accent-soft" : "border-transparent hover:bg-white/[0.06]"}`}>
                  <button
                    type="button"
                    onClick={() => toggle(track)}
                    aria-label={t(playing === track.id ? "compilation.music.stop" : "compilation.music.listen", { name: track.name })}
                    className="flex-none w-8 h-8 mt-0.5 grid place-items-center rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-white"
                  >
                    {playing === track.id ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 translate-x-px" />}
                  </button>
                  <button type="button" aria-pressed={chosen} onClick={() => pick(track.id)} className="flex-1 min-w-0 text-left">
                    <span className="flex items-center gap-1.5 text-[13px] font-[550] text-white">
                      <span className="truncate">{track.name}</span>
                      {loved.length > 0 && <Star className="w-3 h-3 flex-none fill-accent text-accent" aria-label={t("compilation.music.favourite", { kinds: loved.join(", ") })} />}
                      {chosen && <Check className="w-3.5 h-3.5 flex-none text-accent" strokeWidth={3} />}
                    </span>
                    <span className="block text-[11.5px] leading-snug text-ink-3">{t(`compilation.music.about.${track.id}`)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {value && (
        <div className="pt-3 mt-2 border-t border-white/[0.08]">
          <p className="px-0.5 pb-1.5 text-[11.5px] text-ink-3">{t("compilation.music.volume")}</p>
          <div role="group" aria-label={t("compilation.music.volume")} className="seg">
            {(Object.keys(MUSIC_VOLUMES) as (keyof typeof MUSIC_VOLUMES)[]).map((level) => (
              <button
                key={level}
                aria-pressed={volume === MUSIC_VOLUMES[level]}
                onClick={() => {
                  const { volume: _before, ...rest } = value;
                  onChange(MUSIC_VOLUMES[level] === 1 ? rest : { ...rest, volume: MUSIC_VOLUMES[level] });
                }}
              >
                {t(`compilation.music.level.${level}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
