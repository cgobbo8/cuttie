import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Clapperboard, Loader2, Music2, Pause, Play, Plus, Trash2 } from "lucide-react";
import { addMusic, deleteMusic, updateMusic, type BrandKit } from "../lib/api";
import { hookLook, isIntro } from "../lib/intro/intros";
import { loadMusics, trackOf, useMusics } from "../lib/music/library";
import { MUSIC_KINDS, type MusicTrack } from "../lib/music/mix";
import IntroPicker, { IntroSketch, useIntroLoop, type IntroBrand } from "./compilation/IntroPicker";
import MusicPicker, { useListen } from "./compilation/MusicPicker";
import { useToast } from "./Toast";

interface Props {
  kit: Pick<BrandKit, "musics" | "intro" | "intro_look">;
  /** What the preferred intro is drawn with: the channel's logo and colours */
  brand: IntroBrand;
  onSave: (patch: { musics?: Record<string, string>; intro?: string | null; intro_look?: string | null }) => void;
}

const FIELD = "h-9 min-w-0 px-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line [color-scheme:dark]";
/** What opens a picker: the choice made, as a field */
const PICK = "h-9 px-2.5 rounded-[10px] bg-black/30 border border-white/10 hover:border-white/20 text-[13px] flex items-center gap-2 outline-none focus-visible:border-accent-line transition-colors";
const ROUND = "flex-none w-9 h-9 grid place-items-center rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-white disabled:opacity-30 disabled:hover:bg-white/[0.08]";

/** How many seconds before a track's strong moment it is played from, to hear what leads to it */
const LEAD_HEARD = 3;

/**
 * One of the streamer's own tracks: its name, the kinds of video it suits and what is said of it, all theirs
 * to change. And its strong moment, where a video starts it: they type about where it is, by ear (the riff
 * comes in, the drop), and the attack nearest to that is kept. A track that builds up to it can be started
 * before it when the video has an intro: the moment then falls on the first picture of the video.
 */
