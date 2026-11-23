import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Blend, Check, ScanFace, ChevronRight, Clapperboard, Eye, EyeOff, FolderInput, Layers, Loader2, Music2, Palette, Pause, Play, Plus, Search, Sparkles, Trash2, Type, X, Zap, LayoutTemplate, type LucideIcon } from "lucide-react";
import type { Compilation, CompilationItem, CompilationSection, TwitchStoryboard } from "../../lib/api";
import {
  PLAIN_CUT,
  addSection,
  allItems,
  compilationLength,
  fitToTarget,
  itemsBetween,
  openingSeconds,
  liveClock,
  moveItem,
  moveItems,
  moveSection,
  ownTransitions,
  placeItems,
  removeItem,
  removeItems,
  removeSection,
  sectionLength,
  setTransition,
  setVideoTransition,
  showTitle,
} from "../../lib/compilation";
import { clock } from "../../lib/format";
import { frameAt, tileStyle } from "../../lib/storyboard";
import { useToast } from "../Toast";
import { hookLook, isIntro } from "../../lib/intro/intros";
import { trackOf } from "../../lib/music/library";
import type { MusicTrack } from "../../lib/music/mix";
import IntroPicker, { type HookMenu, type IntroBrand } from "./IntroPicker";
import MusicPicker, { useListen } from "./MusicPicker";
import { dressAs, UNIVERSES, universeOf } from "../../lib/universes";
import { HOOK_STYLES, isHookStyle, type HookStyle } from "../../lib/templateSpec";
import { EFFECT_LEVELS, isEffectLevel } from "../../lib/effects";
import type { VideoSource } from "../../lib/videoSources";
import TransitionPicker from "./TransitionPicker";

interface Props {
  /**
   * What of the video this panel shows: its passages (name, parts, passages, length), or its look
   * (how it is dressed, and its export). Nothing said: both, one under the other.
   */
  part?: "passages" | "look";
  compilation: Compilation;
  /** Each live's preview frames, by job id; `home`: the live the compilation is kept with */
  storyboards: Record<string, TwitchStoryboard>;
  home: string;
  /** What the video is made from: a clip is one moment (no parts, no part titles: one title written on it) */
  source?: VideoSource;
  /** Made from several lives: each one's number, by job id (a passage then shows which it is from) */
  liveNumbers?: Record<string, number>;
  /** The section search results are added to */
  activeSection: string;
  /** The item shown in the preview */
  selectedItem: string | null;
  /** Items whose clip is being cut from the live */
  cutting: Set<string>;
  /** Templates to pick from, the channel's default first */
  templates: { key: string; name: string }[];
  onActivate: (sectionId: string) => void;
  onSelect: (item: CompilationItem) => void;
  onChange: (next: Compilation) => void;
  onExport: () => void;
  exporting: boolean;
  onDelete: () => void;
  /** Passages looked for in the live by hand (the passages give their place to the search) */
  onSearch?: () => void;
  /** A template's name, by key */
  templateName: (key: string) => string;
  /** The AI is looking at the passages to choose their templates */
  looking: boolean;
  /** What the AI said of the templates it chose */
  looksNote: string;
  onLooks: () => void;
  /** Every passage back to the video's template */
  onSameLook: () => void;
  /** Passages the AI just put in the video: they come in lit (`freshAt` changes each time, to light them again) */
  fresh?: Set<string>;
  freshAt?: number;
  /** Passages it just took out, and where each one was: shown leaving */
  gone?: { item: CompilationItem; section: string; index: number }[];
  /** The passage the whole video is on (the one playing, or the one it is stopped on) */
  playing?: string | null;
  /** The whole video opened in the layer editor, as one clip (`editing`: it is being made) */
  onEdit?: () => void;
  editing?: boolean;
  /** What an intro is drawn with (the channel's logo and colours); without it the video's intro can't be chosen here */
  brand?: IntroBrand;
  /** What a "hook" intro can open the video on (the passages, the one it plays): chosen and trimmed in the intro picker */
  hook?: HookMenu;
  /** The background musics that can be played on this machine (none: the video's music can't be chosen here) */
  musics?: MusicTrack[];
  /** The streamer's favourite music for each kind of video, by kind */
  favourites?: Record<string, string>;
  /** The AI is choosing the video's music and intro; what it said of its choice; asking it */
  sounding?: boolean;
  soundNote?: string;
  onSound?: () => void;
  /** The live's webcam: where it is said to be (in words), and its framing opened to be set by hand */
  cam?: { label: string; onOpen: () => void };
  /** A template drawn small on a picture of the video (null: the channel's own), `width` pixels wide: for the looks and the template picker */
  sketch?: (key: string | null, width: number) => ReactNode;
}

/** Where passages being dragged would land: in a part, before one of its passages (null: at its end) */
interface Drop {
  section: string;
  before: string | null;
}

/** How far the pointer goes before a press on a passage becomes a drag, pixels */
const DRAG_FROM = 6;

/**
 * Passages dragged to another place, or another part, with the pointer. A press
 * that does not move stays a click. `idsFor`: what a drag started on a passage
 * carries (all the picked ones when it is one of them).
 */
function usePassageDrag(root: RefObject<HTMLElement | null>, idsFor: (id: string) => string[], onDrop: (ids: string[], drop: Drop) => void) {
  const [drag, setDrag] = useState<{ ids: string[]; x: number; y: number; drop: Drop | null } | null>(null);
  // A drag just ended: the click that follows it is not one
  const justDragged = useRef(false);
  const start = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag]")) return;
    const from = { x: e.clientX, y: e.clientY };
    let ids: string[] | null = null;
    let drop: Drop | null = null;
    const where = (x: number, y: number): Drop | null => {
      const under = document.elementFromPoint(x, y);
      const section = under?.closest<HTMLElement>("[data-section]");
      if (!section || !root.current?.contains(section)) return null;
      const rows = [...section.querySelectorAll<HTMLElement>("[data-item]")];
      const row = under?.closest<HTMLElement>("[data-item]");
      // On the part itself: before its first passage when above it, at its end otherwise
      if (!row) return { section: section.dataset.section!, before: rows[0] && y < rows[0].getBoundingClientRect().top ? rows[0].dataset.item! : null };
      const box = row.getBoundingClientRect();
      const after = y >= box.top + box.height / 2;
      return { section: section.dataset.section!, before: (after ? rows[rows.indexOf(row) + 1] : row)?.dataset.item ?? null };
    };
    const move = (ev: PointerEvent) => {
      if (!ids) {
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_FROM) return;
        ids = idsFor(id);
        // Dragging across the page selects no text on the way
        document.body.classList.add("dragging-passages");
        window.getSelection()?.removeAllRanges();
      }
      // Near the top or the bottom of the window, the page follows
      if (ev.clientY < 110) window.scrollBy(0, -16);
      else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 16);
      drop = where(ev.clientX, ev.clientY);
      setDrag({ ids, x: ev.clientX, y: ev.clientY, drop });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!ids) return;
      document.body.classList.remove("dragging-passages");
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      setDrag(null);
      if (drop) onDrop(ids, drop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  return { drag, start, justDragged };
}

