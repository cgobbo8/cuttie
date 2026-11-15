import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Player, type PlayerRef } from "@remotion/player";
import { ArrowLeft, Check, CircleQuestionMark, Loader2, Plus, X } from "lucide-react";
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
  LiveError,
  saveCompilation,
  setGuideSeen,
  startMontageRender,
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
import { useSettings } from "../lib/SettingsContext";
import {
  addItems,
  allItems,
  applyTight,
  applyLooks,
  applySound,
  soundBrief,
  clearLooks,
  compilationLength,
  fitToTarget,
  itemFor,
  itemFromHit,
  looksCount,
  removeItem,
  sectionStarts,
  transitionsOf,
  planCurrent,
  revisedSections,
  sectionsFromPlan,
  tightened,
  updateItem,
} from "../lib/compilation";
import { liveWhen, plainDate } from "../lib/compilationLibrary";
import { clock, splitVodTitle } from "../lib/format";
import { buildMontage, framesOf, introHold, montageFrames, renderPieces, type MontageCut, type MontageProps } from "../lib/montage";
import { evenFrames, tileStyle } from "../lib/storyboard";
import { isTransition, transitionSpan } from "../lib/transitions";
import { introSeconds, introSound, isIntro } from "../lib/intro/intros";
import { trackOf, useMusics } from "../lib/music/library";
import { musicCurve, musicUrl, passageLevel, PROGRAM_LUFS, speechShare, trackGain } from "../lib/music/mix";
import { fontFamily } from "../lib/fonts";
import { introSoundUrl, type IntroBrand } from "../components/compilation/IntroPicker";
import { clipTemplateContext } from "../lib/templateContext";
import { templateGuides } from "../lib/templateGuide";
import { buildAny, customTemplates, defaultTemplateKey, findCustom, hookOf, isBuiltIn, type TemplateKey } from "../lib/templateKeys";
import { titleCard } from "../lib/templateSpec";
import { TEMPLATE_IDS } from "../lib/templates";
import MontageComposition from "../components/remotion-editor/MontageComposition";
import ModeSwitch from "../components/project/ModeSwitch";
import LivePicker from "../components/compilation/LivePicker";
import CompilationGuide from "../components/compilation/CompilationGuide";
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
 * /:jobId/compilation — a video made of pieces of the whole live: search it
 * (words said or written in the chat, or by asking the AI), pick moments into
 * sections, or describe the video and let the AI plan it. Everything stays
 * editable: order, cut of each moment, titles, template.
 */
