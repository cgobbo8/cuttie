import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Player } from "@remotion/player";
import { ArrowLeft, ArrowRight, ChevronDown, Clapperboard, Layers, Loader2, Music2, Pencil, ScanFace } from "lucide-react";
import {
  clipThumbUrl,
  getEditEnvironment,
  getJobStatus,
  liveLoudness,
  setLiveFacecam,
  startMontageRender,
  startRender,
  type EditEnvironment,
  type FacecamRect,
  type JobResponse,
  type SubtitleStyle,
  type WidgetTiming,
} from "../lib/api";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import { buildMoments, type Moment } from "../lib/moments";
import { suggestTemplate, type TemplateContext } from "../lib/templates";
import { buildAny, customTemplates, defaultTemplateKey, findCustom, hookOf, isBuiltIn, needsWebcam, showsHook, type TemplateKey } from "../lib/templateKeys";
import { clipTemplateContext } from "../lib/templateContext";
import { buildMontage, montageFrames, renderPieces, type MontageProps } from "../lib/montage";
import { fontFamily } from "../lib/fonts";
import { isIntro, type IntroChoice } from "../lib/intro/intros";
import { trackOf, useMusics } from "../lib/music/library";
import type { MusicChoice } from "../lib/music/mix";
import { favouriteFor, introOf, kindOfClip, montageIntro, montageMusic, playable } from "../lib/music/sound";
import IntroPicker from "../components/compilation/IntroPicker";
import MusicPicker from "../components/compilation/MusicPicker";
import CuttieComposition from "../components/remotion-editor/CuttieComposition";
import MontageComposition from "../components/remotion-editor/MontageComposition";
import TemplateSketch from "../components/montage/TemplateSketch";
import TemplatePicker from "../components/montage/TemplatePicker";
import CamSheet from "../components/montage/CamSheet";
import ModeSwitch from "../components/project/ModeSwitch";
import Stepper from "../components/project/Stepper";
import FreedNotice from "../components/project/FreedNotice";
import { useToast } from "../components/Toast";

const FPS = 30;
const SUB_STYLES: SubtitleStyle[] = ["bold", "karaoke", "minimal"];
const TIMINGS: WidgetTiming[] = ["start", "always", "end"];

interface MontagePrefs {
  /** One of the 6 templates, or one of the streamer's own (null: the channel's default template) */
  template: TemplateKey | null;
  /** Per-clip template when "apply to all" is off */
  perClip: Record<string, TemplateKey>;
  hooks: Record<string, string>;
  applyAll: boolean;
  /** Clips where the cam is shown although nobody was seen in it */
  camForced: Record<string, boolean>;
  /**
   * The music under the clips: a track, "none", or nothing said: each clip then plays the
   * streamer's favourite for its kind (brand kit), and none when they have no favourite for it
   */
  music?: MusicChoice | "none";
  /** Per-clip music when "apply to all" is off */
  musicPerClip: Record<string, MusicChoice | "none">;
  /** The intro the clips open with (none unless chosen): its style and its sound; its title is each clip's name */
  intro?: IntroChoice;
}

const DEFAULT_PREFS: MontagePrefs = { template: null, perClip: {}, hooks: {}, applyAll: true, camForced: {}, musicPerClip: {} };

function usePrefs(jobId: string | undefined) {
  const key = `cuttie_montage_${jobId}`;
  const [prefs, setPrefs] = useState<MontagePrefs>(() => {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
    } catch {
      return DEFAULT_PREFS;
    }
  });
  const update = useCallback(
    (patch: Partial<MontagePrefs>) =>
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // storage full or blocked: keep the choice for this session only
        }
        return next;
      }),
    [key],
  );
  return [prefs, update] as const;
}

/** First words of a clip, for the template stills */
function sampleWords(env: EditEnvironment | undefined, fallback: string): string[] {
  const words = env?.words?.slice(0, 4).map((w) => w.word) ?? [];
  return words.length > 0 ? words : fallback.split(/\s+/).slice(0, 3);
}