const TARGETS = [30, 60, 90, 180];
/** What the AI looking at one passage costs, dollars (three frames and what is said) */
const LOOK_COST = 0.0005;

type Leaving = { leaving: true; item: CompilationItem };

/** A part's passages, with those the AI just took out of it back where they were (they are shown leaving) */
function withGone(section: CompilationSection, gone: Props["gone"]): (CompilationItem | Leaving)[] {
  const rows: (CompilationItem | Leaving)[] = [...section.items];
  for (const g of [...(gone ?? [])].filter((x) => x.section === section.id).sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(g.index, rows.length), 0, { leaving: true, item: g.item });
  }
  return rows;
}

/** The compilation being built: its sections, their moments in playing order, its length and look */
export default function CompilationPanel({
  part,
  compilation,
  storyboards,
  home,
  source = "compilation",
  liveNumbers,
  activeSection,
  selectedItem,
  cutting,
  templates,
  onActivate,
  onSelect,
  onChange,
  onExport,
  exporting,
  onDelete,
  onSearch,
  templateName,
  looking,
  looksNote,
  onLooks,
  onSameLook,
  fresh,
  freshAt,
  gone,
  playing,
  onEdit,
  editing = false,
  brand,
  hook,
  musics = [],
  favourites,
  sounding = false,
  soundNote = "",
  onSound,
  sketch,
  cam,
}: Props) {
  const { playing: heard, toggle: listen } = useListen();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const list = useRef<HTMLElement>(null);

  /* ── Several passages picked: moved, put in another part, taken out together ── */

  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The passage last ticked: Shift + click picks all from it to the one clicked
  const anchor = useRef<string | null>(null);
  const ids = allItems(compilation).map((item) => item.id);
  const order = ids.join(",");
  // A passage that left the video is no longer picked
  useEffect(() => {
    setPicked((prev) => ([...prev].every((id) => ids.includes(id)) ? prev : new Set([...prev].filter((id) => ids.includes(id)))));
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickedIds = ids.filter((id) => picked.has(id));
  const toggle = (id: string, range = false) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (range && anchor.current && anchor.current !== id) for (const between of itemsBetween(compilation, anchor.current, id)) next.add(between);
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  };
  useEffect(() => {
    if (picked.size === 0) return;
    const escape = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest?.("input, textarea, [role=dialog]") && setPicked(new Set());
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [picked.size]);

  // What is open: the list of parts to move the picked passages to, or the transitions (of the video, of the picked ones, of one passage)
  const [menu, setMenu] = useState<"move" | "video" | "picked" | "intro" | "music" | "template" | "universe" | "titles" | "effects" | { item: string } | null>(null);
  const partName = (section: CompilationSection, among = compilation.sections) => section.title.trim() || t("compilation.partN", { n: among.indexOf(section) + 1 });
  const moveTo = (sectionId: string | null) => {
    setMenu(null);
    let next = compilation;
    let target = sectionId;
    if (!target) {
      const made = addSection(compilation);
      next = made.compilation;
      target = made.id;
    }
    const moved = placeItems(next, pickedIds, target);
    if (moved === compilation) return;
    onChange(moved);
    onActivate(target);
    toast.success(t("compilation.movedTo", { count: pickedIds.length, name: partName(moved.sections.find((s) => s.id === target)!, moved.sections) }));
  };
  const transitionName = (key: string | null | undefined) => t(`compilation.transition.${key || PLAIN_CUT}`);
  const firstId = ids[0];

  const { drag, start: startDrag, justDragged } = usePassageDrag(
    list,
    (id) => (picked.has(id) ? pickedIds : [id]),
    (moving, drop) => {
      const moved = placeItems(compilation, moving, drop.section, drop.before);
      if (moved !== compilation) onChange(moved);
    },
  );
  // Where each passage was drawn last, to slide it to its new place when the video changes
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const now = new Map<string, number>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-item]")) {
      const id = el.dataset.item!;
      const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
      now.set(id, top);
      const before = tops.current.get(id);
      if (!still && before !== undefined && Math.abs(before - top) > 2 && !fresh?.has(id)) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      }
    }
    tops.current = now;
  });
  // What the AI just added comes into view
  useEffect(() => {
    const first = fresh && fresh.size > 0 ? list.current?.querySelector<HTMLElement>("[data-fresh]") : null;
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [fresh, freshAt]);
  const ownLooks = allItems(compilation).filter((item) => item.template).length;
  // The track the video plays, when it is one that can be played here
  const track = trackOf(musics, compilation.music?.track);
  // The look of a game the video is dressed in (none: the channel's own)
  const universe = universeOf(compilation.universe);
  // A clip: one moment, so no parts and no part titles
  const single = source === "clip";
  const titleStyle = isHookStyle(compilation.titleStyle) ? compilation.titleStyle : null;
  const effects = isEffectLevel(compilation.effects) ? compilation.effects : null;
  // The intro is part of the video: it counts in its length
  const opening = openingSeconds(compilation, trackOf(musics, compilation.music?.track)?.bpm);
  const total = compilationLength(compilation) + opening;
  const count = allItems(compilation).length;
  // About half a tenth of a cent per passage looked at (measured): said before asking
  const dollars = (cost: number) => `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cost)} $`;
  // The AI choosing how the video looks and sounds: each passage's template (it looks at them), then the music and the intro
  const canSound = !!onSound && (musics.length > 0 || !!brand);
  const choosing = looking || sounding;
  const dressCost = count * LOOK_COST + 0.01 <= 0.02 ? `< ${dollars(0.02)}` : `≈ ${dollars(count * LOOK_COST + 0.01)}`;
  const dress = () => {
    if (canSound) onSound!();
    onLooks();
  };
  const aiNote = [soundNote, looksNote].filter(Boolean).join(" ");
  const [noteOpen, setNoteOpen] = useState(false);
  const target = compilation.target;
  const over = !!target && total > target * 1.05;
  const iconButton = "btn btn-ghost btn-icon w-7 h-7 text-ink-3 hover:text-white disabled:opacity-25";
  const miniButton = "btn btn-ghost btn-icon btn-mini text-ink-2 hover:text-white disabled:opacity-25";
  const own = ownTransitions(compilation);
  const passages = part !== "look";
  const look = part !== "passages";
  // What the video opens with, in words (a jingle or a hook says what it adds to the video's length)
  const openingName = isIntro(compilation.intro?.style)
    ? t("compilation.intro.value", {
        name: compilation.intro.style === "hook" ? `${t("compilation.intro.style.hook")} ${t(`compilation.intro.style.${hookLook(compilation.intro)}`)}` : t(`compilation.intro.style.${compilation.intro.style}`),
        seconds: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(opening),
      })
    : t("compilation.intro.none");
  // Every template there is to pick from: the look's own first
  const offered = universe ? [...templates].sort((a, b) => Number(b.key === universe.template) - Number(a.key === universe.template)) : templates;
  const tile = (key: string, chosen: boolean, onPick: () => void, picture: ReactNode, name: string) => (
    <button key={key} type="button" aria-pressed={chosen} onClick={onPick} className={`relative min-w-0 flex flex-col items-stretch gap-1.5 p-1.5 rounded-[11px] border transition-colors ${chosen ? "border-accent bg-accent-soft" : "border-white/[0.07] hover:border-white/20"}`}>
      {picture}
      <span className={`truncate text-center text-[11.5px] ${chosen ? "text-white font-[600]" : "text-ink-2"}`}>{name}</span>
      {chosen && (
        <span className="absolute top-1 right-1 w-4 h-4 grid place-items-center rounded-full bg-accent text-ground">
          <Check className="w-2.5 h-2.5" strokeWidth={3.2} />
        </span>
      )}
    </button>
  );
  // The setting open in the look panel: its name and its choices (none: the list of settings)
  const picker: { label: string; body: ReactNode } | null =
    menu === "template"
      ? {
          label: t("compilation.template"),
          body: (
            <div role="group" aria-label={t("compilation.template")} className="grid grid-cols-4 gap-1.5">
              {tile("default", !compilation.template, () => onChange({ ...compilation, template: null }), <span className="block mx-auto w-[62px] h-[110px] rounded-[7px] overflow-hidden bg-white/[0.06]">{sketch?.(null, 62)}</span>, t("compilation.defaultTemplate"))}
              {offered.map((tpl) =>
                tile(tpl.key, compilation.template === tpl.key, () => onChange({ ...compilation, template: tpl.key }), <span className="block mx-auto w-[62px] h-[110px] rounded-[7px] overflow-hidden bg-white/[0.06]">{sketch?.(tpl.key, 62)}</span>, tpl.name),
              )}
            </div>
          ),
        }
      : menu === "titles"
        ? {
            label: t("compilation.titleStyle.label"),
            body: (
              <div role="group" aria-label={t("compilation.titleStyle.label")} className="grid grid-cols-3 gap-1.5">
                {[null, ...(universe?.titles ?? []), ...HOOK_STYLES.filter((style) => !universe?.titles.includes(style))].map((style) =>
                  tile(
                    style ?? "template",
                    titleStyle === style,
                    () => {
                      const { titleStyle: _before, ...rest } = compilation;
                      onChange(isHookStyle(style) ? { ...rest, titleStyle: style } : rest);
                    },
                    <TitleSample style={style} />,
                    style ? t(TITLE_STYLE_NAMES[style]) : t("compilation.titleStyle.template"),
                  ),
                )}
              </div>
            ),
          }
        : menu === "video"
          ? { label: t("compilation.transition.label"), body: <TransitionPicker inline title={t("compilation.transition.video")} value={compilation.transition ?? PLAIN_CUT} onPick={(value) => onChange(setVideoTransition(compilation, value))} onClose={() => setMenu(null)} /> }
          : menu === "intro" && brand
            ? {
                label: t("compilation.intro.opening"),
                body: (
                  <IntroPicker
                    inline
                    value={compilation.intro ?? null}
                    brand={brand}
                    name={compilation.name}
                    onChange={(next) => {
                      const { intro: before, ...rest } = compilation;
                      if (!next) return onChange(rest);
                      // Another style picked here is the streamer's choice, no longer the AI's
                      const { by, ...picked } = next as typeof next & { by?: "ai" };
                      onChange({ ...rest, intro: by && before?.style === next.style ? { ...picked, by } : picked });
                    }}
                    onClose={() => setMenu(null)}
                    hook={hook}
                    pack={universe?.pack}
                  />
                ),
              }
            : menu === "music"
              ? {
                  label: t("compilation.music.label"),
                  body: (
                    <MusicPicker
                      inline
                      value={track ? compilation.music! : null}
                      tracks={musics}
                      favourites={favourites}
                      universe={universe}
                      onChange={(next) => {
                        const { music: _before, ...rest } = compilation;
                        onChange(next ? { ...rest, music: next } : rest);
                      }}
                      onClose={() => setMenu(null)}
                    />
                  ),
                }
              : null;

  return (
    <aside
      ref={list}
      aria-label={t(part === "look" ? "compilation.dress.label" : "compilation.title")}
      className={`glass rounded-[20px] p-3 min-w-0 flex flex-col gap-2.5 ${// (its passages scroll inside it: the timeline under the workshop stays in view)
        part === "passages" ? "flex-[1_1_300px] max-w-[400px] max-h-[max(420px,calc(100dvh-400px))] overflow-y-auto" : part === "look" ? "flex-[1_1_340px] max-w-[420px]" : "flex-[1_1_360px]"}`}
    >
      {passages && (
      <>
      <div className="flex items-center gap-1.5">
        <input
          value={compilation.name}
          onChange={(e) => onChange({ ...compilation, name: e.target.value })}
          aria-label={t("compilation.name")}
          className="flex-1 min-w-0 h-9 px-2.5 rounded-[9px] bg-transparent border border-transparent hover:border-white/10 focus:border-accent-line focus:bg-black/30 text-[16px] font-semibold tracking-[-0.01em] text-white outline-none"
        />
        <button onClick={onDelete} aria-label={t("compilation.delete")} title={t("compilation.delete")} className={iconButton}>
          <Trash2 className="w-[15px] h-[15px]" />
        </button>
      </div>

      {compilation.sections.map((section, si) => {
        const active = section.id === activeSection;
        return (
          <section
            key={section.id}
            data-section={section.id}
            onClick={() => !justDragged.current && onActivate(section.id)}
            className={`rounded-[14px] border p-2 transition-colors ${
              drag?.drop?.section === section.id && section.items.length === 0 ? "border-accent bg-accent-soft" : active ? "border-accent-line bg-white/[0.05]" : "border-white/[0.07] hover:bg-white/[0.03]"
            }`}
          >
            <div className={single ? "hidden" : "flex items-center gap-1"}>
              <input
                value={section.title}
                onChange={(e) => onChange({ ...compilation, sections: compilation.sections.map((s) => (s.id === section.id ? { ...s, title: e.target.value } : s)) })}
                placeholder={t("compilation.sectionTitle", { n: si + 1 })}
                aria-label={t("compilation.sectionTitle", { n: si + 1 })}
                className="flex-1 min-w-0 h-8 px-2 rounded-[8px] bg-transparent border border-transparent hover:border-white/10 focus:border-accent-line focus:bg-black/30 text-[13.5px] font-[550] text-white outline-none placeholder:text-ink-3"
              />
              <span className="mono text-[12px] text-ink-3 px-1">{clock(sectionLength(section))}</span>
              {/* A part can keep its name here without writing it in the video */}
              {compilation.titles && section.title.trim() && (
                <button
                  onClick={() => onChange(showTitle(compilation, section.id, !!section.hidden))}
                  aria-pressed={!section.hidden}
                  aria-label={t(section.hidden ? "compilation.titleShow" : "compilation.titleHide")}
                  title={t(section.hidden ? "compilation.titleShow" : "compilation.titleHide")}
                  className={`${iconButton} ${section.hidden ? "text-ink-3/70" : ""}`}
                >
                  {section.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              )}
              {compilation.sections.length > 1 && (
                <>
                  <button onClick={() => onChange(moveSection(compilation, section.id, -1))} disabled={si === 0} aria-label={t("compilation.moveUp")} className={iconButton}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onChange(moveSection(compilation, section.id, 1))}
                    disabled={si === compilation.sections.length - 1}
                    aria-label={t("compilation.moveDown")}
                    className={iconButton}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {(compilation.sections.length > 1 || section.items.length > 0) && (
                <button onClick={() => onChange(removeSection(compilation, section.id))} aria-label={t("compilation.removeSection")} title={t("compilation.removeSection")} className={iconButton}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {section.items.length === 0 ? (
              <p className="px-2 py-2.5 text-[12.5px] leading-snug text-ink-3">{t(active ? "compilation.emptyActive" : "compilation.emptySection")}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {withGone(section, gone).map((item) =>
                  "leaving" in item ? (
                    <li key={`gone-${item.item.id}`} aria-hidden className="passage-leave overflow-hidden flex items-center gap-2 p-1.5 rounded-[10px]">
                      <span className="w-[64px] aspect-video rounded-[6px] flex-none bg-white/[0.05]" />
                      <span className="flex-1 min-w-0 text-[12.5px] leading-snug text-ink-3 line-through truncate">{item.item.text || liveClock(item.item.start)}</span>
                    </li>
                  ) : (
                  <PassageRow
                    key={fresh?.has(item.id) ? `${item.id}-${freshAt ?? 0}` : item.id}
                    item={item}
                    fresh={!!fresh?.has(item.id)}
                    shown={item.id === selectedItem}
                    playing={item.id === playing}
                    picked={picked.has(item.id)}
                    picking={picked.size > 0}
                    dragged={!!drag?.ids.includes(item.id)}
                    dropBefore={drag?.drop?.section === section.id && drag.drop.before === item.id}
                    dropAfter={drag?.drop?.section === section.id && drag.drop.before === null && section.items[section.items.length - 1].id === item.id}
                    frames={storyboards[item.job ?? home]}
                    live={liveNumbers ? (liveNumbers[item.job ?? home] ?? "?") : null}
                    cutting={cutting.has(item.id)}
                    ownLook={item.template && item.template !== compilation.template ? templateName(item.template) : null}
                    // How it comes in, when that is not as the rest of the video does (never the video's first passage: nothing comes before it)
                    ownTransition={item.id !== firstId && item.transition !== undefined && item.transition !== (compilation.transition ?? PLAIN_CUT) ? item.transition : null}
                    canTransition={item.id !== firstId}
                    onOpen={(e) => {
                      if (justDragged.current) return;
                      if (e.metaKey || e.ctrlKey) toggle(item.id);
                      else if (e.shiftKey) toggle(item.id, true);
                      else onSelect(item);
                    }}
                    onToggle={(range) => toggle(item.id, range)}
                    onPress={(e) => startDrag(e, item.id)}
                    onMove={(by) => onChange(moveItem(compilation, item.id, by))}
                    onRemove={() => onChange(removeItem(compilation, item.id))}
                    onTransition={() => setMenu(typeof menu === "object" && menu?.item === item.id ? null : { item: item.id })}
                    picker={
                      typeof menu === "object" && menu?.item === item.id ? (
                        <TransitionPicker
                          title={t("compilation.transition.before")}
                          value={item.transition ?? null}
                          video={compilation.transition ?? null}
                          onPick={(value) => {
                            setMenu(null);
                            onChange(setTransition(compilation, [item.id], value));
                          }}
                          onClose={() => setMenu(null)}
                          className="right-1 top-full mt-1"
                        />
                      ) : null
                    }
                  />
                  ),
                )}
              </ul>
            )}
          </section>
        );
      })}

      {(!single || onSearch) && (
        <div className="flex flex-wrap gap-1.5">
          {onSearch && (
            <button onClick={onSearch} className="btn btn-ghost btn-sm">
              <Search className="w-[15px] h-[15px]" /> {t("compilation.search")}
            </button>
          )}
          {!single && (
            <button
              onClick={() => {
                const { compilation: next, id } = addSection(compilation);
                onChange(next);
                onActivate(id);
              }}
              className="btn btn-ghost btn-sm"
            >
              <Plus className="w-[15px] h-[15px]" /> {t("compilation.addSection")}
            </button>
          )}
        </div>
      )}

      {/* What is being dragged follows the pointer */}
      {drag && (
        <div aria-hidden className="fixed z-50 pointer-events-none px-2.5 h-8 flex items-center gap-1.5 rounded-[9px] bg-accent text-ground text-[12.5px] font-semibold shadow-[0_12px_30px_-8px_rgba(0,0,0,0.8)]" style={{ left: drag.x + 14, top: drag.y + 10 }}>
          <Layers className="w-3.5 h-3.5" strokeWidth={2.4} /> {t("compilation.moments", { count: drag.ids.length })}
        </div>
      )}

      {/* Several passages picked: what can be done with them together, kept in view while the list scrolls */}
      {picked.size > 0 && (
        <div role="toolbar" aria-label={t("compilation.pickedCount", { count: picked.size })} className="pick-bar sticky bottom-3 z-30 flex flex-wrap items-center gap-1 p-1.5 pl-3 rounded-[13px]">
          <span className="basis-full flex items-center justify-between gap-2 text-[12.5px] font-semibold text-white">
            <span className="flex-1 min-w-0 truncate">{t("compilation.pickedCount", { count: picked.size })}</span>
            <button
              onClick={() => {
                onChange(removeItems(compilation, pickedIds));
                toast.success(t("compilation.removedCount", { count: pickedIds.length }));
              }}
              aria-label={t("compilation.removePicked")}
              title={t("compilation.removePicked")}
              className={miniButton}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setPicked(new Set())} aria-label={t("compilation.clearPicked")} title={t("compilation.clearPicked")} className={miniButton}>
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
          <button onClick={() => onChange(moveItems(compilation, pickedIds, -1))} aria-label={t("compilation.moveUp")} title={t("compilation.moveUp")} className={miniButton}>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onChange(moveItems(compilation, pickedIds, 1))} aria-label={t("compilation.moveDown")} title={t("compilation.moveDown")} className={miniButton}>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <span className="relative">
            <button onClick={() => setMenu(menu === "move" ? null : "move")} aria-haspopup="menu" aria-expanded={menu === "move"} className="btn btn-glass btn-sm px-2.5">
              <FolderInput className="w-3.5 h-3.5" /> {t("compilation.moveTo")}
            </button>
            {menu === "move" && <PartsMenu parts={compilation.sections.map((section) => ({ id: section.id, name: partName(section), count: section.items.length }))} onPick={moveTo} onClose={() => setMenu(null)} />}
          </span>
          <span className="relative">
            <button onClick={() => setMenu(menu === "picked" ? null : "picked")} aria-haspopup="dialog" aria-expanded={menu === "picked"} title={t("compilation.transition.picked", { count: picked.size })} className="btn btn-glass btn-sm px-2.5">
              <Blend className="w-3.5 h-3.5" /> {t("compilation.transition.one")}
            </button>
            {menu === "picked" && (
              <TransitionPicker
                title={t("compilation.transition.picked", { count: picked.size })}
                value={(() => {
                  const chosen = new Set(pickedIds.filter((id) => id !== firstId).map((id) => allItems(compilation).find((item) => item.id === id)?.transition ?? null));
                  return chosen.size === 1 ? [...chosen][0] : "";
                })()}
                video={compilation.transition ?? null}
                onPick={(value) => {
                  setMenu(null);
                  onChange(setTransition(compilation, pickedIds, value));
                  toast.success(t("compilation.transition.applied", { count: pickedIds.length, name: value === null ? t("compilation.transition.asVideo") : transitionName(value) }));
                }}
                onClose={() => setMenu(null)}
                className="right-0 bottom-full mb-2"
              />
            )}
          </span>
        </div>
      )}

      {/* Length: what it makes, what is aimed for */}
        <div className="mt-1 pt-3 border-t border-white/[0.08]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] text-ink-2">
              <span className={`mono font-semibold ${over ? "text-[#F5B14C]" : "text-white"}`}>{clock(total)}</span> · {t("compilation.moments", { count })}
            </span>
            {over && (
              <button onClick={() => onChange(fitToTarget(compilation, target! - opening))} className="btn btn-glass btn-sm h-7 px-2.5">
                {t("compilation.fit", { length: clock(target!) })}
              </button>
            )}
          </div>
          <div role="group" aria-label={t("compilation.length")} className="seg mt-2">
            {TARGETS.map((seconds) => (
              <button key={seconds} aria-pressed={target === seconds} onClick={() => onChange({ ...compilation, target: target === seconds ? null : seconds })}>
                {t(`compilation.target.${seconds}`)}
              </button>
            ))}
          </div>
        </div>
      </>
      )}

      {look && (
      <div className={`flex flex-col gap-2.5 ${part === "look" ? "" : "pt-3 border-t border-white/[0.08]"}`}>
        {picker ? (
          // One setting open: its choices take the panel, the way back above them
          <>
            <button type="button" onClick={() => setMenu(null)} className="self-start -ml-1 h-8 px-2 rounded-[9px] inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-white hover:bg-white/[0.07] transition-colors">
              <ArrowLeft className="w-4 h-4" /> {t("compilation.dress.label")}
              <span aria-hidden className="opacity-40">/</span>
              <span className="font-[600] text-white">{picker.label}</span>
            </button>
            {picker.body}
          </>
        ) : (
          <>
            <span className="px-1 text-[13.5px] font-[620] text-white">{t("compilation.dress.label")}</span>
            {/* A whole look in one click: the channel's own, a game's, or the AI's choice for this video */}
            <div className="grid grid-cols-3 gap-1.5">
              {[null, ...UNIVERSES].map((one) => {
                const on = (one?.id ?? null) === (universe?.id ?? null);
                return (
                  <button
                    key={one?.id ?? "channel"}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange(dressAs(compilation, one))}
                    className={`min-w-0 flex items-center gap-2 p-1.5 pr-2 rounded-[12px] border text-left transition-colors ${on ? "border-accent bg-accent-soft" : "border-white/[0.09] hover:border-white/20"}`}
                  >
                    <span className="flex-none w-[26px] h-[46px] rounded-[6px] overflow-hidden bg-white/[0.06]">{sketch?.(one ? one.template : null, 26)}</span>
                    <span className="min-w-0 truncate text-[12.5px] font-[600] text-white">{one ? t(`compilation.universe.${one.id}`) : t("compilation.universe.channel")}</span>
                  </button>
                );
              })}
              <button type="button" onClick={dress} disabled={count === 0 || choosing || cutting.size > 0} aria-label={t(choosing ? "compilation.dress.working" : "compilation.dress.ai")} title={t("compilation.dress.hint")} className="min-w-0 flex items-center gap-2 p-1.5 pr-2 rounded-[12px] border border-white/[0.09] hover:border-accent-line text-left transition-colors disabled:opacity-50">
                <span className="flex-none w-[26px] h-[46px] rounded-[6px] grid place-items-center bg-accent-soft text-accent">{choosing ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Sparkles className="w-3.5 h-3.5" />}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-[600] text-white">{t(choosing ? "compilation.dress.working" : "compilation.dress.aiShort")}</span>
                  {!choosing && <span className="mono block text-[11px] text-ink-3">{dressCost}</span>}
                </span>
              </button>
            </div>

            <LookGroup label={t("compilation.dress.group.picture")}>
              <LookRow
                icon={LayoutTemplate}
                label={t("compilation.template")}
                value={compilation.template ? templateName(compilation.template) : t("compilation.defaultTemplate")}
                onOpen={() => setMenu("template")}
                apart={ownLooks > 0 ? { text: t("compilation.ownLooks", { count: ownLooks }), action: t("compilation.looksSame"), onClick: onSameLook } : undefined}
              >
                <span className="flex-none w-[18px] h-[32px] rounded-[4px] overflow-hidden bg-white/[0.06]">{sketch?.(compilation.template ?? null, 18)}</span>
                <span className="truncate">{compilation.template ? templateName(compilation.template) : t("compilation.defaultTemplate")}</span>
              </LookRow>
              {/* Where the webcam is on this live: found by the analysis, set by hand when it is wrong */}
              {cam && (
                <LookRow icon={ScanFace} label={t("montage.cam.label")} value={cam.label} onOpen={cam.onOpen}>
                  <span className="truncate">{cam.label}</span>
                </LookRow>
              )}
            </LookGroup>

            <LookGroup label={t("compilation.dress.group.text")}>
              {single ? (
                <LookRow icon={Type} label={t("videos.onScreenTitle")}>
                  <input
                    value={compilation.hook}
                    onChange={(e) => onChange({ ...compilation, hook: e.target.value })}
                    placeholder={t("compilation.hookPlaceholder")}
                    aria-label={t("montage.hook")}
                    className="w-[210px] max-w-full h-8 px-2.5 rounded-[9px] bg-black/30 border border-white/10 text-[12.5px] text-white outline-none focus:border-accent-line placeholder:text-ink-3"
                  />
                </LookRow>
              ) : (
                <>
                  <LookRow icon={Type} label={t("compilation.titles")}>
                    <button role="switch" aria-checked={compilation.titles} aria-label={t("compilation.titles")} title={t("compilation.titlesHint")} onClick={() => onChange({ ...compilation, titles: !compilation.titles })} className="switch flex-none">
                      <span />
                    </button>
                  </LookRow>
                  {/* Without titles, one line is written over the first seconds of the video */}
                  {!compilation.titles && (
                    <LookRow icon={Type} label={t("videos.onScreenTitle")}>
                      <input
                        value={compilation.hook}
                        onChange={(e) => onChange({ ...compilation, hook: e.target.value })}
                        placeholder={t("compilation.hookPlaceholder")}
                        aria-label={t("montage.hook")}
                        className="w-[210px] max-w-full h-8 px-2.5 rounded-[9px] bg-black/30 border border-white/10 text-[12.5px] text-white outline-none focus:border-accent-line placeholder:text-ink-3"
                      />
                    </LookRow>
                  )}
                </>
              )}
              <LookRow icon={Palette} label={t("compilation.titleStyle.label")} value={titleStyle ? t(TITLE_STYLE_NAMES[titleStyle]) : t("compilation.titleStyle.template")} onOpen={() => setMenu("titles")}>
                <TitleSample style={titleStyle} small />
                <span className="truncate">{titleStyle ? t(TITLE_STYLE_NAMES[titleStyle]) : t("compilation.titleStyle.template")}</span>
              </LookRow>
            </LookGroup>

            <LookGroup label={t("compilation.dress.group.motion")}>
              {/* How much the picture moves on what is said: three answers, chosen on the row */}
              <LookRow icon={Zap} label={t("compilation.effects.label")}>
                <span role="group" aria-label={t("compilation.effects.label")} className="seg">
                  {[null, ...EFFECT_LEVELS].map((level) => (
                    <button
                      key={level ?? "none"}
                      type="button"
                      aria-pressed={effects === level}
                      onClick={() => {
                        const { effects: _before, ...rest } = compilation;
                        onChange(level ? { ...rest, effects: level } : rest);
                      }}
                    >
                      {t(`compilation.effects.${level ?? "none"}`)}
                    </button>
                  ))}
                </span>
              </LookRow>
              {/* How every passage comes in; one passage can do otherwise. A video of one passage has no cut to dress */}
              {count > 1 && (
                <LookRow
                  icon={Blend}
                  label={t("compilation.transition.label")}
                  value={transitionName(compilation.transition)}
                  onOpen={() => setMenu("video")}
                  apart={own > 0 ? { text: t("compilation.transition.ownCount", { count: own }), action: t("compilation.transition.same"), onClick: () => onChange(setVideoTransition(compilation, compilation.transition ?? null, true)) } : undefined}
                >
                  <span className="truncate">{transitionName(compilation.transition)}</span>
                </LookRow>
              )}
            </LookGroup>

            {(brand || musics.length > 0) && (
              <LookGroup label={t("compilation.dress.group.sound")}>
                {/* What the video opens with: nothing, a jingle (the channel's logo and colours), or its best moment */}
                {brand && (
                  <LookRow icon={Clapperboard} label={t("compilation.intro.opening")} value={openingName} onOpen={() => setMenu("intro")}>
                    <span className="truncate">{openingName}</span>
                  </LookRow>
                )}
                {/* A music under the whole video, turned down when people talk: heard from its row */}
                {musics.length > 0 && (
                  <LookRow
                    icon={Music2}
                    label={t("compilation.music.label")}
                    value={track?.name ?? t("compilation.music.none")}
                    onOpen={() => setMenu("music")}
                    before={
                      track && (
                        <button type="button" onClick={() => listen(track)} aria-label={t(heard === track.id ? "compilation.music.stop" : "compilation.music.listen", { name: track.name })} className="flex-none w-7 h-7 grid place-items-center rounded-full bg-white/[0.1] hover:bg-white/[0.18] text-white">
                          {heard === track.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 translate-x-px" />}
                        </button>
                      )
                    }
                  >
                    <span className="truncate">{track?.name ?? t("compilation.music.none")}</span>
                  </LookRow>
                )}
              </LookGroup>
            )}
            {/* What the AI said of its choices, once it has made some: two lines, the rest a click away */}
            {aiNote && (
              <button type="button" onClick={() => setNoteOpen(!noteOpen)} aria-expanded={noteOpen} className="px-1 w-full flex gap-1.5 text-left text-[12px] leading-snug text-ink-3 hover:text-ink-2 transition-colors">
                <Sparkles className="w-3.5 h-3.5 mt-px flex-none text-accent" />
                <span className={noteOpen ? "" : "line-clamp-2"}>{aiNote}</span>
              </button>
            )}
          </>
        )}

        <div className="mt-1 flex flex-col gap-1.5">
          <button onClick={onExport} disabled={count === 0 || exporting || editing || cutting.size > 0} className="btn btn-primary btn-lg w-full h-[48px]">
            {exporting ? (
              <Loader2 className="w-4 h-4 spinner" />
            ) : cutting.size > 0 ? (
              <>
                <Loader2 className="w-4 h-4 spinner" /> {t("compilation.cuttingCount", { count: cutting.size })}
              </>
            ) : (
              <>
                {t("compilation.export")} <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
              </>
            )}
          </button>
          {/* Or the whole video as one clip in the layer editor, where everything can be moved */}
          {onEdit && !picker && (
            <button onClick={onEdit} disabled={count === 0 || exporting || editing || cutting.size > 0} title={`${t("compilation.editorHint")}${own > 0 || !!compilation.transition || ownLooks > 0 || !!compilation.intro || !!compilation.music ? ` ${t("compilation.editorLoses")}` : ""}`} className="btn btn-ghost btn-sm w-full">
              {editing ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Layers className="w-3.5 h-3.5" />}
              {t(editing ? "compilation.editorPreparing" : "compilation.openEditor")}
            </button>
          )}
        </div>
      </div>
      )}
    </aside>
  );
}

/** What each way of writing a title is called (the template editor's own names) */
const TITLE_STYLE_NAMES: Record<HookStyle, string> = {
  outline: "templateEditor.hookOutline",
  box: "templateEditor.hookBox",
  brand: "templateEditor.hookBrand",
  vice: "templateEditor.hookVice",
  viceplate: "templateEditor.hookVicePlate",
};

/** A family of settings of the look: what the picture is, what is written, what moves, what is heard */
function LookGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="px-1 pb-1 text-[11px] font-[600] tracking-[0.05em] uppercase text-ink-4">{label}</p>
      <div className="rounded-[13px] border border-white/[0.09] bg-black/25 divide-y divide-white/[0.07]">{children}</div>
    </div>
  );
}

