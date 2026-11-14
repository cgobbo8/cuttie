import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Player } from "@remotion/player";
import { ArrowLeft, Check, CircleQuestionMark, Loader2, Plus } from "lucide-react";
import {
  chooseLooks,
  clipThumbUrl,
  createCompilation,
  deleteCompilation,
  ensurePieces,
  getClipWords,
  getEditEnvironment,
  getJobStatus,
  getLiveSearchInfo,
  getStoryboard,
  listCompilations,
  LiveError,
  saveCompilation,
  setGuideSeen,
  startMontageRender,
  type Compilation,
  type CompilationItem,
  type EditEnvironment,
  type JobResponse,
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
  clearLooks,
  compilationLength,
  fitToTarget,
  itemFor,
  itemFromHit,
  looksCount,
  removeItem,
  sectionStarts,
  planCurrent,
  revisedSections,
  sectionsFromPlan,
  tightened,
  updateItem,
} from "../lib/compilation";
import { clock } from "../lib/format";
import { buildMontage, montageFrames, renderPieces, type MontageCut, type MontageProps } from "../lib/montage";
import { evenFrames, tileStyle } from "../lib/storyboard";
import { clipTemplateContext } from "../lib/templateContext";
import { templateGuides } from "../lib/templateGuide";
import { buildAny, customTemplates, defaultTemplateKey, findCustom, hookOf, isBuiltIn, type TemplateKey } from "../lib/templateKeys";
import { titleCard } from "../lib/templateSpec";
import { TEMPLATE_IDS } from "../lib/templates";
import MontageComposition from "../components/remotion-editor/MontageComposition";
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

const hitKey = (hit: LiveHit) => `${hit.start}-${hit.end}`;

/** How long a passage the AI added stays lit, and one it took out takes to leave (as the stylesheet animates them) */
const LIT_MS = 3600;
const LEAVE_MS = 1100;

/** The same passages in the same parts, in the same order */
const sameOrder = (c: Pick<Compilation, "sections">, sections: Compilation["sections"]) =>
  JSON.stringify(c.sections.filter((s) => s.items.length > 0).map((s) => s.items.map((i) => i.id))) === JSON.stringify(sections.map((s) => s.items.map((i) => i.id)));

/** How far over the length asked a described video may run before passages are taken out of it */
const PLAN_OVER = 1.1;

