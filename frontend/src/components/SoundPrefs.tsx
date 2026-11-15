import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pause, Play, Plus, Trash2 } from "lucide-react";
import { addMusic, deleteMusic, updateMusic, type BrandKit } from "../lib/api";
import { INTRO_IDS, isIntro } from "../lib/intro/intros";
import { loadMusics, trackOf, useMusics } from "../lib/music/library";
import { MUSIC_KINDS, type MusicTrack } from "../lib/music/mix";
import { IntroSketch, useIntroLoop, type IntroBrand } from "./compilation/IntroPicker";
import { useListen } from "./compilation/MusicPicker";
import { useToast } from "./Toast";

interface Props {
  kit: Pick<BrandKit, "musics" | "intro">;
  /** What the preferred intro is drawn with: the channel's logo and colours */
  brand: IntroBrand;
  onSave: (patch: { musics?: Record<string, string>; intro?: string | null }) => void;
}

const FIELD = "h-9 min-w-0 px-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line [color-scheme:dark]";
const ROUND = "flex-none w-9 h-9 grid place-items-center rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-white disabled:opacity-30 disabled:hover:bg-white/[0.08]";

/** One of the streamer's own tracks: its name, the kinds of video it suits and what is said of it, all theirs to change */
function OwnTrack({ track, playing, onListen, onChanged }: { track: MusicTrack; playing: boolean; onListen: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(track.name);
  const [description, setDescription] = useState(track.description ?? "");
  const save = async (patch: Parameters<typeof updateMusic>[1]) => {
    try {
      await updateMusic(track.id, patch);
      onChanged();
      toast.success(t("brand.musicSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    }
  };
  const remove = async () => {
    try {
      await deleteMusic(track.id);
      onChanged();
      toast.success(t("brand.musicRemoved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    }
  };
  return (
    <li className="p-2.5 rounded-[12px] bg-white/[0.04] border border-white/[0.07] flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onListen} aria-label={t(playing ? "compilation.music.stop" : "compilation.music.listen", { name: track.name })} className={ROUND}>
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 translate-x-px" />}
        </button>
        <input
          value={name}
          maxLength={60}
          aria-label={t("brand.musicName")}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== track.name && save({ name: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={`${FIELD} flex-1 font-[550]`}
        />
        <button type="button" onClick={remove} aria-label={t("brand.removeMusic", { name: track.name })} className="flex-none w-9 h-9 grid place-items-center rounded-[10px] text-ink-3 hover:text-[#ff8a7a] hover:bg-white/10">
          <Trash2 className="w-[15px] h-[15px]" />
        </button>
      </div>
      <div role="group" aria-label={t("brand.musicKinds")} className="flex flex-wrap gap-1.5">
        {MUSIC_KINDS.map((kind) => {
          const on = track.kinds.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              onClick={() => save({ kinds: on ? track.kinds.filter((k) => k !== kind) : [...track.kinds, kind] })}
              className={`h-7 px-2.5 rounded-full border text-[11.5px] transition-colors ${on ? "border-accent bg-accent-soft text-white" : "border-white/10 text-ink-2 hover:bg-white/[0.07]"}`}
            >
              {t(`compilation.music.kind.${kind}`)}
            </button>
          );
        })}
      </div>
      <textarea
        value={description}
        rows={3}
        maxLength={300}
        placeholder={t("brand.musicDescriptionHint")}
        aria-label={t("brand.musicDescription")}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description.trim() !== (track.description ?? "") && save({ description: description.trim() })}
        className="w-full px-2.5 py-2 rounded-[10px] bg-black/30 border border-white/10 text-[12.5px] leading-snug text-white outline-none focus:border-accent-line resize-none placeholder:text-ink-4"
      />
    </li>
  );
}

/**
 * The streamer's sound preferences (brand kit): a favourite background music for each kind
 * of video, the intro they prefer, and the musics they add themselves (the AI listens to each
 * and writes what it is for; they can correct it). The AI starts from all this when it chooses
 * the sound of a video.
 */
export default function SoundPrefs({ kit, brand, onSave }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const tracks = useMusics();
  const { playing, toggle } = useListen();
  const frame = useIntroLoop();
  const picker = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const own = tracks.filter((track) => track.own);
  const reload = () => loadMusics().catch(() => {});

  const pick = (kind: string, track: string) => {
    const { [kind]: _before, ...rest } = kit.musics;
    onSave({ musics: track ? { ...rest, [kind]: track } : rest });
  };
  const add = async (file: File | undefined) => {
    if (!file || adding) return;
    setAdding(true);
    try {
      const added = await addMusic(file, i18n.language.slice(0, 2));
      await reload();
      // Heard or not, the track is there: when the AI could not listen, its description is the streamer's to write
      if (added.heard) toast.success(t("brand.musicAdded", { name: added.music.name }));
      else toast.info(t(added.why === "credits" ? "brand.musicAddedNoCredits" : "brand.musicAddedUnheard", { name: added.music.name }));
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("brand.musicAddFailed"));
    } finally {
      setAdding(false);
      if (picker.current) picker.current.value = "";
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {tracks.length === 0 ? (
        <p className="text-[13px] text-ink-3">{t("brand.noMusics")}</p>
      ) : (
        MUSIC_KINDS.map((kind) => {
          const chosen = trackOf(tracks, kit.musics[kind]);
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
                className={ROUND}
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

      {/* Their own musics: added from a file, listened to by the AI, described in words they can change */}
      <div className="mt-1.5 pt-3.5 border-t border-white/[0.08]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-[600] text-white">{t("brand.ownMusics")}</h3>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{t("brand.ownMusicsHint")}</p>
          </div>
          <button type="button" disabled={adding} onClick={() => picker.current?.click()} className="btn btn-glass btn-sm flex-none">
            {adding ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Plus className="w-3.5 h-3.5" />}
            {t(adding ? "brand.musicListening" : "brand.addMusic")}
          </button>
          <input ref={picker} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" hidden aria-label={t("brand.addMusic")} onChange={(e) => add(e.target.files?.[0])} />
        </div>
        {own.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {own.map((track) => (
              <OwnTrack key={track.id} track={track} playing={playing === track.id} onListen={() => toggle(track)} onChanged={reload} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