/**
 * One setting of the look: what it is, and what it is set to shown as it is (`children`: the
 * drawing of the template, the letters of the title, the track to hear). A setting of three
 * answers or fewer is chosen right there; one with more opens its choices in the panel
 * (`onOpen`; `value`: what it is set to, in words). `apart`: some passages do otherwise, said
 * under it with a way to bring them back.
 */
function LookRow({ icon: Icon, label, value, onOpen, before, apart, children }: { icon: LucideIcon; label: string; value?: string; onOpen?: () => void; before?: ReactNode; apart?: { text: string; action: string; onClick: () => void }; children: ReactNode }) {
  const inside = (
    <>
      <Icon className="w-4 h-4 flex-none text-ink-3" />
      <span className="flex-none text-[13.5px] font-[550] text-white">{label}</span>
    </>
  );
  return (
    <div className="first:rounded-t-[12px] last:rounded-b-[12px]">
      <div className={`min-h-[46px] pl-3 pr-2 flex items-center gap-2.5 ${onOpen ? "hover:bg-white/[0.045] transition-colors" : ""}`}>
        {onOpen ? (
          <>
            {before && <span className="order-2 flex-none">{before}</span>}
            <button type="button" onClick={onOpen} aria-label={value ? `${label} : ${value}` : label} className="group order-1 flex-1 min-w-0 self-stretch flex items-center gap-2.5 text-left">
              {inside}
              <span className="flex-1 min-w-0 flex items-center justify-end gap-2 text-[13px] text-ink-2">{children}</span>
            </button>
            <ChevronRight aria-hidden className="order-3 w-3.5 h-3.5 flex-none text-ink-4" />
          </>
        ) : (
          <>
            {inside}
            <span className="flex-1 min-w-0 flex items-center justify-end gap-2 text-[13px] text-ink-2 py-1.5 pr-1">{children}</span>
          </>
        )}
      </div>
      {apart && (
        <p className="-mt-1 pb-2 pl-[38px] pr-3 flex items-baseline gap-2 text-[12px] text-ink-3">
          <span className="flex-1 min-w-0 truncate">{apart.text}</span>
          <button type="button" onClick={apart.onClick} className="flex-none text-accent hover:text-white transition-colors">
            {apart.action}
          </button>
        </p>
      )}
    </div>
  );
}

