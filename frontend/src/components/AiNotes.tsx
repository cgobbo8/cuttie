import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, FileText, FileUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { createNote, deleteNote, listJobs, listNotes, saveNote, type AiNote } from "../lib/api";
import { NOTE_CHANGED } from "../lib/aiMemory";
import { mainGames, parseNote, starterNotes, titleFromFile, whenUsed, type NoteDraft } from "../lib/aiNotes";
import ConfirmModal from "./ConfirmModal";
import { useToast } from "./Toast";

const MAX_TITLE = 80;

/**
 * One note being written: its title, the lives it is for (every live, or those on some games),
 * and what the AI should know. `known`: the games of the streamer's lives, offered to pick from.
 */
function NoteEditor({ draft, known, maxChars, saving, onSave, onDelete, onClose }: { draft: NoteDraft; known: string[]; maxChars: number; saving: boolean; onSave: (next: NoteDraft) => void; onDelete?: () => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [title, setTitle] = useState(draft.title);
  const [games, setGames] = useState(draft.games);
  const [some, setSome] = useState(draft.games.length > 0);
  const [body, setBody] = useState(draft.body);
  const [other, setOther] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const has = (game: string) => games.some((mine) => mine.toLowerCase() === game.toLowerCase());
  const toggle = (game: string) => setGames(has(game) ? games.filter((mine) => mine.toLowerCase() !== game.toLowerCase()) : [...games, game]);
  const addOther = () => {
    const game = other.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (game && !has(game)) setGames([...games, game]);
    setOther("");
  };
  // The games to pick from: the streamer's own, then those this note already names
  const offered = [...known, ...games.filter((game) => !known.some((mine) => mine.toLowerCase() === game.toLowerCase()))];
  const used = some ? games : [];
  const ready = title.trim().length > 0 && body.trim().length > 0 && (!some || games.length > 0);
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px] animate-fade-in" onClick={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !saving) onSave({ ...(draft.id ? { id: draft.id } : {}), title: title.trim(), games: used, body: body.trim() });
        }}
        className="relative glass-strong rounded-[20px] p-5 w-full max-w-[620px] max-h-[calc(100dvh-48px)] overflow-y-auto animate-rise"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 id={`${id}-title`} className="text-[16px] font-semibold tracking-[-0.01em] text-white">
            {t(draft.id ? "notes.editor.edit" : "notes.editor.new")}
          </h3>
          <button type="button" onClick={onClose} aria-label={t("common.cancel")} className="w-8 h-8 grid place-items-center rounded-[9px] text-ink-3 hover:text-white hover:bg-white/[0.07] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block mt-4">
          <span className="block pb-1 text-[12px] text-ink-3">{t("notes.editor.title")}</span>
          <input
            value={title}
            maxLength={MAX_TITLE}
            autoFocus={!draft.title}
            placeholder={t("notes.editor.titlePlaceholder")}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full h-10 px-3 rounded-[10px] bg-black/30 border border-white/10 text-[14px] text-white outline-none focus:border-accent-line placeholder:text-ink-4"
          />
        </label>

        <div className="mt-4">
          <span className="block pb-1.5 text-[12px] text-ink-3">{t("notes.editor.for")}</span>
          <div role="group" aria-label={t("notes.editor.for")} className="seg">
            <button type="button" aria-pressed={!some} onClick={() => setSome(false)}>
              {t("notes.always")}
            </button>
            <button type="button" aria-pressed={some} onClick={() => setSome(true)}>
              {t("notes.editor.forGames")}
            </button>
          </div>
          {some && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {offered.map((game) => (
                <button
                  key={game}
                  type="button"
                  aria-pressed={has(game)}
                  onClick={() => toggle(game)}
                  className={`h-7 px-2.5 rounded-full border text-[12px] transition-colors ${has(game) ? "border-accent bg-accent-soft text-white" : "border-white/10 text-ink-2 hover:bg-white/[0.07]"}`}
                >
                  {game}
                </button>
              ))}
              <input
                value={other}
                maxLength={60}
                placeholder={t("notes.editor.gamePlaceholder")}
                aria-label={t("notes.editor.gamePlaceholder")}
                onChange={(e) => setOther(e.target.value)}
                onBlur={addOther}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  addOther();
                }}
                className="flex-1 min-w-[190px] h-7 px-2.5 rounded-full bg-black/30 border border-white/10 text-[12px] text-white outline-none focus:border-accent-line placeholder:text-ink-4"
              />
            </div>
          )}
        </div>

        <label className="block mt-4">
          <span className="flex items-baseline justify-between pb-1 text-[12px] text-ink-3">
            <span>{t("notes.editor.body")}</span>
            <span className={`tabular-nums ${body.length >= maxChars ? "text-[#F5B14C]" : ""}`}>{t("notes.editor.count", { count: number(body.length), max: number(maxChars) })}</span>
          </span>
          <textarea
            value={body}
            maxLength={maxChars}
            autoFocus={!!draft.title}
            placeholder={t("notes.editor.bodyPlaceholder")}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="block w-full h-[320px] px-3 py-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] leading-[1.55] text-white outline-none focus:border-accent-line placeholder:text-ink-4 resize-y"
          />
        </label>

        <div className="mt-4 flex items-center gap-2">
          {onDelete && (
            <button type="button" onClick={onDelete} disabled={saving} className="btn btn-ghost text-[#ff8a7a]">
              <Trash2 className="w-3.5 h-3.5" /> {t("common.delete")}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-ghost">
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={!ready || saving} className="btn btn-primary">
            {saving && <Loader2 className="w-3.5 h-3.5 spinner" />} {t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * What the AI knows about the streamer: the notes they write for it (who is who, the names it
 * gets wrong, the words of their game, what their viewers like). It reads them whenever it
 * analyses a live, searches it or builds a video. A note is for every live, or for those on some
 * games. They can be written here, started from a few headings, or brought in as files.
 */
export default function AiNotes() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [notes, setNotes] = useState<AiNote[] | null>(null);
  const [limits, setLimits] = useState({ max: 12, maxChars: 4000 });
  const [known, setKnown] = useState<string[]>([]);
  const [editing, setEditing] = useState<NoteDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<AiNote | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      listNotes()
        .then((found) => {
          setNotes(found.notes);
          setLimits({ max: found.max, maxChars: found.max_chars });
        })
        .catch(() => setNotes((now) => now ?? [])),
    [],
  );
  // A note changed from elsewhere (a correction the AI proposed, accepted): the list follows
  useEffect(() => {
    window.addEventListener(NOTE_CHANGED, load);
    return () => window.removeEventListener(NOTE_CHANGED, load);
  }, [load]);
  useEffect(() => {
    load();
    // The games of their lives: what a note can be about
    listJobs({ per_page: 60 })
      .then((jobs) => setKnown(mainGames(jobs.data.map((job) => job.vod_game))))
      .catch(() => {});
  }, [load]);

  const save = async (draft: NoteDraft) => {
    setSaving(true);
    try {
      const fields = { title: draft.title, games: draft.games, body: draft.body };
      if (draft.id) await saveNote(draft.id, fields);
      else await createNote(fields);
      await load();
      setEditing(null);
      toast.success(t("notes.saved"));
    } catch (err) {
      toast.error(err instanceof Error && err.message === "too many notes" ? t("notes.full", { max: limits.max }) : t("notes.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (note: AiNote) => {
    setSaving(true);
    try {
      await deleteNote(note.id);
      await load();
      setRemoving(null);
      setEditing(null);
      toast.success(t("notes.deleted"));
    } catch {
      toast.error(t("notes.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  /** Notes written elsewhere, brought in as files (Markdown, with or without a heading of `title:` and `games:`) */
  const bring = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let added = 0;
    let failed = 0;
    for (const file of [...files]) {
      try {
        const read = parseNote(await file.text(), titleFromFile(file.name));
        if (!read.title || !read.body) throw new Error("empty");
        await createNote({ title: read.title.slice(0, MAX_TITLE), games: read.games, body: read.body.slice(0, limits.maxChars) });
        added++;
      } catch {
        failed++;
      }
    }
    if (picker.current) picker.current.value = "";
    await load();
    if (added > 0) toast.success(t("notes.imported", { count: added }));
    if (failed > 0) toast.error(t("notes.importFailed", { count: failed }));
  };

  const full = (notes?.length ?? 0) >= limits.max;
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const starters = starterNotes(t, known[0] ?? null);

  return (
    <div className="mt-4">
      {notes && notes.length > 0 && (
        <ul className="rounded-[13px] border border-white/[0.09] bg-black/25 divide-y divide-white/[0.07]">
          {notes.map((note) => (
            <li key={note.id} className="first:rounded-t-[12px] last:rounded-b-[12px] hover:bg-white/[0.045] transition-colors">
              <button type="button" onClick={() => setEditing({ id: note.id, title: note.title, games: note.games, body: note.body })} className="group w-full min-h-[52px] py-2 pl-3 pr-2.5 flex items-center gap-2.5 text-left">
                <FileText className="w-4 h-4 flex-none text-accent" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[13.5px] font-[550] text-white">{note.title}</span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {whenUsed(note, t)} · {t("notes.chars", { count: note.body.length, formatted: number(note.body.length) })}
                  </span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 flex-none text-ink-4 transition-colors group-hover:text-ink-2" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Nothing written yet: a few notes to start from, each a title and headings to fill in */}
      {notes && notes.length === 0 && (
        <div>
          <p className="text-[12.5px] text-ink-3">{t("notes.empty")}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {starters.map((starter) => (
              <button key={starter.title} type="button" onClick={() => setEditing(starter)} className="btn btn-glass btn-sm">
                <Plus className="w-3.5 h-3.5 text-accent" /> {starter.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditing({ title: "", games: [], body: "" })} disabled={full || !notes} className="btn btn-glass btn-sm">
          <Plus className="w-3.5 h-3.5 text-accent" /> {t("notes.new")}
        </button>
        <button type="button" onClick={() => picker.current?.click()} disabled={full || !notes} className="btn btn-ghost btn-sm">
          <FileUp className="w-3.5 h-3.5" /> {t("notes.import")}
        </button>
        <input ref={picker} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden aria-label={t("notes.import")} onChange={(e) => bring(e.target.files)} />
        {full && <span className="text-[12px] text-ink-3">{t("notes.full", { max: limits.max })}</span>}
      </div>

      {/* Over the whole page, not inside this card: a blurred card holds what is "fixed" inside it */}
      {createPortal(
        <>
          {editing && (
            <NoteEditor
              key={editing.id ?? `new-${editing.title}`}
              draft={editing}
              known={known}
              maxChars={limits.maxChars}
              saving={saving}
              onSave={save}
              onDelete={editing.id ? () => setRemoving(notes?.find((note) => note.id === editing.id) ?? null) : undefined}
              onClose={() => !saving && !removing && setEditing(null)}
            />
          )}
          <ConfirmModal
            open={!!removing}
            title={t("notes.deleteTitle")}
            message={t("notes.deleteMessage", { title: removing?.title ?? "" })}
            loading={saving}
            onConfirm={() => removing && remove(removing)}
            onCancel={() => setRemoving(null)}
          />
        </>,
        document.body,
      )}
    </div>
  );
}