export default function CompilationPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  // ?c=<id>: the compilation to open; ?new=1: a new one (from the library)
  const [search, setSearch] = useSearchParams();
  const { kit, channel } = useChannel();
  const { settings, refresh: refreshSettings } = useSettings();

  // The screen explains itself on the first visit; "how it works" shows it again
  const [guide, setGuide] = useState(false);
  const guideSeen = settings?.guides_seen?.includes("compilation");
  useEffect(() => {
    if (settings && !guideSeen) setGuide(true);
  }, [settings, guideSeen]);
  const closeGuide = useCallback(() => {
    setGuide(false);
    // Remembered with the app's settings: seen once, on this computer, for good
    if (!guideSeen) setGuideSeen("compilation").then(refreshSettings, () => {});
  }, [guideSeen, refreshSettings]);

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
  // How tall the open passage is: the whole video takes what is left of the window above it
  const [pieceHeight, setPieceHeight] = useState(0);
  const pieceBox = useRef<HTMLDivElement>(null);
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

  const loaded = useRef<{ job: string; all: Promise<Compilation[]> } | null>(null);
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
    getJobStatus(jobId)
      .then((j) => {
        if (cancelled) return;
        setJob(j);
        const vodId = j.url?.match(/videos\/(\d+)/)?.[1];
        if (vodId) getStoryboard(vodId).then((sb) => !cancelled && sb && setStoryboards((prev) => ({ ...prev, [jobId]: sb }))).catch(() => {});
      })
      .catch(() => !cancelled && navigate("/"));
    getLiveSearchInfo(jobId).then((i) => !cancelled && setInfo(i)).catch(() => {});
    listAllCompilations().then((lives) => !cancelled && setLibrary(lives)).catch(() => {});
    // ?lives=a,b: a new compilation that takes passages from these lives too (picked in the library)
    const wantsLives = (search.get("lives") ?? "").split(",").filter((id) => id && id !== jobId).slice(0, MAX_OTHER_LIVES);
    // Asked once per live, even when this runs twice (development): a new compilation is created once
    const wantsNew = search.get("new") === "1";
    if (loaded.current?.job !== jobId) {
      loaded.current = {
        job: jobId,
        // The first visit opens on an empty compilation
        all: listCompilations(jobId).then(async (list) => {
          // A new one is asked for: the empty one left from last time does, rather than piling them up
          const blank = list.find((c) => allItems(c).length === 0 && !c.brief);
          if (wantsNew && blank) {
            const same = (blank.lives ?? []).join() === wantsLives.join();
            const { lives: _before, ...rest } = blank;
            return [...list.filter((c) => c !== blank), same ? blank : await saveCompilation(jobId, { ...rest, ...(wantsLives.length > 0 ? { lives: wantsLives } : {}) })];
          }
          const draft = { name: t("compilation.defaultName"), ...(wantsNew && wantsLives.length > 0 ? { lives: wantsLives } : {}) };
          return list.length === 0 || wantsNew ? [...list, await createCompilation(jobId, draft)] : list;
        }),
      };
    }
    loaded.current.all
      .then((all) => {
        if (cancelled) return;
        const opened = (!wantsNew && all.find((c) => c.id === search.get("c"))) || all[all.length - 1];
        remember(all);
        setCompilations(all);
        setCurrentId(opened.id);
        setActiveSection(opened.sections[0]?.id ?? "");
      })
      .catch((err) => !cancelled && toast.error(err instanceof Error ? err.message : t("common.error")));
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
  // The address names the compilation on screen: a reload, or coming back from an export, opens it again
  useEffect(() => {
    if (currentId && (search.get("c") !== currentId || search.has("new"))) setSearch({ c: currentId }, { replace: true });
  }, [currentId, search, setSearch]);
  const compilationsRef = useRef(compilations);
  compilationsRef.current = compilations;
  const liveDuration = job?.vod_duration_seconds ?? 0;

  /* ── The lives it takes passages from ───────────────────── */

  // Its own first, then the others: the order the AI numbers them in
  const liveIds = useMemo(() => (jobId ? [jobId, ...(compilation?.lives ?? [])] : []), [jobId, compilation?.lives]);
  const several = liveIds.length > 1;
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
  const change = useCallback(
    (next: Compilation) => {
      if (!jobId) return;
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
          const asked = batch.map(({ id, start, end, fit }) => (fit ? { id, start: Math.min(start, fit[0]), end: Math.max(end, fit[1]), fit } : { id, start, end }));
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
    const revised = revisedSections(compilation, plan, lengthOf);
    // An answer with no video in it (it found nothing, or misread): the video stays, its answer is kept
    if (revised.sections.length === 0 || (revised.added === 0 && revised.removed === 0 && revised.recut.length === 0 && sameOrder(compilation, revised.sections))) {
      change({ ...compilation, asks: [...(compilation.asks ?? []), { ask, note }] });
      toast.info(t("compilation.changeNothing"));
      return;
    }
    const turn = compilation.asks?.length ?? 0;
    const next = { ...compilation, sections: revised.sections, asks: [...(compilation.asks ?? []), { ask, note, added: revised.added, removed: revised.removed, recut: revised.recut.length }] };
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

  const applyPlan = async (plan: VideoPlan, target: number, brief: string) => {
    // The same description as before is answered from the disk: said, or the streamer wonders why nothing was searched
    if (plan.cached) toast.info(t("compilation.planCached"));
    if (!jobId || !compilation) return;
    const sections = sectionsFromPlan(plan, lengthOf);
    if (sections.length === 0) return;
    try {
      let planned: Compilation;
      if (allItems(compilation).length === 0) {
        // The compilation on screen is empty: the plan fills it
        planned = { ...compilation, name: plan.title || compilation.name, sections, target, titles: sections.length > 1 || compilation.titles, brief, answer: plan.note ?? "", asks: [] };
        change(planned);
      } else {
        // Another video from the same lives
        const draft = { name: plan.title || t("compilation.defaultName"), target, titles: true, ...(compilation.lives?.length ? { lives: compilation.lives } : {}) };
        planned = { ...(await createCompilation(jobId, draft)), sections, brief, answer: plan.note ?? "", asks: [] };
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

  const startNew = async () => {
    if (!jobId) return;
    try {
      const created = await createCompilation(jobId, { name: t("compilation.defaultName") });
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
      // Back to the live's compilations
      navigate(`/${jobId}/compilations`);
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
    (source: Compilation, states: Record<string, Piece>, known: Record<string, EditEnvironment>, all: Compilation = source): { montage: MontageProps; files: string[]; jobs: (string | undefined)[]; ids: string[] } | null => {
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
        (c, index) => buildAny(index >= 0 ? keys[index] : templateKey, c, customs),
        FPS,
        (total) =>
          source.titles
            ? sectionStarts(source)
                .filter((s) => s.title.trim())
                .flatMap((s) => {
                  // A part's title is written as the template of its first passage writes its hook, where it puts it
                  const index = firstOf.get(s.id) ?? 0;
                  const ctx = cuts[index].ctx;
                  return titleCard(ctx, hookOf(keys[index], ctx, customs), s.title.trim(), s.at, Math.min(total, s.at + Math.min(TITLE_SECONDS, s.length * 0.7)), s.id);
                })
            : [],
      );
      // The jingle the video opens with: the channel's logo and colours, its title written as the video's titles are
      if (isIntro(all.intro?.style)) {
        const first = cuts[0].ctx;
        const sound = introSound(all.intro);
        montage.intro = {
          style: all.intro.style,
          title: all.intro.title?.trim() || all.name,
          name: first.displayName ?? first.login ?? "",
          logo: first.avatarUrl,
          colors: first.colors,
          font: fontFamily(hookOf(templateKey, first, customs).font),
          ...(sound ? { sound } : {}),
        };
      }
      // The music under the video: lower where people talk, more present where the game plays alone
      const track = trackOf(musics, all.music?.track);
      if (track) {
        const levels = cuts.map((cut, i) => {
          // A clip that was never transcribed has no words: what is said in it counts as talk, not as silence
          const untold = cut.ctx.words.length === 0 && !!items[i].text.trim();
          return passageLevel(speechShare(cut.ctx.words, cut.start, cut.end), untold);
        });
        montage.music = {
          track: track.id,
          curve: musicCurve(montage.segments.map((segment, i) => ({ seconds: segment.duration, level: levels[i] })), montage.intro ? introSeconds(all.intro) : 0, all.music?.volume ?? 1),
        };
      }
      return { montage, files, jobs, ids: items.map((item) => item.id) };
    },
    [channel, customs, job, jobId, kit, musics, templateKey],
  );

  // What the intro picker draws its sketches with
  const brand = useMemo<IntroBrand | undefined>(
    () =>
      kit
        ? {
            name: channel?.display_name ?? channel?.login ?? kit.twitch_login ?? "",
            logo: channel?.avatar_url ?? null,
            colors: kit.colors,
            font: fontFamily(hookOf(templateKey, { facecam: null, subtitleStyle: kit.subtitles.style } as Parameters<typeof hookOf>[1], customs).font),
          }
        : undefined,
    [channel, customs, kit, templateKey],
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
        const choice = await chooseSound(jobId, { ...soundBrief(source), asked, language: i18n.language.slice(0, 2) });
        // What the streamer changed while the AI was thinking stays
        const current = compilationsRef.current?.find((c) => c.id === source.id) ?? source;
        // A track whose file isn't on this machine can't be played: left out
        const next = applySound(current, { music: trackOf(musics, choice.music) ? choice.music : null, intro: choice.intro });
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

  // Where each passage plays in the whole video, frames; `clear`: its first frame once the transition it comes in with is over
  const marks = useMemo(() => {
    // The first passage starts once the intro has held the screen
    let at = introHold(preview?.montage.intro, FPS);
    return (preview?.montage.segments ?? []).map((segment, i) => {
      const from = at;
      at += framesOf(segment.duration, FPS);
      const coming = isTransition(segment.transition) ? transitionSpan(segment.transition, FPS).after : 0;
      return { id: preview!.ids[i], from, to: at, clear: Math.min(at - 1, from + coming) };
    });
  }, [preview]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  // In the page the intro's sound and the music are files the player plays (the export mixes them in afterwards)
  const playerProps = useMemo(() => {
    const montage = preview?.montage;
    if (!montage) return montage;
    const track = trackOf(musics, montage.music?.track);
    // The export levels the clips' sound before adding the music; here they play as they are: the music comes down by as much
    const trim = liveLufs === null ? 0.3 : Math.min(1, 10 ** ((liveLufs - PROGRAM_LUFS) / 20));
    return {
      ...montage,
      ...(montage.intro?.sound ? { intro: { ...montage.intro, sound: introSoundUrl(montage.intro.sound), ...(liveLufs === null ? {} : { gain: trim }) } } : {}),
      ...(montage.music && track ? { music: { ...montage.music, src: musicUrl(track.id), from: track.start, gain: trackGain(track) * trim } } : {}),
    };
  }, [liveLufs, musics, preview]);
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

  // The open passage's height, as it is drawn
  useEffect(() => {
    const box = pieceBox.current;
    if (!box || typeof ResizeObserver === "undefined") return setPieceHeight(0);
    const watch = new ResizeObserver(() => setPieceHeight(box.offsetHeight));
    watch.observe(box);
    setPieceHeight(box.offsetHeight);
    return () => watch.disconnect();
  }, [shown?.id]);

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
        { key: `comp_${compilation.id}.mp4`, name: compilation.name, pieces: renderPieces(built.montage, built.files, built.jobs), overlays: built.montage.overlays, ...(built.montage.intro ? { intro: built.montage.intro } : {}), ...(built.montage.music ? { music: built.montage.music } : {}) },
        { width: 1080, height: 1920, fps: FPS },
      );
      navigate(`/${jobId}/export`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("montage.exportFailed"));
      setExporting(false);
    }
  };

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
        // Each part's title where its first passage starts in the clip
        const titles: ReturnType<typeof titleCard> = [];
        let index = 0;
        for (const section of compilation.sections) {
          const from = flat.starts[index];
          index += section.items.length;
          if (!compilation.titles || section.items.length === 0 || !section.title.trim() || from === undefined) continue;
          const length = (flat.starts[index] ?? flat.duration) - from;
          titles.push(...titleCard(ctx, hookOf(templateKey, ctx, customs), section.title.trim(), from, Math.min(flat.duration, from + Math.min(TITLE_SECONDS, length * 0.7)), section.id));
        }
        try {
          localStorage.setItem(key, JSON.stringify([...buildAny(templateKey, ctx, customs), ...titles]));
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

  if (!jobId || !job || !compilations || !compilation || !kit) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
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
  const canAddLive = liveIds.length <= MAX_OTHER_LIVES && (library.some((live) => !liveIds.includes(live.job_id)) || (channel?.vods ?? []).some((vod) => !vod.recording && vod.job?.status !== "DONE"));
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

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <Link to={`/${jobId}/compilations`} className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
            <ArrowLeft className="w-4 h-4" /> {t("compilations.title")}
          </Link>
          <h1 className="mt-2 text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white truncate">{compilation.name || t("compilation.title")}</h1>
          <p className="mt-2 text-[13.5px] text-ink-2 max-w-[62ch]">{t("compilation.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setGuide(true)} className="btn btn-ghost btn-sm">
            <CircleQuestionMark className="w-[15px] h-[15px]" /> {t("compilation.guide.open")}
          </button>
          <button onClick={startNew} className="btn btn-glass btn-sm">
            <Plus className="w-[15px] h-[15px]" /> {t("compilation.new")}
          </button>
          <ModeSwitch jobId={jobId} current="compilations" />
        </div>
      </header>

      {failure === "live_gone" && (
        <p role="alert" className="mt-4 p-3.5 pl-4 rounded-[14px] max-w-[860px] bg-[rgba(245,177,76,0.10)] border border-[rgba(245,177,76,0.30)] text-[12.5px] leading-snug text-[#f7d9a8]">
          {t("compilation.failure.live_gone")}
        </p>
      )}

      {/* Each live it takes from: what the search found there, what the compilation takes */}
      <section className="mt-5 glass rounded-[16px] px-3 pt-2.5 pb-2">
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

      {/* While a conversation with the AI is open, it and the preview stay in view beside the list */}
      <section className="group/row mt-[18px] flex flex-wrap gap-[18px] items-start">
        <SearchPanel
          jobId={jobId}
          storyboards={storyboards}
          lives={liveIds.map((id, n) => ({ job: id, label: several ? `${n + 1} · ${[liveDay(id), liveTitle(id)].filter(Boolean).join(" · ")}` : liveTitle(id) }))}
          info={info}
          previewed={null}
          isAdded={(hit) => !!itemFor(compilation, draftOf(hit))}
          onPreview={watch}
          onAdd={add}
          onPlan={applyPlan}
          talk={compilation.brief ? { brief: compilation.brief, answer: compilation.answer, passages: allItems(compilation).length, asks: compilation.asks ?? [] } : null}
          current={() => planCurrent(compilation)}
          onChange={applyChange}
          onReveal={reveal}
          onResults={setResults}
        />

        {/* Stage: the whole video in its template, and under it the passage open to be cut */}
        <div className="flex-[1_1_380px] lg:[@media(min-height:820px)]:sticky lg:[@media(min-height:820px)]:top-[84px] min-w-0 flex flex-col items-center gap-3">
          {items.length > 0 && (
            <>
              <div
                aria-label={t("compilation.wholeVideo")}
                className="relative max-w-full aspect-[9/16] rounded-[24px] overflow-hidden border border-white/[0.14] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)] bg-black transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                // As tall as the window leaves it above the open passage, never tiny
                style={{ height: shownItem ? `clamp(300px, calc(100dvh - ${pieceHeight + 152}px), 604px)` : "clamp(360px, calc(100dvh - 150px), 604px)" }}
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
                  {readyItems.length < items.length ? t("compilation.partial", { ready: readyItems.length, total: items.length }) : `${clock(compilationLength(compilation) + introSeconds(compilation.intro))} · ${t("compilation.moments", { count: items.length })}`}
                </p>
              )}
            </>
          )}

          {shownItem ? (
            <div ref={pieceBox} className="relative glass-strong rounded-[20px] p-2.5 w-full">
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
              {/* Closed, the whole video gets its full height back */}
              {items.length > 0 && (
                <button
                  onClick={() => setShown(null)}
                  aria-label={t("compilation.closePiece")}
                  title={t("compilation.closePiece")}
                  className="absolute -top-2.5 -right-2.5 w-7 h-7 grid place-items-center rounded-full bg-[#1b1e1c] border border-white/[0.14] text-ink-2 hover:text-white shadow-[0_8px_20px_-6px_rgba(0,0,0,0.8)]"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={2.4} />
                </button>
              )}
            </div>
          ) : (
            items.length === 0 && (
              <div className="glass rounded-[20px] p-6 w-full text-center">
                <p className="text-[14px] text-ink-2">{t("compilation.pieceEmpty")}</p>
              </div>
            )
          )}
        </div>

        <CompilationPanel
          compilation={compilation}
          storyboards={storyboards}
          home={jobId}
          liveNumbers={several ? Object.fromEntries(liveIds.map((id, n) => [id, n + 1])) : undefined}
          activeSection={activeSection}
          selectedItem={shownItem?.id ?? null}
          playing={preview ? onItem : null}
          onEdit={openEditor}
          editing={editing}
          brand={brand}
          musics={musics}
          favourites={kit?.musics}
          cutting={cutting}
          templates={templates}
          onActivate={setActiveSection}
          // A passage clicked: the whole video goes to it, and it opens underneath to be cut
          onSelect={(item) => {
            setShown(item);
            ensure([item]);
            jumpTo(item.id);
          }}
          onChange={change}
          onExport={exportNow}
          exporting={exporting}
          onDelete={() => setToDelete(true)}
          templateName={templateName}
          looking={looking}
          looksNote={looksNote?.id === compilation.id ? looksNote.note : ""}
          sounding={sounding}
          soundNote={soundNote?.id === compilation.id ? soundNote.note : ""}
          onSound={() => soundByAi(compilation)}
          onLooks={() => chooseByAi(compilation)}
          onSameLook={() => change(clearLooks(compilation))}
          fresh={fresh?.ids}
          freshAt={fresh?.at}
          gone={gone}
        />
      </section>

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
      <CompilationGuide open={guide} onClose={closeGuide} />
    </div>
  );
}
