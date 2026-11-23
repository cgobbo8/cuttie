import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { AssistantSlot, useAssistant } from "../lib/AssistantContext";
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
  getStoryboard,
  chooseSound,
  listAllCompilations,
  liveLoudness,
  listCompilations,
  listRenders,
  LiveError,
  openClipVideo,
  saveCompilation,
  startMontageRender,
  suggestClipCut,
  type Compilation,
  type CompilationItem,
  type EditEnvironment,
  type JobResponse,
  type LiveCompilations,
  type LiveFailure,
  type LiveHit,
  type LiveSearchInfo,
  type PieceState,
  type TranscriptWord,
  type TwitchStoryboard,
  type VideoPlan,
} from "../lib/api";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import {
  addItems,
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
  hookStart,
  itemFor,
  itemFromHit,
  looksCount,
  openingSeconds,
  PLAIN_CUT,
  removeItem,
  sectionStarts,
  transitionsOf,
  planCurrent,
  recutVideo,
  revisedSections,
  sectionsFromPlan,
  setVideoTransition,
  splitItem,
  tightened,
  updateItem,
  withHook,
} from "../lib/compilation";
import { liveWhen, plainDate } from "../lib/compilationLibrary";
import { clock, splitVodTitle } from "../lib/format";
import { buildMontage, framesOf, introHold, montageFrames, playsIntro, renderIntro, renderPieces, snapToWords, tighten, wordsIn, type MontageCut, type MontageProps, type MontageSegment, withEffects } from "../lib/montage";
import { readCutTarget, saveCutTarget, type CutTarget } from "../lib/cutTarget";
import { evenFrames, tileStyle } from "../lib/storyboard";
import { isTransition, transitionSpan } from "../lib/transitions";
import { introSpan, isIntro } from "../lib/intro/intros";
import { trackOf, useMusics } from "../lib/music/library";
import { introOf, montageIntro, montageMusic, playable, type SoundPiece } from "../lib/music/sound";
import { fontFamily } from "../lib/fonts";
import type { HookMenu, IntroBrand } from "../components/compilation/IntroPicker";
import { clipTemplateContext } from "../lib/templateContext";
import { templateGuides } from "../lib/templateGuide";
import { buildAny, customTemplates, defaultTemplateKey, findCustom, hookOf, isBuiltIn, type TemplateKey } from "../lib/templateKeys";
import { isHookStyle, titleCard } from "../lib/templateSpec";
import { isEffectLevel } from "../lib/effects";
import { SOURCE_TARGET, VIDEO_SOURCES, isVideoSource, sourceOf, type VideoSource } from "../lib/videoSources";
import { keptCount, liveEntries } from "../lib/liveEntries";
import { buildMoments } from "../lib/moments";
import { TEMPLATE_IDS } from "../lib/templates";
import MontageComposition from "../components/remotion-editor/MontageComposition";
import { isWaiting } from "../lib/suggestions";
import LiveHeader from "../components/live/LiveHeader";
import VideoRail from "../components/live/VideoRail";
import VideoTimeline from "../components/montage/VideoTimeline";
import AiCutButton from "../components/project/AiCutButton";
import LivePicker from "../components/compilation/LivePicker";
import CompilationPanel from "../components/compilation/CompilationPanel";
import PiecePreview from "../components/compilation/PiecePreview";
import SearchPanel from "../components/compilation/SearchPanel";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

const FPS = 30;
/** Clips cut from the live at once */
const CUT_BATCH = 4;
/** A section's title stays this long on screen, seconds (less in a short section) */
const TITLE_SECONDS = 2.2;
const SAVE_DELAY = 500;
/** How many changes of a video's passages can be taken back */
const UNDO_STEPS = 40;
const STRIP_TILES = 24;

const hitKey = (hit: LiveHit) => `${hit.job ?? ""}:${hit.start}-${hit.end}`;

/** A passage's clip, and the live it is in (a compilation may take passages from several) */
type Piece = PieceState & { job: string };
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

/** The item's clip is there and covers the moment as it is now */
function covers<P extends PieceState>(piece: P | undefined, item: CompilationItem): piece is P & { file_start: number; file_end: number } {
  return !!piece?.ready && piece.file_start != null && piece.file_end != null && piece.file_start <= item.start + 0.05 && piece.file_end >= item.end - 0.05;
}

const pieceVersion = (piece: PieceState) => `${piece.file}@${piece.file_start}-${piece.file_end}`;