/** Two letters written the way a title is: what each way of writing looks like, at a glance */
function TitleSample({ style, small = false }: { style: HookStyle | null; small?: boolean }) {
  const box = small ? "flex-none w-[34px] h-[24px] rounded-[6px] text-[13px]" : "w-full aspect-[16/10] rounded-[8px] text-[24px]";
  const stroke = { WebkitTextStroke: small ? "1px #000" : "2px #000", paintOrder: "stroke fill" } as const;
  if (style === "outline") return <span className={`${box} grid place-items-center bg-white/[0.08] font-[900] text-white`} style={stroke}>Aa</span>;
  if (style === "box") return <span className={`${box} grid place-items-center bg-black font-[800] text-white`}>Aa</span>;
  if (style === "brand") return <span className={`${box} grid place-items-center bg-accent font-[800] text-accent-ink`}>Aa</span>;
  if (style === "vice") return <span className={`${box} grid place-items-center bg-[linear-gradient(180deg,#5b2a86,#e0619a)] font-[900] lowercase text-white`} style={stroke}>aa</span>;
  if (style === "viceplate")
    return (
      <span className={`${box} relative grid place-items-center bg-[linear-gradient(180deg,#5b2a86,#e0619a)] font-[900] lowercase text-white overflow-hidden`}>
        <span aria-hidden className="absolute inset-x-[16%] inset-y-[20%] -rotate-3 rounded-[3px] bg-black" />
        <span className="relative">aa</span>
      </span>
    );
  return <span className={`${box} grid place-items-center bg-white/[0.06] font-[600] text-ink-3`}>Aa</span>;
}