function OwnTrack({ track, playing, onListen, onListenFrom, onChanged }: { track: MusicTrack; playing: boolean; onListen: () => void; onListenFrom: (seconds: number) => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(track.name);
  const [description, setDescription] = useState(track.description ?? "");
  const [moment, setMoment] = useState(String(track.start));
  const [finding, setFinding] = useState(false);
  // (what is kept is the attack nearest to what was typed: shown once it is found)
  useEffect(() => setMoment(String(track.start)), [track.start]);
  const point = async () => {
    const at = Number(moment.replace(",", "."));
    if (!Number.isFinite(at) || at < 0 || Math.abs(at - track.start) < 0.005) return setMoment(String(track.start));
    setFinding(true);
    try {
      const kept = await updateMusic(track.id, { start: Math.min(at, Math.max(0, track.seconds - 1)) });
      onChanged();
      toast.success(t("brand.musicMomentSaved", { seconds: kept.start }));
    } catch (err) {
      setMoment(String(track.start));
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    } finally {
      setFinding(false);
    }
  };
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-2 text-[12px] text-ink-2" title={t("brand.musicMomentHelp")}>
          {t("brand.musicMoment")}
          <input
            value={moment}
            inputMode="decimal"
            disabled={finding}
            aria-label={t("brand.musicMoment")}
            onChange={(e) => setMoment(e.target.value)}
            onBlur={point}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className={`${FIELD} w-[72px] tabular-nums text-right`}
          />
          <span className="text-ink-3">s</span>
        </label>
        <button
          type="button"
          onClick={() => onListenFrom(track.start - LEAD_HEARD)}
          title={t("brand.musicMomentListenHelp", { seconds: LEAD_HEARD })}
          className="h-7 px-2.5 rounded-full border border-white/10 text-[11.5px] text-ink-2 hover:bg-white/[0.07] inline-flex items-center gap-1.5 transition-colors"
        >
          {finding ? <Loader2 className="w-3 h-3 spinner" /> : <Play className="w-3 h-3" />}
          {t("brand.musicMomentListen")}
        </button>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-2" title={t("brand.musicBuildHelp")}>
          {t("brand.musicBuild")}
          <button type="button" role="switch" aria-checked={!!track.build} aria-label={t("brand.musicBuild")} onClick={() => save({ build: !track.build })} className="switch flex-none">
            <span />
          </button>
        </label>
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
  // The picker that is open: a kind of video's favourite music, or the preferred intro
  const [open, setOpen] = useState<string | null>(null);
  const own = tracks.filter((track) => track.own);
  // The look their hook is framed with, when the hook is the intro they prefer
  const look = hookLook({ look: kit.intro_look ?? undefined });
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
          const label = t(`compilation.music.kind.${kind}`);
          return (
            <div key={kind} className="flex items-center gap-2.5">
              <span className="flex-[0_0_132px] text-[13px] text-ink-2">{label}</span>
              <span className="relative flex-1 min-w-0">
                <button type="button" onClick={() => setOpen(open === kind ? null : kind)} aria-haspopup="dialog" aria-expanded={open === kind} aria-label={t("brand.musicFor", { kind: label })} className={`${PICK} w-full`}>
                  <Music2 className={`w-3.5 h-3.5 flex-none ${chosen ? "text-accent" : "text-ink-3"}`} />
                  <span className={`flex-1 min-w-0 truncate text-left ${chosen ? "text-white" : "text-ink-2"}`}>{chosen?.name ?? t("brand.musicAny")}</span>
                  <ChevronDown className="w-[15px] h-[15px] flex-none text-ink-3" />
                </button>
                {open === kind && (
                  // The very picker a compilation has: every track to listen to, those made for this kind of video first
                  <MusicPicker
                    value={chosen ? { track: chosen.id } : null}
                    tracks={tracks}
                    favourites={kit.musics}
                    title={t("brand.musicFor", { kind: label })}
                    noneLabel={t("brand.musicAny")}
                    presence={false}
                    first={kind}
                    onChange={(next) => {
                      pick(kind, next?.track ?? "");
                      setOpen(null);
                    }}
                    onClose={() => setOpen(null)}
                    className="right-0 top-full mt-2"
                  />
                )}
              </span>
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
        <span className="relative flex-1 min-w-0">
          <button type="button" onClick={() => setOpen(open === "intro" ? null : "intro")} aria-haspopup="dialog" aria-expanded={open === "intro"} aria-label={t("brand.introPreferred")} className={`${PICK} w-full`}>
            <Clapperboard className={`w-3.5 h-3.5 flex-none ${isIntro(kit.intro) ? "text-accent" : "text-ink-3"}`} />
            <span className={`flex-1 min-w-0 truncate text-left ${isIntro(kit.intro) ? "text-white" : "text-ink-2"}`}>
              {/* A hook is told with the look that frames it */}
              {kit.intro === "hook" ? `${t("compilation.intro.style.hook")} · ${t(`compilation.intro.style.${look}`)}` : isIntro(kit.intro) ? t(`compilation.intro.style.${kit.intro}`) : t("brand.introNone")}
            </span>
            <ChevronDown className="w-[15px] h-[15px] flex-none text-ink-3" />
          </button>
          {open === "intro" && (
            <IntroPicker
              value={isIntro(kit.intro) ? { style: kit.intro, ...(kit.intro === "hook" ? { look } : {}) } : null}
              brand={brand}
              name={brand.name}
              heading={t("brand.introPreferred")}
              fields="style"
              // (it stays open: a kind is chosen, then its graphics)
              onChange={(next) => onSave({ intro: next?.style ?? null, intro_look: next?.style === "hook" ? hookLook(next) : null })}
              onClose={() => setOpen(null)}
              className="right-0 top-full mt-2"
            />
          )}
        </span>
        {isIntro(kit.intro) ? <IntroSketch id={kit.intro} look={look} frame={frame} brand={brand} title={brand.name} width={36} /> : <span className="flex-none w-9" />}
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
              <OwnTrack key={track.id} track={track} playing={playing === track.id} onListen={() => toggle(track)} onListenFrom={(seconds) => toggle(track, seconds)} onChanged={reload} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