export default function MontagePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const { kit, channel, saveKit, reloadKit } = useChannel();
  const [prefs, setPrefs] = usePrefs(jobId);

  const [job, setJob] = useState<JobResponse | null>(null);
  const [envs, setEnvs] = useState<Record<string, EditEnvironment>>({});
  const [index, setIndex] = useState(0);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [camSheet, setCamSheet] = useState(false);
  // The background musics that can be played here, how loud this live's clips are (what the preview sets the music against), and the picker that is open
  const tracks = useMusics();
  const [liveLufs, setLiveLufs] = useState<number | null>(null);
  const [soundMenu, setSoundMenu] = useState<"music" | "intro" | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getJobStatus(jobId).then(setJob).catch(() => navigate("/"));
  }, [jobId, navigate]);

  const kept = useMemo(() => buildMoments(job?.hot_points ?? [], job?.selection ?? {}).filter((m) => m.state === "kept"), [job]);
  const current: Moment | undefined = kept[Math.min(index, kept.length - 1)];

  // Clip data (size, webcam, words) for the clip on screen
  const loadEnv = useCallback(
    async (filename: string) => {
      if (!jobId) throw new Error("no job");
      const env = await getEditEnvironment(jobId, filename);
      setEnvs((prev) => ({ ...prev, [filename]: env }));
      return env;
    },
    [jobId],
  );
  useEffect(() => {
    if (current && !envs[current.filename]) loadEnv(current.filename).catch(() => {});
  }, [current, envs, loadEnv]);

  useBackdrop(current && jobId ? clipThumbUrl(jobId, current.filename) : null);

  const customs = useMemo(() => customTemplates(kit), [kit]);

  /** A template that still exists (a deleted one gives way to the default) */
  const known = useCallback((key: TemplateKey | null | undefined): key is TemplateKey => !!key && (isBuiltIn(key) || !!findCustom(key, customs)), [customs]);
  const defaultKey = defaultTemplateKey(kit, customs);
  const projectTemplate = known(prefs.template) ? prefs.template : defaultKey;

  const templateFor = useCallback(
    (m: Moment): TemplateKey => {
      const own = prefs.perClip[m.filename];
      return !prefs.applyAll && known(own) ? own : projectTemplate;
    },
    [prefs, projectTemplate, known],
  );

  /** The cam for a clip: none when it doesn't show in it, unless the streamer asked for it */
  const camFor = useCallback(
    (m: Moment, env: EditEnvironment | undefined) => env?.facecam ?? (prefs.camForced[m.filename] ? env?.cam?.rect ?? null : null),
    [prefs.camForced],
  );

  const contextFor = useCallback(
    (m: Moment, env: EditEnvironment | undefined): TemplateContext | null => {
      if (!kit || !jobId) return null;
      const clip = clipTemplateContext({
        jobId,
        filename: m.filename,
        env,
        kit,
        login: channel?.login ?? kit.twitch_login,
        avatarUrl: channel?.avatar_url ?? null,
        facecam: camFor(m, env),
        startAt: m.trim?.[0] ?? 0,
        endAt: m.trim?.[1] ?? m.duration,
        hook: prefs.hooks[m.filename] ?? (m.hp.llm?.hook || m.hp.clip_name),
      });
      // For the brand widgets (follower count, channel name, game)
      return { ...clip, displayName: channel?.display_name ?? null, followers: channel?.followers ?? null, game: job?.vod_game ?? null };
    },
    [camFor, channel, job, jobId, kit, prefs.hooks],
  );

  /** The music a clip plays: what was chosen for it (or for all), else the streamer's favourite for its kind of clip */
  const musicFor = useCallback(
    (m: Moment): MusicChoice | null => {
      const chosen = (!prefs.applyAll && prefs.musicPerClip[m.filename]) || prefs.music;
      if (chosen === "none") return null;
      if (chosen) return trackOf(tracks, chosen.track) ? chosen : null;
      const favourite = favouriteFor(kindOfClip(m.hp.llm?.category), kit?.musics, tracks);
      return favourite ? { track: favourite.id } : null;
    },
    [kit, prefs.applyAll, prefs.music, prefs.musicPerClip, tracks],
  );

  /**
   * A clip as a montage: its pieces (or its one cut), with the intro and the music it has. Null for
   * a plain clip in one piece without either: that one keeps the simple player and the simple export.
   */
  const soundMontage = useCallback(
    (m: Moment, clipCtx: TemplateContext, key: TemplateKey): MontageProps | null => {
      const music = musicFor(m);
      const intro = prefs.intro && isIntro(prefs.intro.style) ? prefs.intro : null;
      if (m.pieces.length <= 1 && !music && !intro) return null;
      const pieces: [number, number][] = m.pieces.length > 1 ? m.pieces : [[m.trim?.[0] ?? 0, m.trim?.[1] ?? m.duration]];
      const cut = buildMontage(pieces.map(([start, end]) => ({ ctx: clipCtx, start, end })), (c) => buildAny(key, c, customs), FPS);
      // The intro is titled with the clip's own name, written as the template writes its hook; on a music it lasts a few of its beats
      const drawn = montageIntro(
        intro,
        {
          title: m.hp.clip_name || clipCtx.hook,
          name: clipCtx.displayName ?? clipCtx.login ?? "",
          logo: clipCtx.avatarUrl,
          colors: clipCtx.colors,
          font: fontFamily(hookOf(key, clipCtx, customs).font),
          follow: [t("compilation.intro.followLabel"), t("compilation.intro.followDone")],
        },
        null,
        trackOf(tracks, music?.track)?.bpm,
      );
      if (drawn) cut.intro = drawn;
      if (music) cut.music = montageMusic(cut.segments, pieces.map(([start, end]) => ({ words: clipCtx.words, start, end, said: !!m.hp.llm?.transcript })), music, introOf(cut));
      return cut;
    },
    [customs, musicFor, prefs.intro, t],
  );

  const env = current ? envs[current.filename] : undefined;
  const ctx = current ? contextFor(current, env) : null;
  const template = current ? templateFor(current) : projectTemplate;
  const customTemplate = findCustom(template, customs);
  const layers = useMemo(() => (ctx ? buildAny(template, ctx, customs) : []), [ctx, template, customs]);
  // A clip cut in several pieces, or one with an intro or a music: played as a montage (the hook and widgets once over the whole)
  const montage = useMemo(() => (ctx && current ? soundMontage(current, ctx, template) : null), [ctx, current, template, soundMontage]);
  const playerMontage = useMemo(() => (montage ? playable(montage, tracks, liveLufs) : null), [montage, tracks, liveLufs]);
  // Measured once a clip has an intro or a music (a few seconds of ffmpeg the first time, then kept with the clips)
  const hasSound = !!montage?.music || !!montage?.intro;
  useEffect(() => {
    if (!jobId || !hasSound) return;
    let stale = false;
    liveLoudness(jobId)
      .then((lufs) => !stale && setLiveLufs(lufs))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [jobId, hasSound]);
  const clipCam = current ? camFor(current, env) : null;
  const hasWebcam = !!clipCam;
  const cam = env?.cam;
  const suggested = current
    ? suggestTemplate(current.hp.llm?.category, hasWebcam, current.hp.signals?.vocal_excitement, current.hp.signals?.speech_presence, clipCam?.w)
    : null;

  const pickTemplate = (key: TemplateKey) => {
    if (!current) return;
    if (prefs.applyAll) setPrefs({ template: key, perClip: {} });
    else setPrefs({ perClip: { ...prefs.perClip, [current.filename]: key } });
  };

  // Back from the template editor with a new template: pick it
  const [searchParams, setSearchParams] = useSearchParams();
  const fromEditor = searchParams.get("template");
  useEffect(() => {
    if (!fromEditor || !current || !findCustom(fromEditor, customs)) return;
    pickTemplate(fromEditor);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromEditor, current, customs]);

  /** The simple template editor, previewing on the clip on screen */
  const editorLink = (id: string, base?: string) =>
    `/modeles/${id}?${new URLSearchParams({
      ...(base ? { base } : {}),
      job: jobId ?? "",
      clip: current?.filename ?? "",
      back: `/${jobId}/montage`,
    })}`;

  const saveLiveCam = async (facecam: FacecamRect | false | null, remember: boolean) => {
    if (!jobId) return;
    try {
      await setLiveFacecam(jobId, facecam, remember);
      // Every clip of the live uses the new framing
      setEnvs({});
      setCamSheet(false);
      if (remember) await reloadKit();
      toast.success(t(remember ? "montage.cam.savedEverywhere" : "montage.cam.saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    }
  };

  const saveBrand = async (patch: Parameters<typeof saveKit>[0]) => {
    try {
      await saveKit(patch);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
      return false;
    }
  };

  const makeDefault = async (key: TemplateKey) => {
    if (await saveBrand({ default_template: key })) toast.success(t("montage.defaultSaved"));
  };

  const exportAll = async () => {
    if (!jobId) return;
    setExporting({ done: 0, total: kept.length });
    try {
      for (const [i, m] of kept.entries()) {
        const clipEnv = envs[m.filename] ?? (await loadEnv(m.filename));
        const clipCtx = contextFor(m, clipEnv);
        if (!clipCtx) continue;
        // Cut in pieces, or with an intro or a music: exported as a montage (the only engine that plays them)
        const cut = soundMontage(m, clipCtx, templateFor(m));
        if (cut) {
          await startMontageRender(
            jobId,
            {
              key: m.filename,
              name: m.hp.clip_name,
              pieces: renderPieces(cut, cut.segments.map(() => m.filename)),
              overlays: cut.overlays,
              ...(cut.intro ? { intro: cut.intro } : {}),
              ...(cut.music ? { music: { track: cut.music.track, curve: cut.music.curve } } : {}),
            },
            { width: 1080, height: 1920, fps: FPS },
          );
          setExporting({ done: i + 1, total: kept.length });
          continue;
        }
        await startRender(
          jobId,
          m.filename,
          buildAny(templateFor(m), clipCtx, customs),
          m.trim ? { trimStart: m.trim[0], trimEnd: m.trim[1] } : undefined,
          m.hp.clip_name,
          { width: 1080, height: 1920, fps: FPS },
        );
        setExporting({ done: i + 1, total: kept.length });
      }
      navigate(`/${jobId}/export`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("montage.exportFailed"));
      setExporting(null);
    }
  };

  const openAdvancedEditor = () => {
    if (!jobId || !current) return;
    try {
      localStorage.setItem(`cuttie_editor_${jobId}_${current.filename}`, JSON.stringify(layers));
      if (current.trim) {
        localStorage.setItem(`cuttie_trim_${jobId}_${current.filename}`, JSON.stringify({ start: current.trim[0], end: current.trim[1] }));
      }
    } catch {
      // The editor will start from its default layout
    }
    navigate(`/${jobId}/edit?clip=${encodeURIComponent(current.filename)}`);
  };

  if (!job || !jobId || !kit) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
      </div>
    );
  }

  const stepper = (
    <div className="flex flex-wrap items-center gap-2">
    <ModeSwitch jobId={jobId} current="clips" />
    <Stepper
      current="edit"
      links={{ analyze: `/${jobId}`, choose: `/${jobId}`, export: `/${jobId}/export` }}
      locked={kept.length === 0 ? ["export"] : []}
    />
    </div>
  );

  // Clips freed to make room: nothing to edit until they're back
  if (job.clips_freed_at) {
    return (
      <div className="animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <h1 className="title-large">{t("montage.title")}</h1>
          {stepper}
        </div>
        <div className="mt-8">
          <FreedNotice job={job} onRestored={() => getJobStatus(jobId).then(setJob).catch(() => {})} />
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <h1 className="title-large">{t("montage.title")}</h1>
          {stepper}
        </div>
        <div className="mt-8 glass rounded-[18px] p-6 max-w-[560px]">
          <p className="text-[15px] text-ink-2">{t("montage.nothingKept")}</p>
          <Link to={`/${jobId}`} className="btn btn-primary mt-4">
            <ArrowLeft className="w-4 h-4" /> {t("montage.backToChoose")}
          </Link>
        </div>
      </div>
    );
  }

  // The music chosen for this clip (or for all): a track, "none", or nothing said (according to each clip)
  const musicChosen = (!prefs.applyAll && prefs.musicPerClip[current.filename]) || prefs.music;
  const playing = musicFor(current);
  const musicLabel =
    musicChosen === "none"
      ? t("montage.sound.none")
      : musicChosen
        ? (trackOf(tracks, musicChosen.track)?.name ?? t("montage.sound.none"))
        : playing
          ? t("montage.sound.autoTrack", { name: trackOf(tracks, playing.track)?.name })
          : t("montage.sound.autoNone");
  /** For every clip, or for this one when each clip has its own settings */
  const setMusic = (next: MusicChoice | "none" | undefined) => {
    setSoundMenu(null);
    if (prefs.applyAll) return setPrefs({ music: next, musicPerClip: {} });
    const { [current.filename]: _before, ...others } = prefs.musicPerClip;
    setPrefs({ musicPerClip: next ? { ...others, [current.filename]: next } : others });
  };
  const durationInFrames = Math.max(1, Math.round(current.duration * FPS));
  const inFrame = current.trim ? Math.floor(current.trim[0] * FPS) : 0;
  const outFrame = current.trim ? Math.min(durationInFrames - 1, Math.ceil(current.trim[1] * FPS)) : durationInFrames - 1;
  const sample = sampleWords(env, current.hp.clip_name);

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <Link to={`/${jobId}`} className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
            <ArrowLeft className="w-4 h-4" /> {t("project.step.choose")}
          </Link>
          <h1 className="mt-2 text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white">{t("montage.title")}</h1>
          <p className="mt-2 text-[13.5px] text-ink-2">{t("montage.subtitle", { count: kept.length })}</p>
        </div>
        {stepper}
      </header>

      <section className="mt-[22px] flex flex-wrap gap-[18px] items-start">
        {/* Templates */}
        <aside aria-label={t("montage.templates")} className="glass rounded-[20px] p-3 flex-[0_1_310px] min-w-0">
          <div className="flex items-center justify-between px-1.5 pt-1 pb-3">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{t("montage.templates")}</h2>
            <span className="text-[12px] text-ink-3">{t("montage.inYourColors")}</span>
          </div>
          <TemplatePicker
            customs={customs}
            selected={template}
            defaultKey={defaultKey}
            suggested={suggested}
            onPick={pickTemplate}
            onDefault={makeDefault}
            unavailable={(key) => needsWebcam(key, customs) && !hasWebcam}
            editorLink={editorLink}
            sketch={(key) =>
              ctx ? (
                <TemplateSketch
                  layers={buildAny(key, ctx, customs)}
                  frameUrl={clipThumbUrl(jobId, current.filename)}
                  width={58}
                  sample={sample}
                  at={ctx.startAt + 1.5}
                  className="flex-none rounded-[9px] border border-white/10"
                />
              ) : (
                <span className="w-[58px] h-[103px] rounded-[9px] skeleton flex-none" />
              )
            }
          />
        </aside>

        {/* Stage */}
        <div className="flex-[1_1_440px] min-w-0 flex flex-col items-center gap-3.5">
          {cam?.moved && (
            <div className="glass flex items-center gap-3 w-[396px] max-w-full p-3 pl-3.5 rounded-[14px] animate-rise">
              <ScanFace className="w-[18px] h-[18px] text-accent flex-none" />
              <p className="flex-1 min-w-0 text-[12.5px] leading-snug text-ink-2">{t("montage.cam.movedNotice")}</p>
              <button onClick={() => setCamSheet(true)} className="btn btn-glass btn-sm flex-none">
                {t("montage.cam.check")}
              </button>
            </div>
          )}
          <div className="relative w-[396px] max-w-full aspect-[9/16] rounded-[24px] overflow-hidden border border-white/[0.14] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)] bg-black">
            {env && montage ? (
              <Player
                key={`${current.filename}-${template}-pieces`}
                component={MontageComposition}
                inputProps={playerMontage ?? montage}
                compositionWidth={1080}
                compositionHeight={1920}
                fps={FPS}
                durationInFrames={montageFrames(montage.segments, FPS, montage.intro)}
                controls
                loop
                clickToPlay
                style={{ width: "100%", height: "100%" }}
              />
            ) : env ? (
              <Player
                key={`${current.filename}-${template}`}
                component={CuttieComposition}
                inputProps={{ layers }}
                compositionWidth={1080}
                compositionHeight={1920}
                fps={FPS}
                durationInFrames={durationInFrames}
                inFrame={inFrame}
                outFrame={outFrame}
                initialFrame={inFrame}
                controls
                loop
                clickToPlay
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center">
                <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
              </div>
            )}
          </div>

          <div className="glass flex items-center gap-2 p-2 rounded-[14px] max-w-full overflow-x-auto">
            <span className="text-[12px] text-ink-3 px-1.5 whitespace-nowrap">
              {t("montage.clipOf", { n: index + 1, total: kept.length })}
            </span>
            {kept.map((m, i) => (
              <button
                key={m.filename}
                onClick={() => setIndex(i)}
                aria-label={m.hp.clip_name}
                title={m.hp.clip_name}
                className={`flex-none rounded-[7px] transition-opacity ${i === index ? "shadow-[0_0_0_2px_var(--color-accent)]" : "opacity-60 hover:opacity-100"}`}
              >
                {ctx ? (
                  <TemplateSketch
                    layers={buildAny(templateFor(m), { ...ctx, words: [], hook: prefs.hooks[m.filename] ?? (m.hp.llm?.hook || m.hp.clip_name) }, customs)}
                    frameUrl={clipThumbUrl(jobId, m.filename)}
                    width={40}
                    sample={[]}
                    at={ctx.startAt + 1.5}
                    className="rounded-[7px]"
                  />
                ) : (
                  <img src={clipThumbUrl(jobId, m.filename)} alt="" className="w-10 h-[71px] rounded-[7px] object-cover" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Inspector */}
        <aside aria-label={t("montage.settings")} className="flex-[0_1_340px] min-w-0 flex flex-col gap-3">
          <div className="glass rounded-[18px] p-[18px]">
            <label htmlFor="hook" className="text-[14px] font-semibold text-white">
              {t("montage.hook")}
            </label>
            <input
              id="hook"
              value={prefs.hooks[current.filename] ?? (current.hp.llm?.hook || current.hp.clip_name)}
              onChange={(e) => setPrefs({ hooks: { ...prefs.hooks, [current.filename]: e.target.value } })}
              disabled={!showsHook(template, customs)}
              className="mt-2.5 w-full h-10 px-3 rounded-[10px] bg-black/30 border border-white/10 text-[13.5px] text-white outline-none focus:border-accent-line disabled:opacity-40"
            />
            <p className="mt-2 text-[12px] text-ink-3">{showsHook(template, customs) ? t("montage.hookHint") : t("montage.noHook")}</p>
          </div>

          {/* The clips' sound beyond their own: a music under them, an intro before them */}
          {/* (above the cards that follow while one of its pickers is open: each card is a layer of its own) */}
          <div className={`glass rounded-[18px] p-[18px] flex flex-col gap-3 ${soundMenu ? "relative z-30" : ""}`}>
            <div className="text-[14px] font-semibold text-white">{t("montage.sound.title")}</div>
            {tracks.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-[550] text-white">{t("montage.sound.music")}</span>
                  <span className="block text-[12px] leading-snug text-ink-3">{!musicChosen && !playing ? t("montage.sound.autoNoneHint") : t("montage.sound.musicHint")}</span>
                </span>
                <span className="relative flex-none">
                  <button onClick={() => setSoundMenu(soundMenu === "music" ? null : "music")} aria-haspopup="dialog" aria-expanded={soundMenu === "music"} className="btn btn-glass btn-sm h-9 px-3 max-w-[168px]">
                    <Music2 className="w-3.5 h-3.5 flex-none text-accent" />
                    <span className="truncate">{musicLabel}</span>
                    <ChevronDown className="w-3.5 h-3.5 flex-none text-ink-3" />
                  </button>
                  {soundMenu === "music" && (
                    <MusicPicker
                      title={t("montage.sound.pickMusic")}
                      value={musicChosen && musicChosen !== "none" && trackOf(tracks, musicChosen.track) ? musicChosen : null}
                      tracks={tracks}
                      favourites={kit.musics}
                      first={kindOfClip(current.hp.llm?.category) ?? undefined}
                      auto={{ label: t("montage.sound.auto"), hint: t("montage.sound.autoHint"), chosen: !musicChosen, onPick: () => setMusic(undefined) }}
                      onChange={(next) => setMusic(next ?? "none")}
                      onClose={() => setSoundMenu(null)}
                      className="right-0 top-full mt-2"
                    />
                  )}
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-[550] text-white">{t("montage.sound.intro")}</span>
                <span className="block text-[12px] leading-snug text-ink-3">{t("montage.sound.introHint")}</span>
              </span>
              <span className="relative flex-none">
                <button onClick={() => setSoundMenu(soundMenu === "intro" ? null : "intro")} aria-haspopup="dialog" aria-expanded={soundMenu === "intro"} className="btn btn-glass btn-sm h-9 px-3">
                  <Clapperboard className="w-3.5 h-3.5 flex-none text-accent" />
                  {prefs.intro && isIntro(prefs.intro.style) ? t(`compilation.intro.style.${prefs.intro.style}`) : t("montage.sound.none")}
                  <ChevronDown className="w-3.5 h-3.5 flex-none text-ink-3" />
                </button>
                {soundMenu === "intro" && ctx && (
                  <IntroPicker
                    heading={t("montage.sound.pickIntro")}
                    fields="sound"
                    value={prefs.intro && isIntro(prefs.intro.style) ? prefs.intro : null}
                    brand={{ name: ctx.displayName ?? ctx.login ?? "", logo: ctx.avatarUrl, colors: ctx.colors, font: fontFamily(hookOf(template, ctx, customs).font) }}
                    name={current.hp.clip_name || ctx.hook}
                    onChange={(next) => setPrefs({ intro: next ?? undefined })}
                    onClose={() => setSoundMenu(null)}
                    className="right-0 top-full mt-2"
                  />
                )}
              </span>
            </div>
          </div>

          {customTemplate ? (
            <div className="glass rounded-[18px] p-[18px]">
              <div className="text-[14px] font-semibold text-white">{t("montage.ownTemplate")}</div>
              <p className="mt-1 text-[12px] leading-snug text-ink-3">{t("montage.ownTemplateHint", { name: customTemplate.name })}</p>
              <Link to={editorLink(customTemplate.id)} className="btn btn-glass btn-sm mt-3">
                <Pencil className="w-3.5 h-3.5" /> {t("montage.editTemplate")}
              </Link>
            </div>
          ) : (
            <div className="glass rounded-[18px] p-[18px]">
              <div className="text-[14px] font-semibold text-white">{t("brand.subtitles")}</div>
              <div role="group" aria-label={t("brand.subtitles")} className="seg mt-3">
                {SUB_STYLES.map((style) => (
                  <button key={style} aria-pressed={kit.subtitles.style === style} onClick={() => saveBrand({ subtitles: { style } })}>
                    {t(`brand.subStyle.${style}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="glass rounded-[18px] px-[18px] py-1.5">
            {!customTemplate && (
            <div className="flex items-center gap-3 py-3 border-b border-white/[0.06]">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-[550] text-white">{t("brand.widget")}</div>
                <div className="text-[12px] text-ink-3">{t(`brand.timing.${kit.widget.timing}`)}</div>
              </div>
              <button role="switch" aria-checked={kit.widget.enabled} aria-label={t("brand.widget")} onClick={() => saveBrand({ widget: { enabled: !kit.widget.enabled } })} className="switch">
                <span />
              </button>
            </div>
            )}
            {!customTemplate && kit.widget.enabled && (
              <div className="py-3 border-b border-white/[0.06]">
                <div role="group" aria-label={t("brand.widgetShow")} className="seg">
                  {TIMINGS.map((timing) => (
                    <button key={timing} aria-pressed={kit.widget.timing === timing} onClick={() => saveBrand({ widget: { timing } })}>
                      {t(`brand.timing.${timing}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-[550] text-white">{t("montage.camFraming")}</div>
                  <div className="text-[12px] text-ink-3">
                    {!cam?.rect
                      ? t("montage.cam.none")
                      : cam.source === "live"
                        ? t("montage.cam.manual")
                        : cam.moved
                          ? t("montage.cam.moved")
                          : cam.source === "brand"
                            ? t("montage.cam.usual")
                            : t("montage.cam.found")}
                  </div>
                </div>
                <button onClick={() => setCamSheet(true)} disabled={!env} className="btn btn-glass btn-sm">
                  {t("montage.adjust")}
                </button>
              </div>
              {cam?.rect && !cam.visible && current && (
                <div className="mt-2.5 flex items-center gap-3 p-2.5 pl-3 rounded-[11px] inset">
                  <span className="flex-1 min-w-0 text-[12px] leading-snug text-ink-2">{t("montage.cam.hiddenHere")}</span>
                  <button
                    role="switch"
                    aria-checked={!!prefs.camForced[current.filename]}
                    aria-label={t("montage.cam.showAnyway")}
                    title={t("montage.cam.showAnyway")}
                    onClick={() => setPrefs({ camForced: { ...prefs.camForced, [current.filename]: !prefs.camForced[current.filename] } })}
                    className="switch flex-none"
                  >
                    <span />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-[550] text-white">{t("montage.applyAll")}</div>
                <div className="text-[12px] text-ink-3">{t("montage.applyAllHint")}</div>
              </div>
              <button role="switch" aria-checked={prefs.applyAll} aria-label={t("montage.applyAll")} onClick={() => setPrefs({ applyAll: !prefs.applyAll, perClip: {} })} className="switch">
                <span />
              </button>
            </div>
          </div>

          <button onClick={exportAll} disabled={!!exporting} className="btn btn-primary btn-lg w-full h-[50px]">
            {exporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> {t("montage.sending", { done: exporting.done, total: exporting.total })}
              </>
            ) : (
              <>
                {t("montage.export", { count: kept.length })} <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
              </>
            )}
          </button>
          <button onClick={openAdvancedEditor} className="btn btn-ghost btn-sm self-center">
            <Layers className="w-[15px] h-[15px]" /> {t("montage.advancedEditor")}
          </button>
        </aside>
      </section>

      {camSheet && env && (
        <CamSheet
          frameUrl={clipThumbUrl(jobId, current.filename, { width: 1280 })}
          clipW={env.clip_width}
          clipH={env.clip_height}
          initial={cam?.rect ?? null}
          manual={cam?.source === "live"}
          onSave={saveLiveCam}
          onClose={() => setCamSheet(false)}
        />
      )}
    </div>
  );
}
