import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAssistant, useAssistantActions, useAssistantPlace, type AssistantRun } from "../lib/AssistantContext";
import { applyLook, lookOf } from "../lib/assistantLook";
import { building, dropBuild, onBuildEnd, useBuilds } from "../lib/backgroundBuild";
import { useTranslation } from "react-i18next";
import { Player, type PlayerRef } from "@remotion/player";
import { ArrowLeft, ArrowLeftToLine, ArrowRightToLine, Check, Loader2, Plus, Scissors, Sparkles, Undo2, X } from "lucide-react";
import {
  chooseLooks,
  clipThumbUrl,
  createCompilation,
  deleteCompilation,
  ensurePieces,
  flattenCompilation,
  getClipWords,
  getEditEnvironment,
  getJobStatus,
  getLiveSearchInfo,
  getLiveSearchProgress,
  getStoryboard,
  chooseSound,
  listAllCompilations,
  liveLoudness,
  listCompilations,
  listRenders,
  LiveError,
  planLiveVideo,
  saveCompilation,
  setLiveFacecam,
  startMontageRender,
  suggestClipCut,
  type AssistantPassage,
  type Compilation,
  type CompilationItem,
  type EditEnvironment,
  type FacecamRect,
  type JobResponse,
  type LiveCompilations,
  type LiveFailure,
  type LiveHit,
  type LiveSearchInfo,
  type MediaItem,
  type TranscriptWord,
  type TwitchStoryboard,
  type VideoPlan,
} from "../lib/api";
import { openKeptClip } from "../lib/clipVideo";
import { mediaOf, useMedia } from "../lib/mediaLibrary";
import MediaLibrary from "../components/MediaLibrary";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import {
  addItems,
  insertItems,
  itemFromMedia,
  pieceAsk,
  addSection,
  allItems,
  applyTight,
  applyLooks,
  applySound,
  soundBrief,
  clearLooks,
  compilationLength,
  cutItem,
  extendItem,
  fitToTarget,
  hookMoment,
  itemFor,
  itemFromHit,
  looksCount,
  openingSeconds,
  PLAIN_CUT,
  removeItem,
  planCurrent,
  recutVideo,
  revisedSections,
  saidAlready,
  sameStep,
  sectionsFromPlan,
  setVideoTransition,
  splitItem,
  stepText,
  tightened,
  updateItem,
  withHook,
} from "../lib/compilation";
import { liveWhen, plainDate } from "../lib/compilationLibrary";
import { clock, splitVodTitle } from "../lib/format";
import { framesOf, introHold, montageFrames, playsIntro, snapToWords, tighten, wordsIn } from "../lib/montage";
import { readCutTarget, saveCutTarget, type CutTarget } from "../lib/cutTarget";
import { evenFrames, tileStyle } from "../lib/storyboard";
import { TRANSITION_IDS, isTransition, transitionSpan } from "../lib/transitions";
import { EFFECT_LEVELS } from "../lib/effects";
import { JINGLE_IDS, introSpan, isIntro } from "../lib/intro/intros";
import { trackOf, useMusics } from "../lib/music/library";
import { playable } from "../lib/music/sound";
import { fontFamily } from "../lib/fonts";
import type { HookMenu, IntroBrand } from "../components/compilation/IntroPicker";
import { clipTemplateContext } from "../lib/templateContext";
import { templateGuides } from "../lib/templateGuide";
import { buildAny, customTemplates, defaultTemplateKey, findCustom, hookOf, isBuiltIn, type TemplateKey } from "../lib/templateKeys";
import { isHookStyle, titleCard } from "../lib/templateSpec";
import { SOURCE_TARGET, VIDEO_SOURCES, isVideoSource, sourceOf, type VideoSource } from "../lib/videoSources";
import { keptCount, liveEntries } from "../lib/liveEntries";
import { FPS, TITLE_SECONDS, buildVideo, covers, pieceVersion, renderRequest, type Piece } from "../lib/videoBuild";
import { buildMoments } from "../lib/moments";
import { TEMPLATE_IDS } from "../lib/templates";
import MontageComposition from "../components/remotion-editor/MontageComposition";
import { isWaiting } from "../lib/suggestions";
import LiveHeader from "../components/live/LiveHeader";
import VideoRail from "../components/live/VideoRail";
import CamSheet from "../components/montage/CamSheet";
import TemplateSketch from "../components/montage/TemplateSketch";
import VideoTimeline from "../components/montage/VideoTimeline";
import AiCutButton from "../components/project/AiCutButton";
import LivePicker from "../components/compilation/LivePicker";
import CompilationPanel from "../components/compilation/CompilationPanel";
import DescribeVideo from "../components/compilation/DescribeVideo";
import PiecePreview from "../components/compilation/PiecePreview";
import SearchPanel from "../components/compilation/SearchPanel";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

/** Clips cut from the live at once */
const CUT_BATCH = 4;
const SAVE_DELAY = 500;
/** How many changes of a video's passages can be taken back */
const UNDO_STEPS = 40;
const STRIP_TILES = 24;

const hitKey = (hit: LiveHit) => `${hit.job ?? ""}:${hit.start}-${hit.end}`;

/** Other lives one compilation can take passages from */
const MAX_OTHER_LIVES = 4;

/** How long a passage the AI added stays lit, and one it took out takes to leave (as the stylesheet animates them) */
const LIT_MS = 3600;
const LEAVE_MS = 1100;

/** The same passages in the same parts, in the same order */
const sameOrder = (c: Pick<Compilation, "sections">, sections: Compilation["sections"]) =>
  JSON.stringify(c.sections.filter((s) => s.items.length > 0).map((s) => s.items.map((i) => i.id))) === JSON.stringify(sections.map((s) => s.items.map((i) => i.id)));

/** How far over the length asked a described video may run before passages are taken out of it */
const PLAN_OVER = 1.1;


/**
 * /:jobId/montage — the third step of a live: the montage of the videos kept from it, whatever
 * each is made from (a clip, a sequence, a compilation). One video at a time (?v=<id>), the
 * others a click away in the row above. Its passages on the left, the video in the middle, its
 * look on the right; what is asked of the AI is asked in the assistant's panel, and done here.
 * Everything stays editable: order, cut of each passage, titles, template.
 */