/**
 * /:jobId/montage — the third step of a live: the montage of the videos kept from it, whatever
 * each is made from (a clip, a sequence, a compilation). One video at a time (?v=<id>), the
 * others a click away in the row above. Its passages on the left, the video in the middle, its
 * look on the right; searching the live and asking the AI happen in the assistant's panel.
 * Everything stays editable: order, cut of each passage, titles, template.
 */
export default function CompilationPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  // ?v=<id>: the video to open (none: the first one kept); ?clip=<file>: a kept clip, as its video; ?new=1&kind=…: a new one
  const [search, setSearch] = useSearchParams();
  const { kit, channel } = useChannel();
  const assistant = useAssistant();
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
  // The passages each change added, by "compilation:turn" (for this visit: lighting them again from the conversation)
  const addedBy = useRef(new Map<string, string[]>());
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
            const made = await openClipVideo(jobId, filename);
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
  // A video opened to be built by the AI, or a new one with nothing in it yet: the assistant's panel is where that happens
  const wantsHelp = !!compilation && (buildFor.current === compilation.id || (allItems(compilation).length === 0 && !compilation.clip));
  useEffect(() => {
    if (wantsHelp) assistant.setOpen(true);
  }, [wantsHelp, compilation?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
        for (const live of new Set(todo.map((item) => item.job ?? jobId))) {
          const theirs = todo.filter((item) => (item.job ?? jobId) === live);
          for (let i = 0; i < theirs.length; i += CUT_BATCH) batches.push({ live, batch: theirs.slice(i, i + CUT_BATCH) });
        }
        for (const { live, batch } of batches) {
          // A passage still on the transcript's rough times: its clip holds those lines whole, and tells where they are really said
          const asked = batch.map(({ id, start, end, fit, like }) => (fit ? { id, start: Math.min(start, fit[0]), end: Math.max(end, fit[1]), fit } : { id, start, end, ...(like ? { like } : {}) }));
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

  /** The AI changed the video as asked: what it kept stays as it was, what it added gets its clip */
  const applyChange = (plan: VideoPlan, ask: string) => {
    if (!compilation) return;
    const note = plan.note ?? "";
    // A lasting taste they stated in this request, that the AI noted for their next videos: written under its answer
    const noted = plan.remembered?.length ? { remembered: plan.remembered } : {};
    const revised = revisedSections(compilation, plan, lengthOf);
    // An answer with no video in it (it found nothing, or misread): the video stays, its answer is kept
    if (revised.sections.length === 0 || (revised.added === 0 && revised.removed === 0 && revised.recut.length === 0 && sameOrder(compilation, revised.sections))) {
      change({ ...compilation, asks: [...(compilation.asks ?? []), { ask, note, ...noted }] });
      toast.info(t("compilation.changeNothing"));
      return;
    }
    const turn = compilation.asks?.length ?? 0;
    const next = { ...compilation, sections: revised.sections, asks: [...(compilation.asks ?? []), { ask, note, added: revised.added, removed: revised.removed, recut: revised.recut.length, ...noted }] };
    // A change that speaks of the music or the intro: the AI chooses them again with it in mind
    if (/musi|músic|intro|jingle|sound|sonido|bande.son/i.test(ask)) pendingSound.current = { id: compilation.id, asked: ask };
    change(next);
    if (!next.sections.some((s) => s.id === activeSection)) setActiveSection(next.sections[0].id);
    // What changed shows in the video: the new passages come in lit, those taken out leave
    // A passage to cut again waits for where its new lines are said: what was found for its old ones is forgotten
    if (revised.recut.length > 0) setTight((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !revised.recut.includes(id))));
    const touched = [...revised.fresh, ...revised.recut];
    addedBy.current.set(`${compilation.id}:${turn}`, touched);
    light(touched);
    setGone(revised.gone);
    window.setTimeout(() => setGone([]), LEAVE_MS);
    ensure(allItems(next));
    toast.success(t("compilation.changeDone", { added: revised.added, removed: revised.removed, recut: revised.recut.length }));
  };

  /** Passages lit in the video for a moment */
  const light = (ids: string[]) => {
    setFresh({ ids: new Set(ids), at: Date.now() });
    window.clearTimeout(lightTimer.current);
    lightTimer.current = window.setTimeout(() => setFresh(null), LIT_MS);
  };
  /** The passages a past change added, lit again (those still in the video) */
  const reveal = (turn: number) => {
    if (!compilation) return;
    const ids = (addedBy.current.get(`${compilation.id}:${turn}`) ?? []).filter((id) => allItems(compilation).some((item) => item.id === id));
    if (ids.length > 0) light(ids);
    else toast.info(t("compilation.changeRevealGone"));
  };

  /** `again`: the same description asked again on purpose: the new plan takes the place of the video on screen */
  const applyPlan = async (plan: VideoPlan, target: number, brief: string, again = false) => {
    // The same description as before is answered from the disk: said, or the streamer wonders why nothing was searched
    if (plan.cached) toast.info(t("compilation.planCached"));
    if (!jobId || !compilation) return;
    const sections = sectionsFromPlan(plan, lengthOf);
    if (sections.length === 0) return;
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
      setActiveSection(planned.sections[0].id);
      setShown(null);
      // The description said how the video should look: the AI lays it out once the clips are there
      pendingLooks.current = plan.look?.trim() ? { id: planned.id, wish: plan.look.trim() } : null;
      // ...and chooses its music and its intro from what kind of video it is (the description may ask for some, or for none)
      pendingSound.current = { id: planned.id, asked: brief };
      // What the AI planned can run over: brought back to the length asked for once each passage has its real length
      setPendingFit({ id: planned.id, target });
      ensure(allItems(planned));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  };

  /** New bounds for the moment on screen (live seconds): saved when it is in the compilation, its clip cut again when needed */
  const recut = (item: CompilationItem, start: number, end: number) => {
    // The streamer's own cut: no longer waiting to be set on its words
    const { fit: _waiting, ...kept } = item;
    const moved = { ...kept, start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
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
      const made = await openClipVideo(jobId, filename);
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
    (
      source: Compilation,
      states: Record<string, Piece>,
      known: Record<string, EditEnvironment>,
      all: Compilation = source,
    ): { montage: MontageProps; files: string[]; jobs: (string | undefined)[]; ids: string[]; opener?: { file: string; job?: string } } | null => {
      if (!kit || !jobId) return null;
      const items = allItems(source);
      // How each passage comes in (`all`: the whole video, when only what is ready of it is built)
      const transitions = transitionsOf(all);
      const cuts: MontageCut[] = [];
      const files: string[] = [];
      // The live each clip is in, when it isn't this one
      const jobs: (string | undefined)[] = [];
      // Each passage in its own template when it has one, else the video's
      const keys = items.map((item) => (item.template && (isBuiltIn(item.template) || findCustom(item.template, customs)) ? item.template : templateKey));
      // How the video writes its titles, when it says so (else each template writes them its own way)
      const written = isHookStyle(all.titleStyle) ? all.titleStyle : null;
      for (const item of items) {
        const piece = states[item.id];
        const env = piece && known[pieceVersion(piece)];
        if (!covers(piece, item) || !env) return null;
        const ctx = clipTemplateContext({
          jobId: piece.job,
          filename: piece.file,
          env,
          kit,
          login: channel?.login ?? kit.twitch_login,
          avatarUrl: channel?.avatar_url ?? null,
          facecam: env.facecam,
          startAt: 0,
          endAt: 1,
          // With titles, each section's title is the hook of its part
          hook: source.titles ? "" : source.hook.trim() || source.name,
        });
        cuts.push({
          ctx: { ...ctx, displayName: channel?.display_name ?? null, followers: channel?.followers ?? null, game: job?.vod_game ?? null },
          start: item.start - piece.file_start,
          end: item.end - piece.file_start,
          transition: transitions[item.id],
        });
        files.push(piece.file);
        jobs.push(piece.job !== jobId ? piece.job : undefined);
      }
      if (cuts.length === 0) return null;
      // Where each part starts in the list of passages
      const firstOf = new Map<string, number>();
      let before = 0;
      for (const s of source.sections) {
        if (s.items.length > 0) firstOf.set(s.id, before);
        before += s.items.length;
      }
      const montage = buildMontage(
        cuts,
        (c, index) => buildAny(index >= 0 ? keys[index] : templateKey, c, customs, written),
        FPS,
        (total) =>
          source.titles
            ? sectionStarts(source)
                // (a part whose title is hidden keeps it in the list, not in the video)
                .filter((s) => s.title.trim() && !s.hidden)
                .flatMap((s) => {
                  // A part's title is written as the template of its first passage writes its hook, where it puts it
                  const index = firstOf.get(s.id) ?? 0;
                  const ctx = cuts[index].ctx;
                  return titleCard(ctx, hookOf(keys[index], ctx, customs, written), s.title.trim(), s.at, Math.min(total, s.at + Math.min(TITLE_SECONDS, s.length * 0.7)), s.id);
                })
            : [],
      );
      // What moves the picture on what is said (a zoom from one passage to the next, a punch on a line that lands), when the video asks for it
      montage.segments = withEffects(montage, cuts, isEffectLevel(all.effects) ? all.effects : null).segments;
      // A "hook" intro plays a moment of the video first: built like a piece, in that passage's own template, the
      // video's title written on it as the template writes its hook (where it puts it: never on the face)
      const moment = hookMoment(all);
      const hookAt = moment ? items.findIndex((item) => item.id === moment.item.id) : -1;
      let opener: { segment: MontageSegment; file: string; job?: string; sound: SoundPiece } | null = null;
      const hookPiece = moment ? states[moment.item.id] : undefined;
      if (moment && hookAt >= 0 && covers(hookPiece, moment.item)) {
        const piece = hookPiece;
        const { ctx, start: floor } = cuts[hookAt];
        const raw = moment.start - piece.file_start;
        // Cut out of a longer passage by the app: it starts on a word, not inside one
        const start = moment.auto && raw > floor + 0.05 ? hookStart(ctx.words, raw, floor) : raw;
        const end = moment.end - piece.file_start;
        const [segment] = buildMontage([{ ctx, start, end }], (c) => buildAny(keys[hookAt], c, customs, written), FPS).segments;
        const top = Math.max(0, ...segment.layers.map((p) => p.z)) + 1;
        // (there on the very first picture, the video's cover, and until the cut to the video: no entrance, no exit of its own)
        const cover = titleCard(ctx, hookOf(keys[hookAt], ctx, customs, written), all.intro?.title?.trim() || all.name, 0, segment.from + segment.duration + 1, "hook");
        opener = {
          segment: { ...segment, layers: [...segment.layers, ...cover.map((layer, i) => ({ layer, z: top + i }))] },
          file: piece.file,
          ...(piece.job !== jobId ? { job: piece.job } : {}),
          sound: { words: ctx.words, start, end, said: !!moment.item.text.trim() },
        };
      }
      // What the video opens with: a jingle (the channel's logo and colours, its title written as the video's titles are), or its hook
      const first = cuts[0].ctx;
      const intro = montageIntro(
        all.intro,
        {
          title: all.name,
          name: first.displayName ?? first.login ?? "",
          logo: first.avatarUrl,
          colors: first.colors,
          font: fontFamily(hookOf(templateKey, first, customs, written).font),
          follow: [t("compilation.intro.followLabel"), t("compilation.intro.followDone")],
        },
        opener?.segment,
        // On a music, a jingle lasts a few of its beats: the video starts on one
        trackOf(musics, all.music?.track)?.bpm,
      );
      if (intro) montage.intro = intro;
      // The music under the video: lower where people talk, more present where the game plays alone
      const track = trackOf(musics, all.music?.track);
      if (track && all.music) {
        // A clip that was never transcribed has no words: what is said in it counts as talk, not as silence
        const pieces = cuts.map((cut, i) => ({ words: cut.ctx.words, start: cut.start, end: cut.end, said: !!items[i].text.trim() }));
        montage.music = montageMusic(montage.segments, pieces, all.music, introOf(montage), intro?.hook && opener ? { seconds: intro.hook.duration, piece: opener.sound } : undefined, track);
      }
      return { montage, files, jobs, ids: items.map((item) => item.id), ...(intro?.hook && opener ? { opener: { file: opener.file, job: opener.job } } : {}) };
    },
    [channel, customs, job, jobId, kit, musics, t, templateKey],
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
      await startMontageRender(
        jobId,
        { key: `comp_${compilation.id}.mp4`, name: compilation.name, pieces: renderPieces(built.montage, built.files, built.jobs), overlays: built.montage.overlays, ...(built.montage.intro ? { intro: renderIntro(built.montage.intro, built.opener?.file, built.opener?.job) } : {}), ...(built.montage.music ? { music: built.montage.music } : {}) },
        { width: 1080, height: 1920, fps: FPS },
      );
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
    const next = extendItem(compilation, item.id, side, 30, lengthOf(item.job));
    if (next === compilation) return toast.info(t(side === "start" ? "project.extendEdgeStart" : "project.extendEdgeEnd"));
    change(next);
    const moved = allItems(next).find((one) => one.id === item.id)!;
    setShown((open) => (open?.id === item.id ? moved : open));
    ensure([moved]);
  };
  // The length the AI's cut of a clip aims for, kept for this live (null: left to the AI)
  const [cutTarget, setCutTarget] = useState<CutTarget>(() => (jobId ? readCutTarget(jobId) : null));
  const [aiCutting, setAiCutting] = useState(false);
  /** A clip's video is cut again by the AI: the parts worth keeping become its passages */
  const aiCut = async () => {
    if (!jobId || !compilation?.clip || aiCutting) return;
    const id = compilation.id;
    setAiCutting(true);
    try {
      const { parts, note, origin } = await suggestClipCut(jobId, compilation.clip, { target: cutTarget });
      const current = compilationsRef.current?.find((c) => c.id === id);
      if (!current || parts.length === 0 || origin == null) return toast.info(t("project.aiCutSame"));
      const next = recutVideo(current, parts.map(([a, b]) => [origin + a, origin + b] as [number, number]));
      change(next);
      setShown(null);
      ensure(allItems(next));
      toast.success(note || t("project.aiCutDone", { count: parts.length }));
    } catch (err) {
      const reason = err instanceof LiveError ? err.reason : "failed";
      toast.error(t(reason === "no_transcript" ? "project.tightenNoWords" : `compilation.failure.${reason}`));
    } finally {
      setAiCutting(false);
    }
  };

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
  const rail = <VideoRail jobId={jobId} entries={entries} videos={compilations} current={compilation} onOpenVideo={openVideo} onOpenClip={openClip} onAdd={(kind) => startNew(kind)} opening={openingClip} exported={exported} />;
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
            const theirs = items.filter((item) => (item.job ?? jobId) === live);
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

      {/* Searching the live and asking the AI: in the assistant's panel, beside the montage */}
      <AssistantSlot>
        <SearchPanel
          key={compilation.id}
          jobId={jobId}
          storyboards={storyboards}
          lives={liveIds.map((id, n) => ({ job: id, label: several ? `${n + 1} · ${[liveDay(id), liveTitle(id)].filter(Boolean).join(" · ")}` : liveTitle(id) }))}
          info={info}
          source={source}
          previewed={null}
          isAdded={(hit) => !!itemFor(compilation, draftOf(hit))}
          onPreview={watch}
          onAdd={add}
          onPlan={applyPlan}
          talk={compilation.brief ? { brief: compilation.brief, answer: compilation.answer, passages: allItems(compilation).length, asks: compilation.asks ?? [], byAi: !!compilation.suggestion || !!compilation.clip, ...(compilation.clip ? { wrote: t("videos.fromAnalysis") } : {}) } : null}
          proposal={
            compilation.suggestion && isWaiting(compilation)
              ? {
                  id: compilation.id,
                  pitch: compilation.suggestion.pitch,
                  tags: compilation.suggestion.tags,
                  score: compilation.suggestion.score,
                  leads: compilation.suggestion.moments,
                  target: compilation.target ?? 45,
                  auto: buildFor.current === compilation.id,
                }
              : null
          }
          current={() => planCurrent(compilation)}
          onChange={applyChange}
          onReveal={reveal}
          onResults={setResults}
        />
      </AssistantSlot>

      {/* The workshop: the video's passages, the video itself, its look */}
      <section className="mt-4 flex flex-wrap gap-[18px] items-start">
        <CompilationPanel part="passages" {...panel} />

        <div className="flex-[1_1_280px] min-w-[260px] lg:[@media(min-height:820px)]:sticky lg:[@media(min-height:820px)]:top-[84px] flex flex-col items-center gap-3">
          {items.length > 0 ? (
            <>
              <div
                aria-label={t("compilation.wholeVideo")}
                className="relative max-w-full aspect-[9/16] rounded-[24px] overflow-hidden border border-white/[0.14] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)] bg-black"
                // (as tall as the window leaves it above the timeline)
                style={{ height: "clamp(340px, calc(100dvh - 430px), 604px)" }}
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
              {preview && (
                <p className="-mt-1 text-[12px] text-ink-3">
                  {readyItems.length < items.length ? t("compilation.partial", { ready: readyItems.length, total: items.length }) : `${clock(compilationLength(compilation) + openingSeconds(compilation, trackOf(musics, compilation.music?.track)?.bpm))} · ${t("compilation.moments", { count: items.length })}`}
                </p>
              )}
            </>
          ) : (
            !shownItem && (
              <div className="glass rounded-[20px] p-6 w-full text-center">
                <p className="text-[14px] text-ink-2">{t("live.emptyVideo")}</p>
                <button onClick={() => assistant.setOpen(true)} className="btn btn-primary btn-sm mt-3">
                  {t("assistant.title")}
                </button>
              </div>
            )
          )}
        </div>

        <CompilationPanel part="look" {...panel} />
      </section>

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
              {compilation.clip ? (
                <AiCutButton
                  busy={aiCutting}
                  disabled={aiCutting || cutting.size > 0}
                  target={cutTarget}
                  onTarget={(next) => {
                    setCutTarget(next);
                    saveCutTarget(jobId, next);
                  }}
                  onCut={aiCut}
                />
              ) : (
                <button onClick={() => assistant.setOpen(true)} title={t("montage.tightenHint")} className="btn btn-glass btn-sm">
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
