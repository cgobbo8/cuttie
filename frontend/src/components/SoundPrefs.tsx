import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play } from "lucide-react";
import { listMusics, type BrandKit } from "../lib/api";
import { INTRO_IDS, isIntro } from "../lib/intro/intros";
import { MUSIC_KINDS, MUSICS, musicOf } from "../lib/music/mix";
import { IntroSketch, useIntroLoop, type IntroBrand } from "./compilation/IntroPicker";
import { useListen } from "./compilation/MusicPicker";

interface Props {
  kit: Pick<BrandKit, "musics" | "intro">;
  /** What the preferred intro is drawn with: the channel's logo and colours */
  brand: IntroBrand;
  onSave: (patch: { musics?: Record<string, string>; intro?: string | null }) => void;
}

const FIELD = "h-9 min-w-0 px-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line [color-scheme:dark]";

/**
 * The streamer's sound preferences (brand kit): a favourite background music for each kind
 * of video, and the intro they prefer. The AI starts from them when it chooses for a video.
 */
export default function SoundPrefs({ kit, brand, onSave }: Props) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<string[] | null>(null);
  const { playing, toggle } = useListen();
  const frame = useIntroLoop();
  useEffect(() => {
    listMusics()
      .then(setAvailable)
      .catch(() => setAvailable([]));
  }, []);

  const tracks = MUSICS.filter((track) => available?.includes(track.id));
  const pick = (kind: string, track: string) => {
    const { [kind]: _before, ...rest } = kit.musics;
    onSave({ musics: track ? { ...rest, [kind]: track } : rest });
  };

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {available && tracks.length === 0 ? (
        <p className="text-[13px] text-ink-3">{t("brand.noMusics")}</p>
      ) : (
        MUSIC_KINDS.map((kind) => {
          const chosen = musicOf(kit.musics[kind]);
          // Those made for this kind of video first
          const fitting = tracks.filter((track) => track.kinds.includes(kind));
          const others = tracks.filter((track) => !track.kinds.includes(kind));
          const label = t(`compilation.music.kind.${kind}`);
          return (
            <div key={kind} className="flex items-center gap-2.5">
              <span className="flex-[0_0_132px] text-[13px] text-ink-2">{label}</span>
              <select value={chosen?.id ?? ""} onChange={(e) => pick(kind, e.target.value)} aria-label={t("brand.musicFor", { kind: label })} className={`${FIELD} flex-1`}>
                <option value="">{t("brand.musicAny")}</option>
                {fitting.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
                {others.length > 0 && <option disabled>──────</option>}
                {others.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!chosen}
                onClick={() => chosen && toggle(chosen)}
                aria-label={chosen ? t(playing === chosen.id ? "compilation.music.stop" : "compilation.music.listen", { name: chosen.name }) : undefined}
                className="flex-none w-9 h-9 grid place-items-center rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-white disabled:opacity-30 disabled:hover:bg-white/[0.08]"
              >
                {chosen && playing === chosen.id ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 translate-x-px" />}
              </button>
            </div>
          );
        })
      )}
      <div className="mt-1.5 pt-3.5 border-t border-white/[0.08] flex items-center gap-2.5">
        <span className="flex-[0_0_132px] text-[13px] text-ink-2">{t("brand.introPreferred")}</span>
        <select value={kit.intro ?? ""} onChange={(e) => onSave({ intro: e.target.value || null })} aria-label={t("brand.introPreferred")} className={`${FIELD} flex-1`}>
          <option value="">{t("brand.introNone")}</option>
          {INTRO_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`compilation.intro.style.${id}`)}
            </option>
          ))}
        </select>
        {isIntro(kit.intro) ? <IntroSketch id={kit.intro} frame={frame} brand={brand} title={brand.name} width={36} /> : <span className="flex-none w-9" />}
      </div>
    </div>
  );
}