export default function CompilationPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  // ?v=<id>: the video to open (none: the first one kept); ?clip=<file>: a kept clip, as its video; ?new=1&kind=…: a new one
  const [search, setSearch] = useSearchParams();
  const { kit, channel, reloadKit } = useChannel();
  const assistant = useAssistant();
  // The live's webcam framing, open to be set by hand
  const [camSheet, setCamSheet] = useState(false);
  // The clip whose video is being made (a kept clip opened for the first time)
  const [openingClip, setOpeningClip] = useState<string | null>(null);
  // The videos of this live whose last export is finished
  const [exported, setExported] = useState<Set<string>>(new Set());

  const [job, setJob] = useState<JobResponse | null>(null);
  const [info, setInfo] = useState<LiveSearchInfo | null>(null);
  // Each live's preview frames, by job id; the analysed lives (title, date, length), to name those a compilation takes from
  const [storyboards, setStoryboards] = useState<Record<string, TwitchStoryboard>>({});
  const [library, setLibrary] = useState<LiveCompilations[]>([]);
  const [addingLive, setAddingLive] = useState(false);
  const [compilations, setCompilations] = useState<Compilation[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  // The live searched by hand for passages (a window of its own)
  const [searching, setSearching] = useState(false);
  // The media library takes the place of the passages while a video of the streamer's own is picked there
  const [importing, setImporting] = useState(false);
  const { media: ownVideos } = useMedia();
  // On a window too narrow for the three panels: the one shown beside the video
  const [side, setSide] = useState<"passages" | "look">("passages");
  // The AI is building or changing a video: which one, and what it did so far
  const [working, setWorking] = useState<{ id: string; lines: string[] } | null>(null);
  // The video whose plan came from the disk (nothing was searched this time): it can be asked again
  const [keptPlan, setKeptPlan] = useState<{ id: string; brief: string; target: number; leads: number[] } | null>(null);
  const [activeSection, setActiveSection] = useState("");
  // Each moment's clip, by item id
  const [pieces, setPieces] = useState<Record<string, Piece>>({});
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const [cutting, setCutting] = useState<Set<string>>(new Set());
  // The moment open under the whole video: an item of the compilation, or a search result not added yet
  const [shown, setShown] = useState<CompilationItem | null>(null);
  // The whole video's player; the passage it is on; whether it plays (it and the passage never play over each other)
  const playerRef = useRef<PlayerRef>(null);
  const [onItem, setOnItem] = useState<string | null>(null);
  const onItemRef = useRef(onItem);
  onItemRef.current = onItem;
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [hush, setHush] = useState(0);
  const [results, setResults] = useState<LiveHit[]>([]);
  const [envs, setEnvs] = useState<Record<string, EditEnvironment>>({});
  const envsRef = useRef(envs);
  envsRef.current = envs;
  const [words, setWords] = useState<Record<string, TranscriptWord[]>>({});
  const [exporting, setExporting] = useState(false);
  // The video being joined into one clip for the layer editor
  const [editing, setEditing] = useState(false);
  // The background musics whose file is here, and how loud this live's clips are (what the preview sets the music against)
  const musics = useMusics();
  const [liveLufs, setLiveLufs] = useState<number | null>(null);
  // The AI looking at the passages to choose their templates, and what it said of its choice (by compilation)
  const [looking, setLooking] = useState(false);
  const [looksNote, setLooksNote] = useState<{ id: string; note: string } | null>(null);
  // A described video asked for a look: chosen once its clips are cut
  const pendingLooks = useRef<{ id: string; wish: string } | null>(null);
  // The AI choosing the video's music and intro: what it said, and a choice waiting to be asked (after a description, or a change that speaks of the sound)
  const [sounding, setSounding] = useState(false);
  const [soundNote, setSoundNote] = useState<{ id: string; note: string } | null>(null);
  const pendingSound = useRef<{ id: string; asked: string } | null>(null);
  // What the AI's last change did to the video: passages just added (lit) and just taken out (leaving)
  const [fresh, setFresh] = useState<{ ids: Set<string>; at: number } | null>(null);
  const [gone, setGone] = useState<{ item: CompilationItem; section: string; index: number }[]>([]);
  const lightTimer = useRef<number | undefined>(undefined);
  // Where each passage's words are really said (live seconds, null: not found), known once its clip is cut
  const [tight, setTight] = useState<Record<string, [number, number] | null>>({});
  // A described video is brought to its length once its passages are set on their words (their rough times say little)
  const [pendingFit, setPendingFit] = useState<{ id: string; target: number } | null>(null);
  const [failure, setFailure] = useState<LiveFailure | null>(null);
  const [toDelete, setToDelete] = useState(false);
  // Search results looked at before being added keep their id (and so their clip)
  const drafts = useRef(new Map<string, CompilationItem>());

  // The proposed video this visit was opened to build (see ?build=1), built once
  const buildFor = useRef<string | null>(null);
  const loaded = useRef<{ job: string; all: Promise<{ list: Compilation[]; open: string | null }> } | null>(null);
  const remember = useCallback(
    (list: Compilation[]) => {
      const states: Record<string, Piece> = {};
      for (const item of list.flatMap(allItems)) {
        if (item.file) states[item.id] = { ready: !!item.ready, file: item.file, file_start: item.file_start ?? null, file_end: item.file_end ?? null, job: item.job ?? jobId! };
      }
      setPieces((prev) => ({ ...prev, ...states }));
    },
    [jobId],
  );

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const live = getJobStatus(jobId);
    live
      .then((j) => {
        if (cancelled) return;
        setJob(j);
        const vodId = j.url?.match(/videos\/(\d+)/)?.[1];
        if (vodId) getStoryboard(vodId).then((sb) => !cancelled && sb && setStoryboards((prev) => ({ ...prev, [jobId]: sb }))).catch(() => {});
      })
      .catch(() => !cancelled && navigate("/"));
    getLiveSearchInfo(jobId).then((i) => !cancelled && setInfo(i)).catch(() => {});
    listAllCompilations().then((lives) => !cancelled && setLibrary(lives)).catch(() => {});
    listRenders()
      .then((renders) => !cancelled && setExported(new Set(renders.filter((r) => r.job_id === jobId && r.status === "done").flatMap((r) => /^comp_([a-z0-9]+)\.mp4$/.exec(r.clip_filename)?.[1] ?? []))))
      .catch(() => {});
    // ?lives=a,b: a new compilation that takes passages from these lives too (picked in the library)
    const wantsLives = (search.get("lives") ?? "").split(",").filter((id) => id && id !== jobId).slice(0, MAX_OTHER_LIVES);
    // Asked once per live, even when this runs twice (development): a new video is created once
    const wantsNew = search.get("new") === "1";
    // ?kind=clip|sequence: what the new video is made from (nothing said: a compilation)
    const wantsKind: VideoSource = isVideoSource(search.get("kind")) ? (search.get("kind") as VideoSource) : "compilation";
    const wantsVideo = search.get("v") ?? search.get("c");
    const wantsClip = search.get("clip");
    // ?build=1: a video the AI proposed, opened to be built
    if (search.get("build") === "1" && wantsVideo) buildFor.current = wantsVideo;
    if (loaded.current?.job !== jobId) {
      loaded.current = {
        job: jobId,
        all: listCompilations(jobId).then(async (list) => {
          if (wantsNew) {
            // A new one is asked for: the empty one left from last time does, rather than piling them up
            const blank = list.find((c) => allItems(c).length === 0 && !c.brief && !c.suggestion && sourceOf(c) === wantsKind);
            if (blank) {
              const same = (blank.lives ?? []).join() === wantsLives.join();
              const { lives: _before, ...rest } = blank;
              const kept = same ? blank : await saveCompilation(jobId, { ...rest, ...(wantsLives.length > 0 ? { lives: wantsLives } : {}) });
              return { list: [...list.filter((c) => c !== blank), kept], open: kept.id };
            }
            const made = await createCompilation(jobId, {
              name: t(`videos.new.${wantsKind}`),
              ...(wantsKind === "compilation" && wantsLives.length > 0 ? { lives: wantsLives } : {}),
              ...(wantsKind !== "compilation" ? { source: wantsKind, target: SOURCE_TARGET[wantsKind], titles: wantsKind !== "clip" } : {}),
            });
            return { list: [...list, made], open: made.id };
          }
          const withClip = async (filename: string) => {
            const known = list.find((c) => c.clip === filename);
            if (known) return { list, open: known.id };
            const made = await openKeptClip(jobId, filename);
            return { list: [...list, made], open: made.id };
          };
          if (wantsClip) return withClip(wantsClip);
          if (wantsVideo && list.some((c) => c.id === wantsVideo)) return { list, open: wantsVideo };
          // Nothing named: the first video kept from this live (a kept clip gets its video when it opens)
          const j = await live;
          const entries = liveEntries(buildMoments(j.hot_points ?? [], j.selection ?? {}), list);
          const first = VIDEO_SOURCES.flatMap((source) => entries[source]).find((entry) => entry.state === "kept");
          if (!first) return { list, open: null };
          return first.kind === "video" ? { list, open: first.video.id } : withClip(first.moment.filename);
        }),
      };
    }
    loaded.current.all
      .then(({ list, open }) => {
        if (cancelled) return;
        remember(list);
        setCompilations(list);
        setCurrentId(open);
        setActiveSection(list.find((c) => c.id === open)?.sections[0]?.id ?? "");
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : t("common.error"));
        setCompilations((prev) => prev ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const compilation = compilations?.find((c) => c.id === currentId) ?? null;
  const shownVideo = compilation;
  // Measured once a music or an intro is chosen (a few seconds of ffmpeg the first time, then kept with the clips)
  const hasMusic = !!compilation?.music || !!compilation?.intro;
  useEffect(() => {
    if (!jobId || !hasMusic) return;
    let stale = false;
    liveLoudness(jobId)
      .then((lufs) => !stale && setLiveLufs(lufs))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [jobId, hasMusic]);
  // The address names the video on screen: a reload, or coming back from an export, opens it again
  useEffect(() => {
    if (currentId && (search.get("v") !== currentId || search.has("new") || search.has("build") || search.has("c") || search.has("clip") || search.has("kind"))) setSearch({ v: currentId }, { replace: true });
  }, [currentId, search, setSearch]);
  const compilationsRef = useRef(compilations);
  compilationsRef.current = compilations;
  const liveDuration = job?.vod_duration_seconds ?? 0;

  /* ── The lives it takes passages from ───────────────────── */

  // Its own first, then the others: the order the AI numbers them in
  const liveIds = useMemo(() => (jobId ? [jobId, ...(compilation?.lives ?? [])] : []), [jobId, compilation?.lives]);
  const several = liveIds.length > 1;
  // What the video is made from: a clip, a sequence or a compilation (the same editor for the three)
  const source: VideoSource = sourceOf(compilation);
  const liveInfo = useCallback((job?: string) => library.find((live) => live.job_id === (job ?? jobId)), [library, jobId]);
  /** How long a live is (a passage's own when it names one) */
  const lengthOf = useCallback((job?: string) => (job && job !== jobId ? (liveInfo(job)?.duration ?? 0) : liveDuration), [jobId, liveDuration, liveInfo]);
  // The other lives' preview frames
  useEffect(() => {
    let cancelled = false;
    for (const id of compilation?.lives ?? []) {
      const vodId = liveInfo(id)?.vod_id;
      if (!vodId || storyboards[id]) continue;
      getStoryboard(vodId).then((sb) => !cancelled && sb && setStoryboards((prev) => (prev[id] ? prev : { ...prev, [id]: sb }))).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [compilation?.lives, liveInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Saving ─────────────────────────────────────────────── */

  const saveTimers = useRef(new Map<string, number>());
  const latest = useRef(new Map<string, Compilation>());
  // What each video's passages were before its last changes (cuts, order, what is in it): taken back with Undo
  const history = useRef(new Map<string, { stack: Compilation[]; at: number }>());
  const [undoable, setUndoable] = useState<Record<string, number>>({});
  const change = useCallback(
    (changed: Compilation, back = false) => {
      if (!jobId) return;
      // (a "hook" intro: the moment it plays is written on the video, the library counts its length with it)
      const next = withHook(changed);
      const before = compilationsRef.current?.find((c) => c.id === next.id);
      const passagesOf = (c: Compilation) => JSON.stringify(c.sections.map((sec) => sec.items.map((item) => [item.id, item.start, item.end])));
      if (!back && before && passagesOf(before) !== passagesOf(next)) {
        const kept = history.current.get(next.id) ?? { stack: [], at: 0 };
        // (a handle being dragged changes the cut many times a second: one step back for the whole move)
        if (Date.now() - kept.at > 700) kept.stack.push(before);
        kept.at = Date.now();
        if (kept.stack.length > UNDO_STEPS) kept.stack.shift();
        history.current.set(next.id, kept);
        setUndoable((prev) => (prev[next.id] === kept.stack.length ? prev : { ...prev, [next.id]: kept.stack.length }));
      }
      setCompilations((prev) => prev?.map((c) => (c.id === next.id ? next : c)) ?? prev);
      latest.current.set(next.id, next);
      window.clearTimeout(saveTimers.current.get(next.id));
      saveTimers.current.set(
        next.id,
        window.setTimeout(() => {
          const pending = latest.current.get(next.id);
          if (!pending) return;
          saveCompilation(jobId, pending)
            .then((saved) => remember([saved]))
            .catch((err) => toast.error(err instanceof Error ? err.message : t("brand.saveError")));
        }, SAVE_DELAY),
      );
    },
    [jobId, remember, t, toast],
  );

  /* ── Clips of the moments, cut from the live ────────────── */

  const ensure = useCallback(
    async (items: CompilationItem[]): Promise<Record<string, Piece>> => {
      if (!jobId) return piecesRef.current;
      // Those without a clip, and those whose words are still to be found in theirs
      const todo = items.filter((item) => item.fit || !covers(piecesRef.current[item.id], item));
      if (todo.length === 0) return piecesRef.current;
      setCutting((prev) => new Set([...prev, ...todo.map((i) => i.id)]));
      let known = piecesRef.current;
      try {
        // Each live cuts its own passages, a few at a time
        const batches: { live: string; batch: CompilationItem[] }[] = [];
        // (the videos of the media library first and apart: they need nothing of the live, which may be gone)
        const mine = todo.filter((item) => item.media);
        if (mine.length > 0) batches.push({ live: jobId, batch: mine });
        const cut = todo.filter((item) => !item.media);
        for (const live of new Set(cut.map((item) => item.job ?? jobId))) {
          const theirs = cut.filter((item) => (item.job ?? jobId) === live);
          for (let i = 0; i < theirs.length; i += CUT_BATCH) batches.push({ live, batch: theirs.slice(i, i + CUT_BATCH) });
        }
        for (const { live, batch } of batches) {
          // A passage still on the transcript's rough times: its clip holds those lines whole, and tells where they are really said
          const asked = batch.map(pieceAsk);
          const done = await ensurePieces(live, asked);
          const states = Object.fromEntries(done.pieces.map(({ id, tight: _found, ...state }) => [id, { ...state, job: live }]));
          const found = Object.fromEntries(done.pieces.filter((piece) => piece.tight !== undefined).map((piece) => [piece.id, piece.tight ?? null]));
          known = { ...known, ...states };
          piecesRef.current = { ...piecesRef.current, ...states };
          setPieces((prev) => ({ ...prev, ...states }));
          if (Object.keys(found).length > 0) setTight((prev) => ({ ...prev, ...found }));
          setCutting((prev) => new Set([...prev].filter((id) => !batch.some((b) => b.id === id))));
          if (done.failed.length > 0) toast.error(t("compilation.failure.failed"));
        }
      } catch (err) {
        const reason = err instanceof LiveError ? err.reason : "failed";
        setFailure(reason);
        toast.error(t(`compilation.failure.${reason}`));
      } finally {
        setCutting((prev) => new Set([...prev].filter((id) => !todo.some((b) => b.id === id))));
      }
      return known;
    },
    [jobId, t, toast],
  );

  // Coming back to a compilation: the clips that are missing get cut again
  const ensuredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!compilation || ensuredFor.current === compilation.id) return;
    ensuredFor.current = compilation.id;
    ensure(allItems(compilation));
  }, [compilation, ensure]);

  // A passage's clip is cut: the passage goes where its words are really said (the transcript's times were rough)
  useEffect(() => {
    if (Object.keys(tight).length === 0) return;
    for (const [key, draft] of drafts.current) {
      if (draft.fit && tight[draft.id] !== undefined) drafts.current.set(key, tightened(draft, tight[draft.id]));
    }
    setShown((item) => (item?.fit && tight[item.id] !== undefined ? tightened(item, tight[item.id]) : item));
    if (!compilation) return;
    const set = applyTight(compilation, tight);
    if (set !== compilation) change(set);
  }, [change, compilation, tight]);

  // A described video: once its passages are set on their words, brought to the length asked for (the weakest passages go)
  useEffect(() => {
    if (!pendingFit || !compilation || compilation.id !== pendingFit.id || cutting.size > 0) return;
    // Passages whose words were just found are being set (the effect above): after them
    if (allItems(compilation).some((item) => item.fit && tight[item.id] !== undefined)) return;
    setPendingFit(null);
    // "About 1 min 30" stands up to a tenth over; past that the weakest passages go. None is shortened: they are cut on their words
    const fitted = fitToTarget(compilation, pendingFit.target * PLAN_OVER, true);
    if (fitted !== compilation) change(fitted);
  }, [change, compilation, cutting, pendingFit, tight]);

  const loadEnv = useCallback(
    async (piece: Piece): Promise<EditEnvironment> => {
      const key = pieceVersion(piece);
      const known = envsRef.current[key];
      if (known) return known;
      const env = await getEditEnvironment(piece.job, piece.file);
      envsRef.current = { ...envsRef.current, [key]: env };
      setEnvs((prev) => ({ ...prev, [key]: env }));
      return env;
    },
    [],
  );

  /* ── Search results and the compilation ─────────────────── */

  const draftOf = useCallback(
    (hit: LiveHit): CompilationItem => {
      const key = hitKey(hit);
      const known = drafts.current.get(key);
      if (known) return known;
      const item = itemFromHit(hit, lengthOf(hit.job));
      drafts.current.set(key, item);
      return item;
    },
    [lengthOf],
  );

  const watch = (hit: LiveHit) => {
    const item = (compilation && itemFor(compilation, hit)) || draftOf(hit);
    setShown(item);
    ensure([item]);
  };

  const add = (hits: LiveHit[], query: string) => {
    if (!compilation) return;
    const section = compilation.sections.find((s) => s.id === activeSection) ?? compilation.sections[compilation.sections.length - 1];
    if (!section) return;
    const { compilation: next, added } = addItems(compilation, section.id, hits.map(draftOf));
    if (added === 0) {
      toast.info(t("compilation.alreadyThere"));
      return;
    }
    // A section filled by a search takes its name from it
    const named = section.items.length === 0 && !section.title.trim() && query ? query.charAt(0).toUpperCase() + query.slice(1) : null;
    const withTitle = named ? { ...next, sections: next.sections.map((s) => (s.id === section.id ? { ...s, title: named.slice(0, 60), query } : s)) } : next;
    change(withTitle);
    ensure(allItems(withTitle));
    toast.success(t("compilation.addedCount", { count: added }));
  };

  /** Where a video of the media library ends, seconds (its file's end) */
  const lastOf = (item: CompilationItem): number => mediaOf(ownVideos, item.media)?.seconds ?? piecesRef.current[item.id]?.file_end ?? item.end;
  /**
   * Videos of the media library become passages of the video on screen, whole: right after the
   * passage open in the part being filled, else at its end. The same one can be added again.
   */
  const addMedia = (list: MediaItem[]) => {
    if (!compilation || list.length === 0) return;
    const section = compilation.sections.find((s) => s.id === activeSection) ?? compilation.sections[compilation.sections.length - 1];
    if (!section) return;
    const made = list.map(itemFromMedia);
    const after = shown && section.items.some((item) => item.id === shown.id) ? shown.id : null;
    const next = insertItems(compilation, section.id, made, after);
    change(next);
    ensure(made);
    light(made.map((item) => item.id));
    toast.success(t("media.added", { count: made.length }));
  };

  /** The AI changed the video as asked: what it kept stays as it was, what it added gets its clip */
  const applyChange = (plan: VideoPlan, ask: string) => {
    if (!compilation) return { error: "no video open" };
    const note = plan.note ?? "";
    // A lasting taste they stated in this request, that the AI noted for their next videos: written under its answer
    const noted = plan.remembered?.length ? { remembered: plan.remembered } : {};
    const revised = revisedSections(compilation, plan, lengthOf);
    // An answer with no video in it (it found nothing, or misread): the video stays, its answer is kept
    if (revised.sections.length === 0 || (revised.added === 0 && revised.removed === 0 && revised.recut.length === 0 && sameOrder(compilation, revised.sections))) {
      change({ ...compilation, asks: [...(compilation.asks ?? []), { ask, note, ...noted }] });
      toast.info(t("compilation.changeNothing"));
      return { changed: false, note };
    }
    const next = { ...compilation, sections: revised.sections, asks: [...(compilation.asks ?? []), { ask, note, added: revised.added, removed: revised.removed, recut: revised.recut.length, ...noted }] };
    // A change that speaks of the music or the intro: the AI chooses them again with it in mind
    if (/musi|músic|intro|jingle|sound|sonido|bande.son/i.test(ask)) pendingSound.current = { id: compilation.id, asked: ask };
    change(next);
    if (!next.sections.some((s) => s.id === activeSection)) setActiveSection(next.sections[0].id);
    // What changed shows in the video: the new passages come in lit, those taken out leave
    // A passage to cut again waits for where its new lines are said: what was found for its old ones is forgotten
    if (revised.recut.length > 0) setTight((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !revised.recut.includes(id))));
    light([...revised.fresh, ...revised.recut]);
    setGone(revised.gone);
    window.setTimeout(() => setGone([]), LEAVE_MS);
    ensure(allItems(next));
    toast.success(t("compilation.changeDone", { added: revised.added, removed: revised.removed, recut: revised.recut.length }));
    return { changed: true, added: revised.added, removed: revised.removed, recut: revised.recut.length, passages: allItems(next).length, parts: next.sections.map((sec) => ({ title: sec.title, passages: sec.items.length })), note };
  };

  /** Passages lit in the video for a moment */
  const light = (ids: string[]) => {
    setFresh({ ids: new Set(ids), at: Date.now() });
    window.clearTimeout(lightTimer.current);
    lightTimer.current = window.setTimeout(() => setFresh(null), LIT_MS);
  };
  /** `again`: the same description asked again on purpose: the new plan takes the place of the video on screen */
  /** `into`: the video the plan is for (the one on screen unless said); answers the video as planned, null when nothing came of it */
  const applyPlan = async (plan: VideoPlan, target: number, brief: string, again = false, into?: string): Promise<Compilation | null> => {
    const compilation = into ? (compilationsRef.current?.find((c) => c.id === into) ?? null) : shownVideo;
    if (!jobId || !compilation) return null;
    const sections = sectionsFromPlan(plan, lengthOf);
    if (sections.length === 0) return null;
    try {
      let planned: Compilation;
      if (allItems(compilation).length === 0 || again) {
        // The compilation on screen is empty: the plan fills it (a video the AI proposed keeps the name it was proposed under)
        // (the hook the AI wrote for the first seconds is the video's, unless the streamer had written one)
        planned = {
          ...compilation,
          name: (compilation.suggestion ? compilation.name : plan.title) || compilation.name,
          sections,
          target,
          titles: sections.length > 1 || compilation.titles,
          hook: compilation.hook.trim() || (plan.hook ?? "").trim().slice(0, 120),
          brief,
          answer: plan.note ?? "",
          asks: [],
        };
        change(planned);
      } else {
        // Another video from the same lives
        const draft = { name: plan.title || t("compilation.defaultName"), target, titles: true, ...(compilation.lives?.length ? { lives: compilation.lives } : {}), ...(sourceOf(compilation) !== "compilation" ? { source: sourceOf(compilation) } : {}) };
        planned = { ...(await createCompilation(jobId, draft)), sections, hook: (plan.hook ?? "").trim().slice(0, 120), brief, answer: plan.note ?? "", asks: [] };
        setCompilations((prev) => [...(prev ?? []), planned]);
        setCurrentId(planned.id);
        change(planned);
      }
      if (planned.id === currentIdRef.current || planned.id !== compilation.id) {
        setActiveSection(planned.sections[0].id);
        setShown(null);
      }
      // The description said how the video should look: the AI lays it out once the clips are there
      pendingLooks.current = plan.look?.trim() ? { id: planned.id, wish: plan.look.trim() } : null;
      // ...and chooses its music and its intro from what kind of video it is (the description may ask for some, or for none)
      pendingSound.current = { id: planned.id, asked: brief };
      // What the AI planned can run over: brought back to the length asked for once each passage has its real length
      setPendingFit({ id: planned.id, target });
      ensure(allItems(planned));
      return planned;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      return null;
    }
  };

  /** New bounds for the moment on screen (live seconds): saved when it is in the compilation, its clip cut again when needed */
  const recut = (item: CompilationItem, start: number, end: number) => {
    // The streamer's own cut: no longer waiting to be set on its words
    const { fit: _waiting, ...kept } = item;
    // (a video of the media library ends where its file does)
    const last = item.media ? lastOf(item) : Infinity;
    const moved = { ...kept, start: Math.round(start * 100) / 100, end: Math.round(Math.min(end, last) * 100) / 100 };
    setShown(moved);
    if (compilation && allItems(compilation).some((i) => i.id === item.id)) change(updateItem(compilation, item.id, { start: moved.start, end: moved.end, fit: undefined }));
    else for (const [key, draft] of drafts.current) if (draft.id === item.id) drafts.current.set(key, moved);
    ensure([moved]);
  };

  /** Another video of this live on screen (what was being cut for the one before goes on in the background) */
  const openVideo = (id: string) => {
    const next = compilations?.find((c) => c.id === id);
    if (!next || id === currentId) return;
    setCurrentId(id);
    setActiveSection(next.sections[0]?.id ?? "");
    setShown(null);
    setResults([]);
  };
  /** A kept clip opened for the first time: it becomes a video like the others */
  const openClip = async (filename: string) => {
    if (!jobId || openingClip) return;
    const known = compilations?.find((c) => c.clip === filename);
    if (known) return openVideo(known.id);
    setOpeningClip(filename);
    try {
      const made = await openKeptClip(jobId, filename);
      remember([made]);
      setCompilations((prev) => [...(prev ?? []).filter((c) => c.id !== made.id), made]);
      setCurrentId(made.id);
      setActiveSection(made.sections[0]?.id ?? "");
      setShown(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setOpeningClip(null);
    }
  };

  const startNew = async (kind: VideoSource = sourceOf(compilation)) => {
    if (!jobId) return;
    try {
      const created = await createCompilation(jobId, { name: t(`videos.new.${kind}`), ...(kind !== "compilation" ? { source: kind, target: SOURCE_TARGET[kind], titles: kind !== "clip" } : {}) });
      setCompilations((prev) => [...(prev ?? []), created]);
      setCurrentId(created.id);
      setActiveSection(created.sections[0]?.id ?? "");
      setShown(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  };

  const confirmDelete = async () => {
    setToDelete(false);
    if (!jobId || !compilation || !compilations) return;
    try {
      window.clearTimeout(saveTimers.current.get(compilation.id));
      latest.current.delete(compilation.id);
      await deleteCompilation(jobId, compilation.id);
      toast.success(t("compilation.deleted"));
      // Back to what the live gives
      navigate(`/${jobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  };

  /* ── The video ──────────────────────────────────────────── */

  const customs = useMemo(() => customTemplates(kit), [kit]);
  const defaultKey = defaultTemplateKey(kit, customs);
  const templateKey: TemplateKey = compilation?.template && (isBuiltIn(compilation.template) || findCustom(compilation.template, customs)) ? compilation.template : defaultKey;
  const templates = useMemo(
    () => [...customs.map((c) => ({ key: c.id, name: c.name })), ...TEMPLATE_IDS.map((id) => ({ key: id as string, name: t(`montage.template.${id}.name`) }))],
    [customs, t],
  );

  /** What Remotion plays for these items (all with their clip and its data), null when something is missing */
  const build = useCallback(
    (source: Compilation, states: Record<string, Piece>, known: Record<string, EditEnvironment>, all: Compilation = source) =>
      kit && jobId ? buildVideo({ jobId, kit, channel: channel ?? null, customs, game: job?.vod_game ?? null, musics, t }, source, states, known, all) : null,
    [channel, customs, job?.vod_game, jobId, kit, musics, t],
  );

  // What the intro picker draws its sketches with
  const brand = useMemo<IntroBrand | undefined>(
    () =>
      kit
        ? {
            name: channel?.display_name ?? channel?.login ?? kit.twitch_login ?? "",
            logo: channel?.avatar_url ?? null,
            colors: kit.colors,
            font: fontFamily(
              hookOf(templateKey, { facecam: null, subtitleStyle: kit.subtitles.style } as Parameters<typeof hookOf>[1], customs, isHookStyle(compilation?.titleStyle) ? compilation.titleStyle : null).font,
            ),
          }
        : undefined,
    [channel, compilation?.titleStyle, customs, kit, templateKey],
  );

  /* ── The look of each passage ───────────────────────────── */

  const templateName = useCallback((key: string) => templates.find((tpl) => tpl.key === key)?.name ?? key, [templates]);

  /** The AI looks at the passages whose clip is cut and chooses the template of each (`wish`: what the streamer asked about the look) */
  const chooseByAi = useCallback(
    async (source: Compilation, wish = "") => {
      if (!jobId || !kit) return;
      const items = allItems(source).filter((item) => covers(piecesRef.current[item.id], item));
      if (items.length === 0) return;
      setLooking(true);
      try {
        const guides = templateGuides(customs, { nameOf: (id) => t(`montage.template.${id}.name`), subtitleStyle: kit.subtitles.style, widget: kit.widget });
        const choice = await chooseLooks(jobId, {
          items: items.map(({ id, start, end, text, job }) => ({ id, start, end, text, ...(job ? { job } : {}) })),
          templates: guides,
          wish,
          usual: templateKey,
          language: i18n.language.slice(0, 2),
        });
        // What the streamer changed while the AI was looking stays
        const current = compilationsRef.current?.find((c) => c.id === source.id) ?? source;
        const next = applyLooks(current, choice.main, choice.looks);
        change(next);
        setLooksNote({ id: source.id, note: choice.note });
        const summary = looksCount(next, defaultKey)
          .map(([key, count]) => `${templateName(key)} × ${count}`)
          .join(", ");
        toast.success(t("compilation.looksDone", { summary }));
      } catch (err) {
        toast.error(t(`compilation.failure.${err instanceof LiveError ? err.reason : "failed"}`));
      } finally {
        setLooking(false);
      }
    },
    [change, customs, defaultKey, i18n.language, jobId, kit, t, templateKey, templateName, toast],
  );

  // A described video that asked for a look gets it as soon as all its clips are cut
  useEffect(() => {
    const pending = pendingLooks.current;
    if (!pending || looking || !compilation || compilation.id !== pending.id || cutting.size > 0) return;
    // Once the video has its passages for good: set on their words, brought to its length
    if (pendingFit?.id === pending.id) return;
    const items = allItems(compilation);
    if (items.length === 0 || !items.every((item) => covers(pieces[item.id], item))) return;
    pendingLooks.current = null;
    chooseByAi(compilation, pending.wish);
  }, [chooseByAi, compilation, cutting, looking, pendingFit, pieces]);

  /** The AI says what kind of video this is and chooses its music and its intro (or none), starting from the streamer's favourites */
  const soundByAi = useCallback(
    async (source: Compilation, asked = "") => {
      if (!jobId || allItems(source).length === 0) return;
      setSounding(true);
      try {
        const { ids, ...brief } = soundBrief(source);
        const choice = await chooseSound(jobId, { ...brief, asked, language: i18n.language.slice(0, 2), compilation: source.id, universe: source.universe ?? null });
        // What the streamer changed while the AI was thinking stays
        const current = compilationsRef.current?.find((c) => c.id === source.id) ?? source;
        // A track whose file isn't on this machine can't be played: left out. The passage it would open the video on is told by its place among those it was sent
        const dressed = applySound(current, { music: trackOf(musics, choice.music) ? choice.music : null, intro: choice.intro, look: choice.look, opening: choice.teaser ? ids[choice.teaser - 1] : null });
        // ...and the transition it chose becomes the video's (a passage that has its own keeps it)
        const next = choice.transition && (choice.transition === PLAIN_CUT || isTransition(choice.transition)) ? setVideoTransition(dressed, choice.transition) : dressed;
        change(next);
        setSoundNote({ id: source.id, note: choice.why });
        toast.success(
          t("compilation.soundAi.done", {
            music: trackOf(musics, next.music?.track)?.name ?? t("compilation.soundAi.none"),
            intro: isIntro(next.intro?.style) ? t(`compilation.intro.style.${next.intro.style}`) : t("compilation.soundAi.none"),
          }),
        );
      } catch (err) {
        toast.error(t(`compilation.failure.${err instanceof LiveError ? err.reason : "failed"}`));
      } finally {
        setSounding(false);
      }
    },
    [change, i18n.language, jobId, musics, t, toast],
  );
  // Asked for when a video was just described, or changed with a word about its sound
  useEffect(() => {
    const pending = pendingSound.current;
    if (!pending || !compilation || compilation.id !== pending.id || sounding) return;
    pendingSound.current = null;
    soundByAi(compilation, pending.asked);
  }, [compilation, soundByAi, sounding]);

  // The data of each clip (size, cam, words, chat) for the preview
  const readyItems = useMemo(() => (compilation ? allItems(compilation).filter((item) => covers(pieces[item.id], item)) : []), [compilation, pieces]);
  useEffect(() => {
    for (const item of readyItems) loadEnv(pieces[item.id]).catch(() => {});
  }, [readyItems, pieces, loadEnv]);

  const preview = useMemo(() => {
    if (!compilation) return null;
    // What is ready plays already: the rest joins as its clips arrive
    const ready = { ...compilation, sections: compilation.sections.map((s) => ({ ...s, items: s.items.filter((item) => covers(pieces[item.id], item) && envs[pieceVersion(pieces[item.id])]) })) };
    return build(ready, pieces, envs, compilation);
  }, [build, compilation, envs, pieces]);

  // What a "hook" intro can open the video on, for the intro picker: every passage but the first, the one it plays, its words
  const hookMenu = useMemo<HookMenu | undefined>(() => {
    if (!compilation) return undefined;
    const moment = hookMoment(compilation);
    const piece = moment ? pieces[moment.item.id] : undefined;
    const env = piece ? envs[pieceVersion(piece)] : undefined;
    const origin = piece?.file_start;
    return {
      passages: allItems(compilation)
        .slice(1)
        .map((item, i) => ({ id: item.id, number: i + 2, text: item.text, start: item.start, end: item.end })),
      moment: moment ? { item: moment.item.id, start: moment.start, end: moment.end, auto: moment.auto } : null,
      named: !!moment?.auto && !!moment.item.opening,
      // (the clip's words, on the live's clock as the passage's own times are)
      words: env && origin != null ? env.words.map((word) => ({ start: word.start + origin, end: word.end + origin })) : undefined,
      onPlay: () => {
        playerRef.current?.seekTo(0);
        playerRef.current?.play();
      },
    };
  }, [compilation, envs, pieces]);

  // Where each passage plays in the whole video, frames; `clear`: its first frame once the transition it comes in with is over
  const marks = useMemo(() => {
    // The first passage starts once the intro has held the screen, and is clear of it once the intro has left
    const intro = preview?.montage.intro;
    const leaving = playsIntro(intro) ? introSpan(intro.style, FPS, intro.hook?.duration ?? intro.hold).out : 0;
    let at = introHold(intro, FPS);
    return (preview?.montage.segments ?? []).map((segment, i) => {
      const from = at;
      at += framesOf(segment.duration, FPS);
      const coming = Math.max(isTransition(segment.transition) ? transitionSpan(segment.transition, FPS).after : 0, i === 0 ? leaving : 0);
      return { id: preview!.ids[i], from, to: at, clear: Math.min(at - 1, from + coming) };
    });
  }, [preview]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  // In the page the intro's sound and the music are files the player plays (the export mixes them in afterwards)
  const playerProps = useMemo(() => (preview ? playable(preview.montage, musics, liveLufs) : undefined), [liveLufs, musics, preview]);
  // The same passages in the same order: the same player, which keeps its place when a cut or a template changes
  const playerKey = preview ? `${compilation?.id}-${templateKey}-${preview.files.join(",")}` : "";
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerKey) return;
    const here = (frame: number) => setOnItem(marksRef.current.find((mark) => frame >= mark.from && frame < mark.to)?.id ?? null);
    const onFrame = (e: { detail: { frame: number } }) => here(e.detail.frame);
    const onPlay = () => {
      setVideoPlaying(true);
      // The passage open below stops: one sound at a time
      setHush((n) => n + 1);
    };
    const onPause = () => setVideoPlaying(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    here(player.getCurrentFrame());
    setVideoPlaying(player.isPlaying());
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [playerKey]);
  // A cut that moved: the playhead may now be on another passage
  useEffect(() => {
    const frame = playerRef.current?.getCurrentFrame();
    if (frame !== undefined) setOnItem(marks.find((mark) => frame >= mark.from && frame < mark.to)?.id ?? null);
  }, [marks]);
  /** The whole video goes to where a passage starts: it plays on from there, or stays stopped on its first clear picture (not in the middle of a transition) */
  const jumpTo = (id: string) => {
    const mark = marksRef.current.find((m) => m.id === id);
    const player = playerRef.current;
    if (mark && player) player.seekTo(player.isPlaying() ? mark.from : mark.clear);
  };

  const exportNow = async () => {
    if (!jobId || !compilation || exporting) return;
    setExporting(true);
    try {
      const items = allItems(compilation);
      const states = await ensure(items);
      if (items.some((item) => !covers(states[item.id], item))) throw new Error(t("compilation.failure.failed"));
      const known: Record<string, EditEnvironment> = {};
      for (const item of items) known[pieceVersion(states[item.id])] = await loadEnv(states[item.id]);
      const built = build(compilation, states, known);
      if (!built) throw new Error(t("montage.exportFailed"));
      // Saved as it is exported
      await saveCompilation(jobId, compilation);
      await startMontageRender(jobId, renderRequest(built, compilation), { width: 1080, height: 1920, fps: FPS });
      navigate(`/${jobId}/export`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("montage.exportFailed"));
      setExporting(false);
    }
  };

  /* ── Cutting, from the timeline ─────────────────────────── */

  /** The last change of the video's passages is taken back */
  const undo = () => {
    if (!compilation) return;
    const kept = history.current.get(compilation.id);
    const before = kept?.stack.pop();
    if (!kept || !before) return;
    setUndoable((prev) => ({ ...prev, [compilation.id]: kept.stack.length }));
    // (what is said of the video elsewhere stays as it is now: only its passages go back)
    change({ ...compilation, sections: before.sections }, true);
    setShown(null);
    ensure(allItems(before));
  };
  /** The words said in a passage's clip (clip seconds), fetched once */
  const wordsOf = async (piece: Piece): Promise<TranscriptWord[]> => {
    const key = pieceVersion(piece);
    if (words[key]) return words[key];
    const list = await getClipWords(piece.job, piece.file).catch(() => [] as TranscriptWord[]);
    setWords((prev) => ({ ...prev, [key]: list }));
    return list;
  };
  /** The passage the tools work on: the one open to be cut, else the one the video is on */
  const toolItem = () => {
    if (!compilation) return null;
    const all = allItems(compilation);
    return all.find((item) => item.id === shown?.id) ?? all.find((item) => item.id === onItemRef.current) ?? null;
  };
  const afterCut = (next: Compilation, ids: string[]) => {
    change(next);
    ensure(allItems(next));
    light(ids.slice(1));
  };
  /** The passage under the playhead is cut in two there (between two words when its words are known) */
  const cutHere = async () => {
    const player = playerRef.current;
    if (!compilation || !player) return;
    const frame = player.getCurrentFrame();
    const mark = marksRef.current.find((m) => frame >= m.from && frame < m.to);
    const item = mark ? allItems(compilation).find((one) => one.id === mark.id) : undefined;
    const piece = item ? piecesRef.current[item.id] : undefined;
    if (!mark || !item || !covers(piece, item)) return toast.info(t("montage.cutNowhere"));
    const said = await wordsOf(piece);
    const origin = piece.file_start;
    const at = origin + snapToWords(item.start - origin + (frame - mark.from) / FPS, said);
    const text = (a: number, b: number) => wordsIn(said, a - origin, b - origin).map((w) => w.word).join(" ");
    const { compilation: next, ids } = splitItem(compilation, item.id, at, said.length > 0 ? [text(item.start, at), text(at, item.end)] : undefined);
    if (ids.length === 0) return toast.info(t("montage.cutTooClose"));
    afterCut(next, ids);
  };
  /** The blanks of a passage are taken out: it becomes as many passages as there is talk between them */
  const dropSilences = async () => {
    const item = toolItem();
    const piece = item ? piecesRef.current[item.id] : undefined;
    if (!compilation || !item || !covers(piece, item)) return;
    const said = await wordsOf(piece);
    const origin = piece.file_start;
    const kept = tighten([[item.start - origin, item.end - origin]], said, piece.file_end - origin);
    if (said.length === 0) return toast.info(t("project.tightenNoWords"));
    if (kept.length === 1 && Math.abs(kept[0][0] - (item.start - origin)) < 0.05 && Math.abs(kept[0][1] - (item.end - origin)) < 0.05) return toast.info(t("montage.noSilence"));
    const { compilation: next, ids } = cutItem(compilation, item.id, kept.map(([a, b]) => [a + origin, b + origin] as [number, number]), kept.map(([a, b]) => wordsIn(said, a, b).map((w) => w.word).join(" ")));
    afterCut(next, ids);
    toast.success(t("montage.silencesOut", { count: ids.length }));
  };
  /** 30 s more of the live on one side of a passage (its clip is cut again from the live) */
  const extend = (side: "start" | "end") => {
    const item = toolItem();
    if (!compilation || !item) return;
    const next = extendItem(compilation, item.id, side, 30, item.media ? lastOf(item) : lengthOf(item.job));
    if (next === compilation) return toast.info(t(item.media ? "media.whole" : side === "start" ? "project.extendEdgeStart" : "project.extendEdgeEnd"));
    change(next);
    const moved = allItems(next).find((one) => one.id === item.id)!;
    setShown((open) => (open?.id === item.id ? moved : open));
    ensure([moved]);
  };
  // The length the AI's cut of a clip aims for, kept for this live (null: left to the AI)
  const [cutTarget, setCutTarget] = useState<CutTarget>(() => (jobId ? readCutTarget(jobId) : null));
  const [aiCutting, setAiCutting] = useState(false);
  /** A clip's video is cut again by the AI: the parts worth keeping become its passages */
  /** (`aim`: the length to aim for, seconds; nothing said: the one set on the button. Answers what was done, as the assistant is told) */
  const aiCut = async (aim: number | null = cutTarget) => {
    if (!jobId || !compilation) return { error: "no video open" };
    if (!compilation.clip) return { error: "this video is not made of a clip: ask for a change of the video instead" };
    if (aiCutting) return { error: "this clip is already being cut" };
    const id = compilation.id;
    setAiCutting(true);
    try {
      const { parts, note, origin } = await suggestClipCut(jobId, compilation.clip, { target: aim });
      const current = compilationsRef.current?.find((c) => c.id === id);
      if (!current || parts.length === 0 || origin == null) {
        toast.info(t("project.aiCutSame"));
        return { cut: false, why: "nothing to take out: the clip stays as it was" };
      }
      const next = recutVideo(current, parts.map(([a, b]) => [origin + a, origin + b] as [number, number]));
      change(next);
      setShown(null);
      ensure(allItems(next));
      toast.success(note || t("project.aiCutDone", { count: parts.length }));
      return { cut: true, video: id, pieces: parts.length, seconds: Math.round(parts.reduce((sum, [a, b]) => sum + b - a, 0) * 10) / 10, note };
    } catch (err) {
      const reason = err instanceof LiveError ? err.reason : "failed";
      toast.error(t(reason === "no_transcript" ? "project.tightenNoWords" : `compilation.failure.${reason}`));
      return { error: reason === "no_transcript" ? "this clip has no words to cut on" : reason };
    } finally {
      setAiCutting(false);
    }
  };

  /**
   * A passage made of an imported video is cut by the AI on what is said in it: the parts worth
   * keeping become passages, in its place (as « Montage IA » does of a clip).
   */
  const aiCutPassage = async (item: CompilationItem, aim: number | null = cutTarget) => {
    const piece = piecesRef.current[item.id];
    if (!compilation || aiCutting || !covers(piece, item)) return;
    const id = compilation.id;
    setAiCutting(true);
    try {
      // (listened to now if it never was)
      const said = await wordsOf(piece);
      if (said.length === 0) return void toast.info(t("project.tightenNoWords"));
      const origin = piece.file_start;
      const { parts, note } = await suggestClipCut(piece.job, piece.file, { target: aim, current: [[item.start - origin, item.end - origin]] });
      const current = compilationsRef.current?.find((c) => c.id === id);
      const text = (a: number, b: number) => wordsIn(said, a, b).map((w) => w.word).join(" ");
      const cut = current && parts.length > 0 ? cutItem(current, item.id, parts.map(([a, b]) => [origin + a, origin + b] as [number, number]), parts.map(([a, b]) => text(a, b))) : null;
      if (!cut || cut.ids.length === 0) return void toast.info(t("project.aiCutSame"));
      afterCut(cut.compilation, cut.ids);
      setShown(null);
      toast.success(note || t("project.aiCutDone", { count: cut.ids.length }));
    } catch (err) {
      const reason = err instanceof LiveError ? err.reason : "failed";
      toast.error(t(reason === "no_transcript" ? "project.tightenNoWords" : `compilation.failure.${reason}`));
    } finally {
      setAiCutting(false);
    }
  };

  /* ── What the AI does on a video: asked here, or from the assistant ── */

  // What it is doing while a video is built or changed, a line each
  const busyOn = working?.id ?? null;
  useEffect(() => {
    if (!jobId || !busyOn) return;
    let stopped = false;
    const ask = async () => {
      const doing = await getLiveSearchProgress(jobId);
      if (stopped || !doing) return;
      const line = stepText(t, doing);
      // (a step that counts, « 12/41 », keeps its line)
      setWorking((now) => {
        if (!now || now.id !== busyOn) return now;
        const last = now.lines[now.lines.length - 1];
        return last === line ? now : { ...now, lines: last !== undefined && sameStep(last, line) ? [...now.lines.slice(0, -1), line] : [...now.lines, line] };
      });
    };
    const timer = window.setInterval(ask, 1200);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [busyOn, jobId, t]);

  /** A video built by the AI from its description (`leads`: moments already spotted for it): parts, passages, then its look */
  const describe = async (id: string, brief: string, target: number, leads: number[] = [], fresh = false) => {
    const video = compilationsRef.current?.find((c) => c.id === id);
    if (!jobId || !video) return { error: "no such video in this live" };
    if (working || (jobId && building(builds, jobId, id))) return { error: "a video is already being built" };
    setWorking({ id, lines: [] });
    setFailure(null);
    try {
      const plan = await planLiveVideo(jobId, brief, target, undefined, video.lives ?? [], leads, fresh, sourceOf(video));
      // « I don't like it when you... »: the AI keeps it for the next videos, and says so
      plan.remembered?.forEach((said) => toast.success(t("memory.remembered", { said })));
      const count = plan.sections.reduce((sum, section) => sum + section.hits.length, 0);
      if (count === 0) {
        toast.info(t("compilation.planEmpty"));
        return { built: false, why: "nothing in the live matches this", note: plan.note ?? "" };
      }
      const planned = await actions.current.applyPlan(plan, target, brief, fresh, id);
      if (!planned) return { error: "the video could not be built" };
      // Answered from the disk (the same description as a time before): said under the video, where it can be asked again
      setKeptPlan(plan.cached ? { id: planned.id, brief, target, leads } : null);
      toast.success(t("compilation.planned", { count }));
      return { built: true, video: planned.id, name: planned.name, passages: count, parts: planned.sections.map((section) => ({ title: section.title, passages: section.items.length })), note: plan.note ?? "", cost: plan.cost ?? 0 };
    } catch (err) {
      const reason = err instanceof LiveError ? err.reason : "failed";
      setFailure(reason);
      toast.error(t(`compilation.failure.${reason}`));
      return { error: reason };
    } finally {
      setWorking(null);
    }
  };

  /** The video on screen changed by the AI as asked: it starts from the video as it is and from what was asked before */
  const revise = async (request: string) => {
    const video = actions.current.compilation;
    if (!jobId || !video) return { error: "no video open" };
    if (!request.trim()) return { error: "say what to change" };
    if (allItems(video).length === 0) return { error: "this video has nothing in it yet: build it first" };
    if (working) return { error: "a video is already being built" };
    setWorking({ id: video.id, lines: [] });
    try {
      // (a video made by hand was never described: its name stands for what it is)
      const plan = await planLiveVideo(jobId, video.brief?.trim() || video.name, video.target ?? Math.round(compilationLength(video)), { request, current: planCurrent(video), asks: (video.asks ?? []).map((turn) => turn.ask) }, video.lives ?? [], [], false, sourceOf(video));
      plan.remembered?.forEach((said) => toast.success(t("memory.remembered", { said })));
      // (the streamer may have gone to another video meanwhile: the change is for the one it was asked on)
      if (actions.current.compilation?.id !== video.id) await show(video.id);
      return { ...actions.current.applyChange(plan, request), cost: plan.cost ?? 0 };
    } catch (err) {
      const reason = err instanceof LiveError ? err.reason : "failed";
      toast.error(t(`compilation.failure.${reason}`));
      return { error: reason };
    } finally {
      setWorking(null);
    }
  };

  /** Passages the assistant found, added at the end of a part of the video on screen (`part`: its title; one no part has makes a new part) */
  /**
   * Videos of the media library put into the video by the assistant, each named by its id or its
   * name: whole, at the end of a part (the last one unless named; a title no part has makes one).
   * Answers what was added, and the names it has no video for with those there are.
   */
  const addImported = (named: unknown, part = "") => {
    if (!jobId || !compilation) return { error: "no video open" };
    const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const found: MediaItem[] = [];
    const unknown: string[] = [];
    for (const one of Array.isArray(named) ? named : []) {
      const said = typeof one === "string" ? one.trim() : "";
      if (!said) continue;
      const match = ownVideos.find((m) => m.id === said) ?? ownVideos.find((m) => plain(m.name) === plain(said)) ?? ownVideos.find((m) => plain(said).length >= 3 && plain(m.name).includes(plain(said)));
      if (match) found.push(match);
      else unknown.push(said);
    }
    const there = ownVideos.map((m) => ({ id: m.id, name: m.name, seconds: m.seconds }));
    if (found.length === 0) return { added: 0, error: ownVideos.length === 0 ? "the media library is empty: the streamer imports videos in « Ma chaîne » or from the passages of a video" : "no such imported video", unknown, there };
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    let next = compilation;
    let section = part.trim() ? next.sections.find((one) => same(one.title, part)) : next.sections[next.sections.length - 1];
    if (!section) {
      const made = addSection(next, part.trim().slice(0, 60));
      next = made.compilation;
      section = next.sections.find((one) => one.id === made.id)!;
    }
    const items = found.map(itemFromMedia);
    next = insertItems(next, section.id, items);
    change(next);
    ensure(items);
    light(items.map((item) => item.id));
    toast.success(t("media.added", { count: items.length }));
    return { added: items.length, videos: found.map((m) => m.name), part: section.title, passages: allItems(next).length, ...(unknown.length > 0 ? { unknown, there } : {}) };
  };

  const addPassages = (passages: AssistantPassage[], part = "") => {
    if (!jobId || !compilation) return { error: "no video open" };
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    let next = compilation;
    let section = part.trim() ? next.sections.find((one) => same(one.title, part)) : next.sections[next.sections.length - 1];
    if (!section) {
      const made = addSection(next, part.trim().slice(0, 60));
      next = made.compilation;
      section = next.sections.find((one) => one.id === made.id)!;
    }
    // A passage of another live: the video takes from that live too (a compilation only, a few lives at most)
    const lives = [...(next.lives ?? [])];
    const refused: string[] = [];
    const items: CompilationItem[] = [];
    for (const passage of Array.isArray(passages) ? passages : []) {
      if (!passage || !Number.isFinite(passage.start) || !Number.isFinite(passage.end) || passage.end <= passage.start) continue;
      const other = passage.job && passage.job !== jobId ? passage.job : undefined;
      if (other && !lives.includes(other)) {
        if (sourceOf(next) !== "compilation" || lives.length >= MAX_OTHER_LIVES || !liveInfo(other)) {
          refused.push(`${passage.start}: a passage of another live can't go into this video`);
          continue;
        }
        lives.push(other);
      }
      // (the same words a few seconds away: the video already has this moment, timed on its real words)
      if (saidAlready(next, { start: passage.start, text: passage.text, job: other })) {
        refused.push(`${passage.start}: already in the video`);
        continue;
      }
      const { job: _job, id: _id, vod_id: _vod, ...found } = passage;
      items.push(draftOf({ sources: ["ai"], before: "", after: "", chat: [], why: "", score: 0, ...found, ...(other ? { job: other } : {}) } as LiveHit));
    }
    if (lives.length !== (next.lives ?? []).length) next = { ...next, lives };
    const { compilation: filled, added } = addItems(next, section.id, items);
    if (added === 0) return { added: 0, error: items.length > 0 ? "already there" : "no passage to add", ...(refused.length > 0 ? { refused } : {}) };
    change(filled);
    setActiveSection(section.id);
    ensure(allItems(filled));
    const before = new Set(allItems(compilation).map((item) => item.id));
    light(allItems(filled).flatMap((item) => (before.has(item.id) ? [] : [item.id])));
    toast.success(t("compilation.addedCount", { count: added }));
    return { added, part: section.title, passages: allItems(filled).length, seconds: Math.round(compilationLength(filled)), ...(refused.length > 0 ? { refused } : {}) };
  };

  /** How the video on screen looks or sounds, changed as the assistant asks (what it names that the app has not is said back) */
  const setLook = (look: Record<string, string | null> | null | undefined) => {
    if (!compilation) return { error: "no video open" };
    const shown = (ids: readonly string[], key: (id: string) => string) => Object.fromEntries(ids.map((id) => [id, t(key(id))]));
    const choices = {
      templates,
      // (each track with what it is: the assistant chooses « something calmer » among them)
      musics: musics.map((track) => ({ id: track.id, name: track.name, about: [track.genre, ...track.kinds.map((kind) => t(`compilation.music.kind.${kind}`, { defaultValue: kind }))].filter(Boolean).join(" · ") })),
      jingle: kit?.intro,
      // What each thing is called on screen: the assistant names them as the streamer does
      names: {
        transitions: shown(TRANSITION_IDS, (id) => `compilation.transition.${id}`),
        intros: shown(JINGLE_IDS, (id) => `compilation.intro.style.${id}`),
        effects: shown(EFFECT_LEVELS, (id) => `compilation.effects.${id}`),
      },
    };
    const done = applyLook(compilation, look ?? {}, choices);
    if (Object.keys(done.set).length > 0) change(done.video);
    return { set: done.set, ...(Object.keys(done.unknown).length > 0 ? { unknown: done.unknown } : {}), look: lookOf(done.video, choices) };
  };

  // What the assistant calls after it waited (another video put on screen first): as this page is now
  const actions = useRef({ compilation, applyPlan, applyChange, aiCut, addPassages, addImported, setLook });
  actions.current = { compilation, applyPlan, applyChange, aiCut, addPassages, addImported, setLook };

  // Who waits for a video to be the one on screen
  const awaited = useRef<{ id: string; done: () => void }[]>([]);
  useEffect(() => {
    const id = compilation?.id;
    if (!id) return;
    const ready = awaited.current.filter((one) => one.id === id);
    awaited.current = awaited.current.filter((one) => one.id !== id);
    ready.forEach((one) => one.done());
  }, [compilation?.id]);
  /** A video of this live put on screen (`made`: it was just made, the list does not hold it yet) */
  const show = (id: string, made = false) =>
    new Promise<void>((resolve, reject) => {
      const known = compilationsRef.current?.find((c) => c.id === id);
      if (known && currentIdRef.current === id) return resolve();
      if (!known && !made) return reject(new Error("no such video in this live"));
      const timer = window.setTimeout(() => reject(new Error("the video did not open")), 10_000);
      awaited.current.push({
        id,
        done: () => {
          window.clearTimeout(timer);
          resolve();
        },
      });
      setCurrentId(id);
      setActiveSection(known?.sections[0]?.id ?? "");
      setShown(null);
      setResults([]);
    });
  /** A clip of the analysis on screen as its video (made the first time) */
  const showClip = async (filename: string) => {
    const known = compilationsRef.current?.find((c) => c.clip === filename);
    if (known) return show(known.id);
    const video = await openKeptClip(jobId!, filename);
    remember([video]);
    setCompilations((prev) => [...(prev ?? []).filter((c) => c.id !== video.id), video]);
    return show(video.id, true);
  };
  /** A video with nothing in it yet, on screen: the one that is, one left empty earlier, or a new one */
  const blank = async (kind: VideoSource) => {
    const empty = (c: Compilation) => allItems(c).length === 0 && !c.brief && !c.suggestion && !c.clip && sourceOf(c) === kind;
    const known = (compilation && empty(compilation) ? compilation : undefined) ?? compilationsRef.current?.find(empty);
    if (known) {
      await show(known.id);
      return known.id;
    }
    const video = await createCompilation(jobId!, { name: t(`videos.new.${kind}`), ...(kind !== "compilation" ? { source: kind, target: SOURCE_TARGET[kind], titles: kind !== "clip" } : {}) });
    setCompilations((prev) => [...(prev ?? []), video]);
    await show(video.id, true);
    return video.id;
  };

  /** What the assistant has this editor do on a video of the live: its answer is what the assistant is told */
  const assist: AssistantRun = async (name, args) => {
    try {
      if (name === "open") {
        if (typeof args.video === "string") await show(args.video);
        else if (typeof args.clip === "string") await showClip(args.clip);
        return { opened: "edit", video: currentIdRef.current };
      }
      if (name === "build_video") {
        const kind: VideoSource = isVideoSource(args.source) ? args.source : "compilation";
        const id = typeof args.idea === "string" ? args.idea : await blank(kind);
        if (typeof args.idea === "string") await show(id);
        const video = compilationsRef.current?.find((c) => c.id === id);
        const brief = String(args.brief || video?.brief || "").trim();
        if (!brief) return { error: "say what the video is" };
        const leads = Array.isArray(args.leads) && args.leads.length > 0 ? args.leads.filter((at: unknown) => typeof at === "number") : (video?.suggestion?.moments ?? []);
        return await describe(id, brief, Number(args.target) || video?.target || SOURCE_TARGET[kind], leads);
      }
      if (name === "cut_clip") {
        if (typeof args.video === "string") await show(args.video);
        else if (typeof args.clip === "string") await showClip(args.clip);
        return await actions.current.aiCut(Number(args.target) || null);
      }
      // The rest is about a video that exists
      if (typeof args.video !== "string") return { error: "no video named" };
      await show(args.video);
      if (name === "change_video") return await revise(String(args.request ?? ""));
      if (name === "add_passages") return actions.current.addPassages(args.passages, typeof args.part === "string" ? args.part : "");
      if (name === "add_media") return actions.current.addImported(args.media, typeof args.part === "string" ? args.part : "");
      if (name === "set_look") return actions.current.setLook(args.look);
      return { error: `the editor can't do this: ${name}` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "failed" };
    }
  };
  useAssistantActions(jobId && compilations && kit ? jobId : null, assist);
  // What « this video », « this passage » mean to the assistant
  const openPassage = shown && compilation && allItems(compilation).find((item) => item.id === shown.id);
  useAssistantPlace(
    jobId && job
      ? {
          page: "edit",
          job: jobId,
          title: splitVodTitle(job.custom_title || job.vod_title).title || undefined,
          ...(compilation ? { video: { id: compilation.id, name: compilation.name, source: sourceOf(compilation) } } : {}),
          ...(openPassage ? { passage: { id: openPassage.id, start: openPassage.start, end: openPassage.end, text: (openPassage.text ?? "").slice(0, 200) } } : {}),
          ...(compilation
            ? {
                facts: {
                  passages: allItems(compilation).length,
                  seconds: Math.round(compilationLength(compilation)),
                  music: !!compilation.music,
                  opening: !compilation.intro ? "none" : compilation.intro.style === "hook" ? "hook" : "intro",
                  waiting: isWaiting(compilation),
                  exported: exported.has(compilation.id),
                },
              }
            : {}),
        }
      : null,
  );

  // A video kept from the live's page is built behind the pages: seen here while it is, taken as it is once done
  const builds = useBuilds();
  const behind = jobId && compilation ? building(builds, jobId, compilation.id) : undefined;
  useEffect(
    () =>
      onBuildEnd((build) => {
        const built = build.video;
        if (build.job !== jobId || !built) return;
        setCompilations((prev) => prev?.map((c) => (c.id === built.id ? built : c)) ?? prev);
        remember([built]);
        if (build.state === "done") ensure(allItems(built));
        dropBuild(build.job, build.id);
      }),
    [ensure, jobId, remember],
  );

  // A video the AI proposed, opened to be built (?build=1): built once, as soon as the live is known
  useEffect(() => {
    if (!compilation || buildFor.current !== compilation.id || !info) return;
    buildFor.current = null;
    if (!isWaiting(compilation) || !compilation.brief || behind) return;
    describe(compilation.id, compilation.brief, compilation.target ?? 45, compilation.suggestion?.moments ?? []);
  }, [compilation?.id, info]); // eslint-disable-line react-hooks/exhaustive-deps

  // Space plays the whole video, C cuts it where it is, Ctrl / Cmd + Z takes the last cut back
  const keys = useRef({ cutHere, undo });
  keys.current = { cutHere, undo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.closest("input, textarea, select, [contenteditable=true], [role=dialog]") || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          keys.current.undo();
        }
        return;
      }
      // (a button that has the focus keeps its own Space)
      if (key === " " && !el.closest("button, a, video")) {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (key === "c") keys.current.cutHere();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * The whole video in the layer editor: its passages joined into one clip
   * (with their words and chat), dressed in the video's template, every layer
   * then free to move. The editor has one layout for the whole video: the
   * transitions and a passage's own template stay behind.
   */
  const openEditor = async () => {
    if (!jobId || !compilation || !kit || editing || exporting) return;
    setEditing(true);
    try {
      const items = allItems(compilation);
      const states = await ensure(items);
      if (items.some((item) => !covers(states[item.id], item))) throw new Error(t("compilation.failure.failed"));
      // Joined as it is saved
      await saveCompilation(jobId, compilation);
      const flat = await flattenCompilation(jobId, compilation.id);
      const key = `cuttie_editor_${jobId}_${flat.clip}`;
      let kept = false;
      try {
        kept = !!localStorage.getItem(key);
      } catch {
        // No storage: the editor starts from its own default
      }
      if (kept) toast.info(t("compilation.editorKept"));
      else {
        const env = await getEditEnvironment(jobId, flat.clip);
        const ctx = {
          ...clipTemplateContext({
            jobId,
            filename: flat.clip,
            env,
            kit,
            login: channel?.login ?? kit.twitch_login,
            avatarUrl: channel?.avatar_url ?? null,
            facecam: env.facecam,
            startAt: 0,
            endAt: flat.duration,
            hook: compilation.titles ? "" : compilation.hook.trim() || compilation.name,
          }),
          displayName: channel?.display_name ?? null,
          followers: channel?.followers ?? null,
          game: job?.vod_game ?? null,
        };
        const styled = isHookStyle(compilation.titleStyle) ? compilation.titleStyle : null;
        // Each part's title where its first passage starts in the clip
        const titles: ReturnType<typeof titleCard> = [];
        let index = 0;
        for (const section of compilation.sections) {
          const from = flat.starts[index];
          index += section.items.length;
          if (!compilation.titles || section.hidden || section.items.length === 0 || !section.title.trim() || from === undefined) continue;
          const length = (flat.starts[index] ?? flat.duration) - from;
          titles.push(...titleCard(ctx, hookOf(templateKey, ctx, customs, styled), section.title.trim(), from, Math.min(flat.duration, from + Math.min(TITLE_SECONDS, length * 0.7)), section.id));
        }
        try {
          localStorage.setItem(key, JSON.stringify([...buildAny(templateKey, ctx, customs, styled), ...titles]));
          localStorage.setItem(`cuttie_trim_${jobId}_${flat.clip}`, JSON.stringify({ start: 0, end: flat.duration }));
        } catch {
          // The editor will start from its own default layout
        }
      }
      navigate(`/${jobId}/edit?clip=${encodeURIComponent(flat.clip)}`);
    } catch (err) {
      toast.error(err instanceof LiveError ? t(`compilation.failure.${err.reason}`) : t("compilation.editorFailed"));
      setEditing(false);
    }
  };

  /* ── The moment on screen ───────────────────────────────── */

  const shownItem = (shown && compilation && allItems(compilation).find((i) => i.id === shown.id)) || shown;
  const shownPiece = shownItem ? pieces[shownItem.id] : undefined;
  const shownReady = shownItem && covers(shownPiece, shownItem) ? shownPiece : undefined;
  const inCompilation = !!shownItem && !!compilation && allItems(compilation).some((i) => i.id === shownItem.id);
  const wordsKey = shownReady ? pieceVersion(shownReady) : null;
  useEffect(() => {
    if (!jobId || !shownReady || !wordsKey || words[wordsKey]) return;
    let cancelled = false;
    getClipWords(shownReady.job, shownReady.file).then((list) => !cancelled && setWords((prev) => ({ ...prev, [wordsKey]: list })));
    return () => {
      cancelled = true;
    };
  }, [jobId, wordsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstReady = readyItems[0];
  useBackdrop(jobId && firstReady ? clipThumbUrl(pieces[firstReady.id].job, pieces[firstReady.id].file) : null);

  // A template drawn small on a picture of this video: what the looks and the template picker show of each one
  const sketchOn = useMemo(() => {
    const piece = firstReady ? pieces[firstReady.id] : undefined;
    const env = piece ? envs[pieceVersion(piece)] : undefined;
    if (!kit || !jobId || !compilation || !piece || !env) return null;
    const ctx = clipTemplateContext({ jobId: piece.job, filename: piece.file, env, kit, login: channel?.login ?? kit.twitch_login, avatarUrl: channel?.avatar_url ?? null, facecam: env.facecam, startAt: 0, endAt: 1, hook: compilation.hook.trim() || compilation.name });
    return { ctx: { ...ctx, words: [], displayName: channel?.display_name ?? null, followers: channel?.followers ?? null, game: job?.vod_game ?? null }, frame: clipThumbUrl(piece.job, piece.file) };
  }, [channel, compilation?.hook, compilation?.name, envs, firstReady, job?.vod_game, jobId, kit, pieces]); // eslint-disable-line react-hooks/exhaustive-deps
  // This live's webcam as the analysis placed it (or as it was set by hand), read from the first clip that is ready
  const camPiece = firstReady ? pieces[firstReady.id] : undefined;
  const camEnv = camPiece && camPiece.job === jobId ? envs[pieceVersion(camPiece)] : undefined;
  const saveLiveCam = async (facecam: FacecamRect | false | null, remember: boolean) => {
    if (!jobId) return;
    try {
      await setLiveFacecam(jobId, facecam, remember);
      // Every clip of the live takes the new framing
      envsRef.current = {};
      setEnvs({});
      setCamSheet(false);
      if (remember) await reloadKit();
      toast.success(t(remember ? "montage.cam.savedEverywhere" : "montage.cam.saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    }
  };

  const sketch = useCallback(
    (key: string | null, width: number) => {
      if (!sketchOn) return null;
      const known: TemplateKey = key && (isBuiltIn(key) || findCustom(key, customs)) ? key : defaultKey;
      return <TemplateSketch layers={buildAny(known, sketchOn.ctx, customs, isHookStyle(compilation?.titleStyle) ? compilation.titleStyle : null)} frameUrl={sketchOn.frame} width={width} sample={[]} />;
    },
    [compilation?.titleStyle, customs, defaultKey, sketchOn],
  );

  // What is kept from this live, by source: the row above the montage
  const liveMoments = useMemo(() => buildMoments(job?.hot_points ?? [], job?.selection ?? {}), [job]);
  const entries = useMemo(() => liveEntries(liveMoments, compilations ?? []), [liveMoments, compilations]);
  // (a kept clip counts once, opened as a video or not; the video on screen counts even while it is being built)
  const kept = Math.max(keptCount(entries), compilation ? 1 : 0);

  if (!jobId || !job || !compilations || !kit) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
      </div>
    );
  }
  // What the AI is building right now: behind the pages (an idea kept from the live's page), or here (asked of the assistant)
  const buildingNow = new Map<string, string>();
  for (const build of builds) {
    if (build.job !== jobId || build.state === "done" || build.state === "failed") continue;
    buildingNow.set(build.id, build.state === "cutting" ? t("live.buildCutting") : build.state === "waiting" ? t("live.buildWaiting") : stepText(t, build.step));
  }
  if (working) buildingNow.set(working.id, working.lines[working.lines.length - 1] ?? "");
  const rail = <VideoRail jobId={jobId} entries={entries} videos={compilations} current={compilation} onOpenVideo={openVideo} onOpenClip={openClip} onAdd={(kind) => startNew(kind)} opening={openingClip} exported={exported} building={buildingNow} />;
  // Nothing kept from this live yet: there is nothing to edit
  if (!compilation) {
    return (
      <div className="animate-fade-in">
        <LiveHeader job={job} step="edit" kept={0} />
        {rail}
        <section className="mt-8 glass rounded-[20px] p-7 max-w-[560px]">
          <h2 className="text-[17px] font-[600] text-white">{t("live.nothingKept")}</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{t("live.nothingKeptHint")}</p>
          <Link to={`/${jobId}`} className="btn btn-primary btn-sm mt-4">
            <ArrowLeft className="w-4 h-4" /> {t("project.step.choose")}
          </Link>
        </section>
      </div>
    );
  }

  const at = (seconds: number, job?: string) => `${Math.min(100, Math.max(0, (seconds / Math.max(lengthOf(job), 1)) * 100))}%`;
  const items = allItems(compilation);
  // The passage the cut tools are on (the one open to be cut, else the one the video is on), when it is an imported video
  const toolNow = items.find((item) => item.id === shownItem?.id) ?? items.find((item) => item.id === onItem);
  const importedTool = toolNow?.media ? toolNow : null;
  const liveTitle = (id: string) => splitVodTitle(liveInfo(id)?.title ?? (id === jobId ? job.custom_title || job.vod_title : null)).title || t("compilations.untitledLive");
  const liveDay = (id: string) => {
    const when = liveInfo(id) ? liveWhen(liveInfo(id)!) : null;
    return when ? plainDate(when, i18n.language) : "";
  };
  // Another live to take passages from: one already analysed, or one of the channel's that can be analysed from the picker
  const canAddLive = source === "compilation" && liveIds.length <= MAX_OTHER_LIVES && (library.some((live) => !liveIds.includes(live.job_id)) || (channel?.vods ?? []).some((vod) => !vod.recording && vod.job?.status !== "DONE"));
  const addLive = (id: string) => {
    setAddingLive(false);
    if (liveIds.includes(id) || liveIds.length > MAX_OTHER_LIVES) return;
    change({ ...compilation, lives: [...(compilation.lives ?? []), id] });
    toast.success(t("compilation.lives.added", { name: liveTitle(id) }));
  };
  const removeLive = (id: string) => {
    const left = (compilation.lives ?? []).filter((other) => other !== id);
    const { lives: _before, ...rest } = compilation;
    change({ ...rest, ...(left.length > 0 ? { lives: left } : {}) });
  };
  // The live's strip: where a compilation takes from (several lives, one more to add), and what a search by hand found
  const showLives = several || canAddLive || results.length > 0;
  // About what having the AI build a video costs (a little more for each live more it takes from: measured, 0.044 $ for two)
  const dollars = (cost: number) => `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cost)} $`;
  const planBase = info?.plan_cost ?? info?.ai_cost ?? null;
  const planCost = planBase == null ? null : planBase * (1 + 0.25 * (liveIds.length - 1)) < 0.01 ? `< ${dollars(0.01)}` : `≈ ${dollars(planBase * (1 + 0.25 * (liveIds.length - 1)))}`;
  // The same props for the two halves of the video's panel: its passages on the left, its look on the right
  const panel = {
    compilation,
    storyboards,
    home: jobId,
    source,
    liveNumbers: several ? Object.fromEntries(liveIds.map((id, n) => [id, n + 1])) : undefined,
    activeSection,
    selectedItem: shownItem?.id ?? null,
    playing: preview ? onItem : null,
    onEdit: openEditor,
    editing,
    brand,
    hook: hookMenu,
    musics,
    favourites: kit?.musics,
    cutting,
    templates,
    onActivate: setActiveSection,
    // A passage clicked: the whole video goes to it, and it opens underneath to be cut
    onSelect: (item: CompilationItem) => {
      setShown(item);
      ensure([item]);
      jumpTo(item.id);
    },
    onChange: change,
    onExport: exportNow,
    exporting,
    onDelete: () => setToDelete(true),
    onSearch: () => {
      setSearching(true);
      setImporting(false);
      setSide("passages");
    },
    onImport: () => {
      setImporting(true);
      setSearching(false);
      setSide("passages");
    },
    // Passages asked of the assistant: its panel opens on a field made for that (what to look for, where they go)
    onAskAi: () => assistant.compose({ kind: "passages", parts: compilation.sections.map((section) => section.title.trim()).filter(Boolean) }),
    templateName,
    looking,
    looksNote: looksNote?.id === compilation.id ? looksNote.note : "",
    sounding,
    soundNote: soundNote?.id === compilation.id ? soundNote.note : "",
    onSound: () => soundByAi(compilation),
    onLooks: () => chooseByAi(compilation),
    onSameLook: () => change(clearLooks(compilation)),
    fresh: fresh?.ids,
    freshAt: fresh?.at,
    gone,
    sketch,
    cam: camEnv
      ? {
          label: t(!camEnv.cam?.rect ? "montage.cam.none" : camEnv.cam.source === "live" ? "montage.cam.manual" : camEnv.cam.moved ? "montage.cam.moved" : camEnv.cam.source === "brand" ? "montage.cam.usual" : "montage.cam.found"),
          onOpen: () => setCamSheet(true),
        }
      : undefined,
  };

  return (
    <div className="animate-fade-in">
      <LiveHeader job={job} step="edit" kept={kept} />
      {rail}

      {failure === "live_gone" && (
        <p role="alert" className="mt-4 p-3.5 pl-4 rounded-[14px] max-w-[860px] bg-[rgba(245,177,76,0.10)] border border-[rgba(245,177,76,0.30)] text-[12.5px] leading-snug text-[#f7d9a8]">
          {t("compilation.failure.live_gone")}
        </p>
      )}

      {/* Each live it takes from: what the search found there, what the compilation takes */}
      {showLives && (
      <section className="mt-4 glass rounded-[16px] px-3 pt-2.5 pb-2">
        <div className="flex flex-col gap-2.5">
          {liveIds.map((live, n) => {
            const frames = storyboards[live];
            // (a video of the media library is in none of them)
            const theirs = items.filter((item) => !item.media && (item.job ?? jobId) === live);
            return (
              <div key={live}>
                {several && (
                  <div className="mb-1 flex items-center gap-2 text-[12px] text-ink-2 min-w-0">
                    <span className="live-dot flex-none">{n + 1}</span>
                    <span className="truncate font-[550] text-white">{liveTitle(live)}</span>
                    <span className="flex-none text-ink-3">{[liveDay(live), clock(lengthOf(live === jobId ? undefined : live))].filter(Boolean).join(" · ")}</span>
                    <span className="flex-none text-ink-3">· {t("compilation.inCompilation", { count: theirs.length })}</span>
                    {live !== jobId && (
                      <button
                        type="button"
                        onClick={() => removeLive(live)}
                        disabled={theirs.length > 0}
                        aria-label={t("compilation.lives.remove")}
                        title={theirs.length > 0 ? t("compilation.lives.removeBlocked") : t("compilation.lives.remove")}
                        className="ml-auto flex-none w-6 h-6 grid place-items-center rounded-[7px] text-ink-3 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <div className="relative h-10 rounded-[8px] overflow-hidden flex bg-white/[0.04]">
                  {frames && evenFrames(frames, STRIP_TILES).map((frame, k) => <div key={k} className="flex-1 h-full brightness-[0.5] saturate-[0.9]" style={tileStyle(frames, frame)} />)}
                  {results
                    .filter((hit) => (hit.job ?? jobId) === live)
                    .map((hit) => (
                      <span key={hitKey(hit)} aria-hidden className="absolute bottom-0 w-[3px] -ml-px h-3 rounded-t-full bg-white/80" style={{ left: at(hit.start, hit.job) }} />
                    ))}
                  {theirs.map((item) => (
                    <span key={item.id} aria-hidden className="absolute top-0 w-[3px] -ml-px h-full bg-accent shadow-[0_0_8px_var(--color-accent-glow)]" style={{ left: at(item.start, item.job) }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
          {!several && <span className="mono">0:00</span>}
          {results.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[3px] h-2.5 rounded-t-full bg-white/80" /> {t("compilation.found", { count: results.length })}
            </span>
          )}
          {items.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[3px] h-2.5 bg-accent" /> {t("compilation.inCompilation", { count: items.length })}
            </span>
          )}
          {/* One more live to take passages from: the AI then works on all of them at once */}
          {canAddLive && (
            <button type="button" onClick={() => setAddingLive(true)} title={t("compilation.lives.addHint")} className="ml-auto inline-flex items-center gap-1 text-ink-2 hover:text-white underline decoration-white/20 underline-offset-2">
              <Plus className="w-3 h-3" strokeWidth={2.6} /> {t("compilation.lives.add")}
            </button>
          )}
          {!several && <span className={`mono ${canAddLive ? "" : "ml-auto"}`}>{clock(liveDuration)}</span>}
        </div>
      </section>
      )}

      {/* The workshop: the video's passages, the video itself, its look (side by side when there is room, see .workshop) */}
      <div className="workshop-room mt-4">
      <section className="workshop" data-side={side}>
        {/* Not enough room for the three: the video stays, and one panel at a time beside it */}
        <div data-area="tabs" role="tablist" aria-label={t("compilation.title")} className="seg">
          {(["passages", "look"] as const).map((one) => (
            <button key={one} role="tab" aria-selected={side === one} onClick={() => setSide(one)}>
              {one === "passages" ? `${t("montage.side.passages")} · ${items.length}` : t("compilation.dress.label")}
            </button>
          ))}
        </div>
        {searching ? (
          // The live searched by hand, where the video's passages are: what is found plays underneath, and is added from here
          <div data-area="passages" className="max-h-[max(420px,calc(100dvh-400px))] overflow-y-auto rounded-[20px]">
            <SearchPanel
              jobId={jobId}
              storyboards={storyboards}
              lives={liveIds.map((id, n) => ({ job: id, label: several ? `${n + 1} · ${[liveDay(id), liveTitle(id)].filter(Boolean).join(" · ")}` : liveTitle(id) }))}
              info={info}
              previewed={null}
              isAdded={(hit) => !!itemFor(compilation, draftOf(hit))}
              onPreview={watch}
              onAdd={add}
              onResults={setResults}
              onClose={() => {
                setSearching(false);
                setResults([]);
              }}
            />
          </div>
        ) : importing ? (
          // The streamer's own videos, where the video's passages are: one is added in a click, a file dropped here goes straight in
          <div data-area="passages" className="max-h-[max(420px,calc(100dvh-400px))] overflow-y-auto rounded-[20px]">
            <div className="glass rounded-[20px] p-3 min-w-0">
              <MediaLibrary
                onAdd={addMedia}
                used={Object.fromEntries(ownVideos.map((one) => [one.id, items.filter((item) => item.media === one.id).length]))}
                onClose={() => setImporting(false)}
              />
            </div>
          </div>
        ) : (
          <div data-area="passages" className="[&>aside]:max-w-none">
            <CompilationPanel part="passages" {...panel} />
          </div>
        )}

        <div data-area="preview" className="flex flex-col items-center gap-3">
          {items.length > 0 ? (
            <>
              <div
                aria-label={t("compilation.wholeVideo")}
                className="relative max-w-full aspect-[9/16] rounded-[24px] overflow-hidden border border-white/[0.14] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)] bg-black"
                // (as tall as the window leaves it above the timeline, and never wider than its column)
                style={{ height: "min(clamp(340px, calc(100dvh - 430px), 604px), calc(100cqw * 16 / 9))" }}
              >
                {preview ? (
                  <Player
                    key={playerKey}
                    ref={playerRef}
                    component={MontageComposition}
                    inputProps={playerProps!}
                    compositionWidth={1080}
                    compositionHeight={1920}
                    fps={FPS}
                    durationInFrames={montageFrames(preview.montage.segments, FPS, preview.montage.intro)}
                    // Passages added, taken out or put in another order: it stays on the passage it was on
                    initialFrame={marks.find((mark) => mark.id === onItemRef.current)?.clear ?? 0}
                    controls
                    loop
                    clickToPlay
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center px-6 text-center">
                    <div className="flex flex-col items-center gap-2.5 text-[13px] text-ink-2">
                      <Loader2 className="w-5 h-5 spinner text-ink-3" />
                      {t("compilation.cuttingCount", { count: Math.max(1, items.length - readyItems.length) })}
                    </div>
                  </div>
                )}
              </div>
              {/* The AI is changing it: what it does, a line at a time */}
              {working?.id === compilation.id && (
                <p role="status" aria-live="polite" className="-mt-1 max-w-full flex items-center gap-2 text-[12px] text-ink-2">
                  <Loader2 className="flex-none w-3.5 h-3.5 spinner text-accent" />
                  <span className="truncate">{working.lines[working.lines.length - 1] ?? t("describe.changing")}</span>
                </p>
              )}
              {/* Nothing was searched: the same description had been answered before. One click has the AI plan anew */}
              {keptPlan?.id === compilation.id && !working && (
                <p className="-mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
                  {t("compilation.keptAnswer")}
                  <button type="button" onClick={() => describe(compilation.id, keptPlan.brief, keptPlan.target, keptPlan.leads, true)} className="text-ink-2 hover:text-white underline decoration-white/20 underline-offset-2">
                    {t("compilation.askAgain")}
                    {planCost && <span className="mono"> {planCost}</span>}
                  </button>
                </p>
              )}
              {preview && (
                <p className="-mt-1 text-[12px] text-ink-3">
                  {readyItems.length < items.length ? t("compilation.partial", { ready: readyItems.length, total: items.length }) : `${clock(compilationLength(compilation) + openingSeconds(compilation, trackOf(musics, compilation.music?.track)?.bpm))} · ${t("compilation.moments", { count: items.length })}`}
                </p>
              )}
            </>
          ) : (
            <DescribeVideo
              key={compilation.id}
              source={source}
              idea={compilation.suggestion && isWaiting(compilation) ? { pitch: compilation.suggestion.pitch, tags: compilation.suggestion.tags, score: compilation.suggestion.score, brief: compilation.brief ?? "", target: compilation.target ?? 45 } : null}
              cost={planCost}
              working={working?.id === compilation.id ? working.lines : behind ? [behind.state === "cutting" ? t("live.buildCutting") : behind.state === "waiting" ? t("live.buildWaiting") : stepText(t, behind.step)] : null}
              unreadable={!!info && !info.transcript}
              onBuild={(brief, target) => describe(compilation.id, brief, target, compilation.suggestion?.moments ?? [])}
              onSearch={() => {
                setSearching(true);
                setSide("passages");
              }}
            />
          )}
        </div>

        <div data-area="look" className="[&>aside]:max-w-none">
          <CompilationPanel part="look" {...panel} />
        </div>
      </section>
      </div>

      {preview && (
        <VideoTimeline
          compilation={compilation}
          marks={marks}
          fps={FPS}
          frames={montageFrames(preview.montage.segments, FPS, preview.montage.intro)}
          opening={playsIntro(preview.montage.intro) ? { frames: introHold(preview.montage.intro, FPS), hook: !!preview.montage.intro.hook } : null}
          pieces={pieces}
          player={playerRef}
          playerKey={playerKey}
          playing={videoPlaying}
          selected={inCompilation ? (shownItem?.id ?? null) : null}
          onSelect={(id) => {
            const item = items.find((one) => one.id === id);
            if (item) panel.onSelect(item);
          }}
          music={preview.montage.music ? { curve: preview.montage.music.curve, name: trackOf(musics, compilation.music?.track)?.name ?? "" } : null}
          fresh={fresh?.ids}
          waiting={items.length - readyItems.length}
          tools={
            <>
              {/* What cuts on its own first: the AI, on a clip (its parts worth keeping) or by asking it in the assistant */}
              {/* (and on a passage made of an imported video: the one open, else the one the video is on) */}
              {compilation.clip || importedTool ? (
                <AiCutButton
                  busy={aiCutting}
                  disabled={aiCutting || cutting.size > 0}
                  target={cutTarget}
                  onTarget={(next) => {
                    setCutTarget(next);
                    saveCutTarget(jobId, next);
                  }}
                  onCut={() => (importedTool ? aiCutPassage(importedTool) : aiCut())}
                />
              ) : (
                <button onClick={() => assistant.send(t("assistant.suggest.tighten"))} title={t("montage.tightenHint")} className="btn btn-glass btn-sm">
                  <Sparkles className="w-3.5 h-3.5 text-accent" /> {t("montage.tighten")}
                </button>
              )}
              <span aria-hidden className="w-px h-5 bg-white/[0.14] mx-0.5" />
              <button onClick={cutHere} title={t("montage.cutHereHint")} className="btn btn-glass btn-sm pr-2">
                <Scissors className="w-3.5 h-3.5" /> {t("project.cutHere")}
                <kbd className="bg-white/[0.08] border-white/10 text-ink-2">C</kbd>
              </button>
              <button onClick={dropSilences} title={t("montage.silencesHint")} className="btn btn-glass btn-sm">
                {t("project.tighten")}
              </button>
              <button onClick={() => extend("start")} aria-label={t("montage.extendBefore")} title={t("montage.extendBefore")} className="btn btn-glass btn-sm px-2.5">
                <ArrowLeftToLine className="w-3.5 h-3.5" /> 30 s
              </button>
              <button onClick={() => extend("end")} aria-label={t("montage.extendAfter")} title={t("montage.extendAfter")} className="btn btn-glass btn-sm px-2.5">
                30 s <ArrowRightToLine className="w-3.5 h-3.5" />
              </button>
              <button onClick={undo} disabled={!undoable[compilation.id]} aria-label={t("project.undo")} title={`${t("project.undo")} (Ctrl+Z)`} className="btn btn-ghost btn-icon w-8 h-8 text-ink-2 hover:text-white disabled:opacity-30">
                <Undo2 className="w-4 h-4" />
              </button>
            </>
          }
        />
      )}

      {/* The passage open to be cut (one of the video's, or a search result not added yet) */}
      {shownItem && (
        <section className="relative mt-4 glass-strong rounded-[20px] p-2.5">
          <PiecePreview
            jobId={shownItem.job ?? jobId}
            item={shownItem}
            piece={shownReady}
            cutting={cutting.has(shownItem.id)}
            words={wordsKey ? words[wordsKey] : undefined}
            media={shownItem.media ? { name: mediaOf(ownVideos, shownItem.media)?.name ?? shownItem.why, seconds: lastOf(shownItem) } : undefined}
            onChange={(start, end) => recut(shownItem, start, end)}
            // A passage of the compilation can be shown in a template of its own
            templates={inCompilation ? templates : undefined}
            template={shownItem.template ?? null}
            videoTemplate={templateName(templateKey)}
            onTemplate={(key) => change(updateItem(compilation, shownItem.id, { template: key }))}
            // One sound at a time: it does not start over the whole video, and stops when that one plays
            autoPlay={!videoPlaying}
            hush={hush}
            onPlay={() => playerRef.current?.pause()}
          />
          <div className="flex items-start gap-3 px-1.5 pt-3 pb-1">
            <p className="flex-1 min-w-0 text-[13px] leading-snug text-ink-2">
              {shownItem.text || shownItem.why}
              {shownItem.text && shownItem.why && <span className="block mt-1 text-[12px] text-accent">{shownItem.why}</span>}
            </p>
            {inCompilation ? (
              <button onClick={() => change(removeItem(compilation, shownItem.id))} className="btn btn-glass btn-sm flex-none">
                <Check className="w-3.5 h-3.5 text-accent" strokeWidth={2.6} /> {t("compilation.remove")}
              </button>
            ) : (
              <button
                onClick={() => {
                  const section = compilation.sections.find((s) => s.id === activeSection) ?? compilation.sections[compilation.sections.length - 1];
                  const { compilation: next, added } = addItems(compilation, section.id, [shownItem]);
                  if (added === 0) return toast.info(t("compilation.alreadyThere"));
                  change(next);
                  toast.success(t("compilation.addedCount", { count: 1 }));
                }}
                className="btn btn-primary btn-sm flex-none"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.4} /> {t("compilation.add")}
              </button>
            )}
          </div>
          <button
            onClick={() => setShown(null)}
            aria-label={t("compilation.closePiece")}
            title={t("compilation.closePiece")}
            className="absolute -top-2.5 -right-2.5 w-7 h-7 grid place-items-center rounded-full bg-[#1b1e1c] border border-white/[0.14] text-ink-2 hover:text-white shadow-[0_8px_20px_-6px_rgba(0,0,0,0.8)]"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.4} />
          </button>
        </section>
      )}

      {camSheet && camEnv && camPiece && (
        <CamSheet
          frameUrl={clipThumbUrl(camPiece.job, camPiece.file, { width: 1280 })}
          clipW={camEnv.clip_width}
          clipH={camEnv.clip_height}
          initial={camEnv.cam?.rect ?? null}
          manual={camEnv.cam?.source === "live"}
          onSave={saveLiveCam}
          onClose={() => setCamSheet(false)}
        />
      )}
      <ConfirmModal
        open={toDelete}
        title={t("compilation.deleteTitle")}
        message={t("compilation.deleteMessage")}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(false)}
      />
      {addingLive && (
        <LivePicker
          title={t("compilation.lives.pickTitle")}
          hint={t("compilation.lives.pickHint")}
          lives={library.filter((live) => !liveIds.includes(live.job_id))}
          coverOf={(live) => (live.cover_clip ? clipThumbUrl(live.job_id, live.cover_clip, { width: 480 }) : null)}
          onPick={([id]) => addLive(id)}
          onClose={() => setAddingLive(false)}
          onAnalysed={() => listAllCompilations().then(setLibrary).catch(() => {})}
        />
      )}
    </div>
  );
}