interface RowProps {
  item: CompilationItem;
  fresh: boolean;
  /** Open in the passage view */
  shown: boolean;
  /** The whole video is on it */
  playing: boolean;
  picked: boolean;
  /** Some passages are picked: every row shows its box */
  picking: boolean;
  dragged: boolean;
  /** What is being dragged would land right before it, or after it (the last of its part) */
  dropBefore: boolean;
  dropAfter: boolean;
  frames?: TwitchStoryboard;
  /** The number of the live it is from, when the video takes from several */
  live: number | string | null;
  cutting: boolean;
  ownLook: string | null;
  ownTransition: string | null;
  canTransition: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onToggle: (range: boolean) => void;
  onPress: (e: ReactPointerEvent) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onTransition: () => void;
  picker: React.ReactNode;
}

/** One passage of the video: opened by a click, picked by its box, dragged to another place */
function PassageRow({ item, fresh, shown, playing, picked, picking, dragged, dropBefore, dropAfter, frames, live, cutting, ownLook, ownTransition, canTransition, onOpen, onToggle, onPress, onMove, onRemove, onTransition, picker }: RowProps) {
  const { t } = useTranslation();
  const iconButton = "btn btn-ghost btn-icon btn-mini text-ink-3 hover:text-white disabled:opacity-25";
  return (
    <>
      {/* It comes in its own way: said between it and the passage before */}
      {ownTransition && (
        <li className="flex items-center gap-2 px-2 h-[18px]">
          <span className="flex-1 h-px bg-white/[0.09]" />
          <button type="button" onClick={onTransition} title={t("compilation.transition.before")} className="look-chip flex-none hover:brightness-125">
            <Blend className="w-3 h-3" strokeWidth={2.2} />
            {t(`compilation.transition.${ownTransition}`)}
          </button>
          <span className="flex-1 h-px bg-white/[0.09]" />
        </li>
      )}
      <li
        data-item={item.id}
        data-fresh={fresh ? "" : undefined}
        aria-current={playing ? "true" : undefined}
        onPointerDown={onPress}
        className={`group/item relative flex items-center gap-2 p-1.5 rounded-[10px] select-none transition-[background-color,opacity] ${fresh ? "passage-arrive" : ""} ${dragged ? "opacity-35" : ""} ${
          picked ? "bg-accent-soft" : shown ? "bg-white/10" : "hover:bg-white/[0.05]"
        }`}
      >
        {dropBefore && <span aria-hidden className="drop-line -top-[2px]" />}
        {dropAfter && <span aria-hidden className="drop-line -bottom-[2px]" />}
        {playing && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent shadow-[0_0_10px_var(--color-accent-glow)]" />}
        <button type="button" onClick={(e) => (e.stopPropagation(), onOpen(e))} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
          <span className={`relative w-[64px] aspect-video rounded-[6px] overflow-hidden flex-none bg-white/[0.05] ${ownLook ? "ring-2 ring-accent" : ""}`} style={frames ? tileStyle(frames, frameAt(frames, item.start)) : undefined}>
            {live !== null && <span className="live-dot absolute bottom-0.5 left-0.5">{live}</span>}
            {cutting && (
              <span className="absolute inset-0 grid place-items-center bg-black/55">
                <Loader2 className="w-3.5 h-3.5 spinner text-white" />
              </span>
            )}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[12.5px] leading-snug text-white truncate">{item.text || item.why || liveClock(item.start)}</span>
            <span className="mono flex items-center gap-1.5 text-[11px] text-ink-3 min-w-0">
              {/* Shown in a template of its own: seen at a glance down the list */}
              {ownLook && (
                <span className="look-chip flex-none" title={t("compilation.ownLook", { name: ownLook })}>
                  <LayoutTemplate className="w-3 h-3" strokeWidth={2.2} />
                  {ownLook}
                </span>
              )}
              <span className={`truncate ${playing ? "text-accent" : ""}`}>
                {liveClock(item.start)} · {(item.end - item.start).toFixed(1)} s
              </span>
            </span>
          </span>
        </button>
        {/* Its box: ticked to move, group or take out several passages at once */}
        <span
          role="checkbox"
          tabIndex={0}
          aria-checked={picked}
          aria-label={t("compilation.pick")}
          title={t("compilation.pickHint")}
          data-nodrag
          onClick={(e) => (e.stopPropagation(), onToggle(e.shiftKey))}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), onToggle(e.shiftKey))}
          className={`pick-box absolute left-[3px] top-[3px] ${picked ? "is-picked" : ""} ${picked || picking ? "opacity-100" : "opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"}`}
        >
          {picked && <Check className="w-3 h-3" strokeWidth={3.4} />}
        </span>
        <span data-nodrag className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center rounded-[9px] bg-[#1b1e1c]/95 border border-white/10 opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity">
          {canTransition && (
            <button onClick={(e) => (e.stopPropagation(), onTransition())} aria-label={t("compilation.transition.before")} title={t("compilation.transition.before")} className={iconButton}>
              <Blend className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => onMove(-1)} aria-label={t("compilation.moveUp")} className={iconButton}>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onMove(1)} aria-label={t("compilation.moveDown")} className={iconButton}>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} aria-label={t("compilation.removeItem")} title={t("compilation.removeItem")} className={iconButton}>
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
        {picker}
      </li>
    </>
  );
}

/** The parts picked passages can be moved to, and a new one */
function PartsMenu({ parts, onPick, onClose }: { parts: { id: string; name: string; count: number }[]; onPick: (id: string | null) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
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
  const row = "w-full flex items-center gap-2 h-9 px-2.5 rounded-[8px] text-left text-[13px] text-white hover:bg-white/[0.08]";
  return (
    <div ref={box} role="menu" className="absolute z-40 left-0 bottom-full mb-2 w-[236px] p-1.5 rounded-[13px] bg-[#171a18]/[0.98] border border-white/[0.12] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)]">
      {parts.map((part, i) => (
        <button key={part.id} role="menuitem" onClick={() => onPick(part.id)} className={row}>
          <span className="mono w-4 flex-none text-[11px] text-ink-3">{i + 1}</span>
          <span className="flex-1 min-w-0 truncate">{part.name}</span>
          <span className="mono flex-none text-[11px] text-ink-3">{part.count}</span>
        </button>
      ))}
      <button role="menuitem" onClick={() => onPick(null)} className={`${row} mt-0.5 border-t border-white/[0.08] rounded-t-none text-accent`}>
        <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2.4} /> {t("compilation.newSection")}
      </button>
    </div>
  );
}