/** The item's clip is there and covers the moment as it is now */
function covers(piece: PieceState | undefined, item: CompilationItem): piece is PieceState & { file_start: number; file_end: number } {
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
  const [storyboard, setStoryboard] = useState<TwitchStoryboard | null>(null);
  const [compilations, setCompilations] = useState<Compilation[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("");
  // Each moment's clip, by item id
  const [pieces, setPieces] = useState<Record<string, PieceState>>({});
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const [cutting, setCutting] = useState<Set<string>>(new Set());
  // The moment shown in "Passage": an item of the compilation, or a search result not added yet
  const [shown, setShown] = useState<CompilationItem | null>(null);
  const [view, setView] = useState<"piece" | "video">("piece");
  const [results, setResults] = useState<LiveHit[]>([]);
  const [envs, setEnvs] = useState<Record<string, EditEnvironment>>({});
  const envsRef = useRef(envs);
  envsRef.current = envs;
  const [words, setWords] = useState<Record<string, TranscriptWord[]>>({});
  const [exporting, setExporting] = useState(false);
  // The AI looking at the passages to choose their templates, and what it said of its choice (by compilation)
  const [looking, setLooking] = useState(false);
  const [looksNote, setLooksNote] = useState<{ id: string; note: string } | null>(null);
  // A described video asked for a look: chosen once its clips are cut
  const pendingLooks = useRef<{ id: string; wish: string } | null>(null);
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

  const remember = useCallback((list: Compilation[]) => {
    const states: Record<string, PieceState> = {};
    for (const item of list.flatMap(allItems)) {
      if (item.file) states[item.id] = { ready: !!item.ready, file: item.file, file_start: item.file_start ?? null, file_end: item.file_end ?? null };
    }
    setPieces((prev) => ({ ...prev, ...states }));
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    getJobStatus(jobId)
      .then((j) => {
        if (cancelled) return;
        setJob(j);
        const vodId = j.url?.match(/videos\/(\d+)/)?.[1];
        if (vodId) getStoryboard(vodId).then((sb) => !cancelled && setStoryboard(sb)).catch(() => {});
      })
      .catch(() => !cancelled && navigate("/"));
    getLiveSearchInfo(jobId).then((i) => !cancelled && setInfo(i)).catch(() => {});
    listCompilations(jobId)
      .then(async (list) => {
        // The first visit opens on an empty compilation
        const all = list.length > 0 ? list : [await createCompilation(jobId, { name: t("compilation.defaultName") })];
        if (cancelled) return;
        remember(all);
        setCompilations(all);
        setCurrentId(all[all.length - 1].id);
        setActiveSection(all[all.length - 1].sections[0]?.id ?? "");
      })
      .catch((err) => !cancelled && toast.error(err instanceof Error ? err.message : t("common.error")));
    return () => {
      cancelled = true;
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const compilation = compilations?.find((c) => c.id === currentId) ?? null;
  const compilationsRef = useRef(compilations);
  compilationsRef.current = compilations;
  const liveDuration = job?.vod_duration_seconds ?? 0;

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
    async (items: CompilationItem[]): Promise<Record<string, PieceState>> => {
      if (!jobId) return piecesRef.current;
      // Those without a clip, and those whose words are still to be found in theirs
      const todo = items.filter((item) => item.fit || !covers(piecesRef.current[item.id], item));
      if (todo.length === 0) return piecesRef.current;
      setCutting((prev) => new Set([...prev, ...todo.map((i) => i.id)]));
      let known = piecesRef.current;
      try {
        for (let i = 0; i < todo.length; i += CUT_BATCH) {
          const batch = todo.slice(i, i + CUT_BATCH);
          // A passage still on the transcript's rough times: its clip holds those lines whole, and tells where they are really said
          const asked = batch.map(({ id, start, end, fit }) => (fit ? { id, start: Math.min(start, fit[0]), end: Math.max(end, fit[1]), fit } : { id, start, end }));
          const done = await ensurePieces(jobId, asked);
          const states = Object.fromEntries(done.pieces.map(({ id, tight: _found, ...state }) => [id, state]));
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
    async (piece: PieceState): Promise<EditEnvironment> => {
      const key = pieceVersion(piece);
      const known = envsRef.current[key];
      if (known) return known;
      const env = await getEditEnvironment(jobId!, piece.file);
      envsRef.current = { ...envsRef.current, [key]: env };
      setEnvs((prev) => ({ ...prev, [key]: env }));
      return env;
    },
    [jobId],
  );

  /* ── Search results and the compilation ─────────────────── */

  const draftOf = useCallback(
    (hit: LiveHit): CompilationItem => {
      const key = hitKey(hit);
      const known = drafts.current.get(key);
      if (known) return known;
      const item = itemFromHit(hit, liveDuration);
      drafts.current.set(key, item);
      return item;
    },
    [liveDuration],
  );

  const watch = (hit: LiveHit) => {
    const item = (compilation && itemFor(compilation, hit)) || draftOf(hit);
    setShown(item);
    setView("piece");
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
    const revised = revisedSections(compilation, plan, liveDuration);
    // An answer with no video in it (it found nothing, or misread): the video stays, its answer is kept
    if (revised.sections.length === 0 || (revised.added === 0 && revised.removed === 0 && sameOrder(compilation, revised.sections))) {
      change({ ...compilation, asks: [...(compilation.asks ?? []), { ask, note }] });
      toast.info(t("compilation.changeNothing"));
      return;
    }
    const turn = compilation.asks?.length ?? 0;
    const next = { ...compilation, sections: revised.sections, asks: [...(compilation.asks ?? []), { ask, note, added: revised.added, removed: revised.removed }] };
    change(next);
    if (!next.sections.some((s) => s.id === activeSection)) setActiveSection(next.sections[0].id);
    // What changed shows in the video: the new passages come in lit, those taken out leave
    addedBy.current.set(`${compilation.id}:${turn}`, revised.fresh);
    light(revised.fresh);
    setGone(revised.gone);
    window.setTimeout(() => setGone([]), LEAVE_MS);
    ensure(allItems(next));
    toast.success(t("compilation.changeDone", { added: revised.added, removed: revised.removed }));
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
    if (!jobId || !compilation) return;
    const sections = sectionsFromPlan(plan, liveDuration);
    if (sections.length === 0) return;
    try {
      let planned: Compilation;
      if (allItems(compilation).length === 0) {
        // The compilation on screen is empty: the plan fills it
        planned = { ...compilation, name: plan.title || compilation.name, sections, target, titles: sections.length > 1 || compilation.titles, brief, asks: [] };
        change(planned);
      } else {
        planned = { ...(await createCompilation(jobId, { name: plan.title || t("compilation.defaultName"), target, titles: true })), sections, brief, asks: [] };
        setCompilations((prev) => [...(prev ?? []), planned]);
        setCurrentId(planned.id);
        change(planned);
      }
      setActiveSection(planned.sections[0].id);
      setView("video");
      // The description said how the video should look: the AI lays it out once the clips are there
      pendingLooks.current = plan.look?.trim() ? { id: planned.id, wish: plan.look.trim() } : null;
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
      const rest = compilations.filter((c) => c.id !== compilation.id);
      const list = rest.length > 0 ? rest : [await createCompilation(jobId, { name: t("compilation.defaultName") })];
      setCompilations(list);
      setCurrentId(list[list.length - 1].id);
      setActiveSection(list[list.length - 1].sections[0]?.id ?? "");
      setShown(null);
      toast.success(t("compilation.deleted"));
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
    (source: Compilation, states: Record<string, PieceState>, known: Record<string, EditEnvironment>): { montage: MontageProps; files: string[] } | null => {
      if (!kit || !jobId) return null;
      const items = allItems(source);
      const cuts: MontageCut[] = [];
      const files: string[] = [];
      // Each passage in its own template when it has one, else the video's
      const keys = items.map((item) => (item.template && (isBuiltIn(item.template) || findCustom(item.template, customs)) ? item.template : templateKey));
      for (const item of items) {
        const piece = states[item.id];
        const env = piece && known[pieceVersion(piece)];
        if (!covers(piece, item) || !env) return null;
        const ctx = clipTemplateContext({
          jobId,
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
        });
        files.push(piece.file);
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
      return { montage, files };
    },
    [channel, customs, job, jobId, kit, templateKey],
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
          items: items.map(({ id, start, end, text }) => ({ id, start, end, text })),
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

  // The data of each clip (size, cam, words, chat) for the preview
  const readyItems = useMemo(() => (compilation ? allItems(compilation).filter((item) => covers(pieces[item.id], item)) : []), [compilation, pieces]);
  useEffect(() => {
    if (view !== "video") return;
    for (const item of readyItems) loadEnv(pieces[item.id]).catch(() => {});
  }, [view, readyItems, pieces, loadEnv]);

  const preview = useMemo(() => {
    if (!compilation || view !== "video") return null;
    // What is ready plays already: the rest joins as its clips arrive
    const ready = { ...compilation, sections: compilation.sections.map((s) => ({ ...s, items: s.items.filter((item) => covers(pieces[item.id], item) && envs[pieceVersion(pieces[item.id])]) })) };
    return build(ready, pieces, envs);
  }, [build, compilation, envs, pieces, view]);

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
        { key: `comp_${compilation.id}.mp4`, name: compilation.name, pieces: renderPieces(built.montage, built.files), overlays: built.montage.overlays },
        { width: 1080, height: 1920, fps: FPS },
      );
      navigate(`/${jobId}/export`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("montage.exportFailed"));
      setExporting(false);
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
    getClipWords(jobId, shownReady.file).then((list) => !cancelled && setWords((prev) => ({ ...prev, [wordsKey]: list })));
    return () => {
      cancelled = true;
    };
  }, [jobId, wordsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstReady = readyItems[0];
  useBackdrop(jobId && firstReady ? clipThumbUrl(jobId, pieces[firstReady.id].file) : null);

  if (!jobId || !job || !compilations || !compilation || !kit) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
      </div>
    );
  }

  const at = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / Math.max(liveDuration, 1)) * 100))}%`;
  const items = allItems(compilation);

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <Link to={`/${jobId}`} className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
            <ArrowLeft className="w-4 h-4" /> {t("project.step.choose")}
          </Link>
          <h1 className="mt-2 text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white">{t("compilation.title")}</h1>
          <p className="mt-2 text-[13.5px] text-ink-2 max-w-[62ch]">{t("compilation.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {compilations.length > 1 &&
            compilations.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setCurrentId(c.id);
                  setActiveSection(c.sections[0]?.id ?? "");
                  setShown(null);
                }}
                aria-pressed={c.id === compilation.id}
                className={`chip h-8 px-3 ${c.id === compilation.id ? "chip-accent" : "chip-neutral hover:text-white"}`}
              >
                {c.name}
              </button>
            ))}
          <button onClick={() => setGuide(true)} className="btn btn-ghost btn-sm">
            <CircleQuestionMark className="w-[15px] h-[15px]" /> {t("compilation.guide.open")}
          </button>
          <button onClick={startNew} className="btn btn-glass btn-sm">
            <Plus className="w-[15px] h-[15px]" /> {t("compilation.new")}
          </button>
        </div>
      </header>

      {failure === "live_gone" && (
        <p role="alert" className="mt-4 p-3.5 pl-4 rounded-[14px] max-w-[860px] bg-[rgba(245,177,76,0.10)] border border-[rgba(245,177,76,0.30)] text-[12.5px] leading-snug text-[#f7d9a8]">
          {t("compilation.failure.live_gone")}
        </p>
      )}

      {/* The whole live: what the search found, what the compilation takes */}
      <section className="mt-5 glass rounded-[16px] px-3 pt-2.5 pb-2">
        <div className="relative h-10 rounded-[8px] overflow-hidden flex bg-white/[0.04]">
          {storyboard && evenFrames(storyboard, STRIP_TILES).map((frame, k) => <div key={k} className="flex-1 h-full brightness-[0.5] saturate-[0.9]" style={tileStyle(storyboard, frame)} />)}
          {results.map((hit) => (
            <span key={hitKey(hit)} aria-hidden className="absolute bottom-0 w-[3px] -ml-px h-3 rounded-t-full bg-white/80" style={{ left: at(hit.start) }} />
          ))}
          {items.map((item) => (
            <span key={item.id} aria-hidden className="absolute top-0 w-[3px] -ml-px h-full bg-accent shadow-[0_0_8px_var(--color-accent-glow)]" style={{ left: at(item.start) }} />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
          <span className="mono">0:00</span>
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
          <span className="mono ml-auto">{clock(liveDuration)}</span>
        </div>
      </section>

      {/* While a conversation with the AI is open, the preview and the list give it room */}
      <section className="group/row mt-[18px] flex flex-wrap gap-[18px] items-start">
        <SearchPanel
          jobId={jobId}
          storyboard={storyboard}
          info={info}
          previewed={null}
          isAdded={(hit) => !!itemFor(compilation, draftOf(hit))}
          onPreview={watch}
          onAdd={add}
          onPlan={applyPlan}
          talk={compilation.brief ? { brief: compilation.brief, asks: compilation.asks ?? [] } : null}
          current={() => planCurrent(compilation)}
          onChange={applyChange}
          onReveal={reveal}
          onResults={setResults}
        />

        {/* Stage: one moment as it is, or the whole video in its template */}
        <div className="flex-[1_1_380px] group-has-[.talk-thread]/row:flex-[0_1_320px] min-w-0 flex flex-col items-center gap-3">
          <div role="tablist" className="seg w-full">
            {(["piece", "video"] as const).map((key) => (
              <button key={key} role="tab" aria-selected={view === key} onClick={() => setView(key)}>
                {t(`compilation.view.${key}`)}
              </button>
            ))}
          </div>

          {view === "piece" ? (
            shownItem ? (
              <div className="glass-strong rounded-[20px] p-2.5 w-full">
                <PiecePreview
                  jobId={jobId}
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
              </div>
            ) : (
              <div className="glass rounded-[20px] p-6 w-full text-center">
                <p className="text-[14px] text-ink-2">{t("compilation.pieceEmpty")}</p>
              </div>
            )
          ) : (
            <div className="relative w-[340px] max-w-full aspect-[9/16] rounded-[24px] overflow-hidden border border-white/[0.14] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)] bg-black">
              {preview ? (
                <Player
                  key={`${compilation.id}-${templateKey}-${preview.files.join(",")}`}
                  component={MontageComposition}
                  inputProps={preview.montage}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={FPS}
                  durationInFrames={montageFrames(preview.montage.segments, FPS)}
                  controls
                  loop
                  clickToPlay
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center px-8 text-center">
                  {items.length === 0 ? (
                    <p className="text-[13.5px] leading-snug text-ink-2">{t("compilation.videoEmpty")}</p>
                  ) : (
                    <div className="flex flex-col items-center gap-2.5 text-[13px] text-ink-2">
                      <Loader2 className="w-5 h-5 spinner text-ink-3" />
                      {t("compilation.cuttingCount", { count: Math.max(1, items.length - readyItems.length) })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {view === "video" && preview && (
            <p className="text-[12px] text-ink-3">
              {readyItems.length < items.length ? t("compilation.partial", { ready: readyItems.length, total: items.length }) : `${clock(compilationLength(compilation))} · ${t("compilation.moments", { count: items.length })}`}
            </p>
          )}
        </div>

        <CompilationPanel
          compilation={compilation}
          storyboard={storyboard}
          activeSection={activeSection}
          selectedItem={view === "piece" ? (shownItem?.id ?? null) : null}
          cutting={cutting}
          templates={templates}
          onActivate={setActiveSection}
          onSelect={(item) => {
            setShown(item);
            setView("piece");
            ensure([item]);
          }}
          onChange={change}
          onExport={exportNow}
          exporting={exporting}
          onDelete={() => setToDelete(true)}
          templateName={templateName}
          looking={looking}
          looksNote={looksNote?.id === compilation.id ? looksNote.note : ""}
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
      <CompilationGuide open={guide} onClose={closeGuide} />
    </div>
  );
}
