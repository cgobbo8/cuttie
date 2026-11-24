import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Film, Loader2, Pause, Pencil, Play, Plus, Trash2, Upload, X } from "lucide-react";
import { deleteMedia, mediaFileUrl, mediaThumbUrl, renameMedia, type MediaItem } from "../lib/api";
import { MEDIA_ACCEPT, importMedia, isVideoFile, loadMedia, mediaClock, useMedia } from "../lib/mediaLibrary";
import ConfirmModal from "./ConfirmModal";
import { useToast } from "./Toast";

interface Props {
  /**
   * In the montage: a video is added to the video on screen as a passage. A file imported from
   * here goes into the library and straight into the video. Without it, the library is managed
   * (Ma chaîne): renamed, removed.
   */
  onAdd?: (media: MediaItem[]) => void;
  /** How many passages of the video on screen each one already makes (shown on its row) */
  used?: Record<string, number>;
  onClose?: () => void;
  /** False: no title of its own (the card it sits in has one) */
  header?: boolean;
  className?: string;
}

/**
 * The streamer's media library: short videos of their own (an outro, a meme, something filmed on a
 * phone) that any video can take as a passage, cut and dressed like a moment of a live. Files are
 * dropped on it or picked; each is converted once to what the montage plays, then listened to.
 */
export default function MediaLibrary({ onAdd, used = {}, onClose, header = true, className = "" }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { media, longest, loaded } = useMedia();
  const picker = useRef<HTMLInputElement>(null);
  // How far an import is: « 1/3 »
  const [importing, setImporting] = useState<{ done: number; of: number } | null>(null);
  const [over, setOver] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<MediaItem | null>(null);

  const bring = async (files: File[]) => {
    if (files.length === 0 || importing) return;
    setImporting({ done: 0, of: files.length });
    try {
      const { added, refused } = await importMedia(files, (done, of) => setImporting({ done, of }));
      for (const no of refused) toast.error(t(`media.refused.${no.reason}`, { name: no.name, minutes: Math.round((no.longest ?? longest) / 60) }));
      if (added.length === 0) return;
      if (onAdd) onAdd(added);
      else toast.success(t("media.imported", { count: added.length }));
    } finally {
      setImporting(null);
    }
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    const videos = files.filter(isVideoFile);
    if (files.length > 0 && videos.length === 0) toast.error(t("media.refused.not_video", { name: files[0].name }));
    bring(videos);
  };
  const rename = async () => {
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    const before = media.find((one) => one.id === id)?.name;
    if (!name.trim() || name.trim() === before) return;
    try {
      await renameMedia(id, name.trim());
      await loadMedia();
      toast.success(t("media.renamed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    }
  };
  const remove = async (item: MediaItem) => {
    setRemoving(null);
    try {
      await deleteMedia(item.id);
      await loadMedia();
      toast.success(t("media.removed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    }
  };

  return (
    <section
      aria-label={t("media.title")}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={drop}
      className={`relative min-w-0 flex flex-col gap-3 ${className}`}
    >
      {header && (
        <header className="flex items-center gap-2 min-w-0">
          <Film className="w-4 h-4 flex-none text-accent" />
          <h3 className="flex-1 min-w-0 text-[14px] font-[620] text-white truncate">{t("media.title")}</h3>
          {media.length > 0 && <span className="flex-none mono text-[11.5px] text-ink-3">{t("media.count", { count: media.length })}</span>}
          {onClose && (
            <button type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="flex-none w-7 h-7 -mr-1 grid place-items-center rounded-[8px] text-ink-3 hover:text-white hover:bg-white/[0.08]">
              <X className="w-4 h-4" />
            </button>
          )}
        </header>
      )}

      <input
        ref={picker}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          bring([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {/* Where a file comes in: picked, or dropped anywhere on the library */}
      <button type="button" onClick={() => picker.current?.click()} disabled={!!importing} className={`media-drop ${over ? "is-over" : ""}`}>
        {importing ? <Loader2 className="w-[18px] h-[18px] spinner flex-none" /> : <Upload className="w-[18px] h-[18px] flex-none" />}
        <span className="min-w-0 text-left">
          <b className="block text-[13px] font-[600] text-white">{importing ? t("media.importing", { done: Math.min(importing.done + 1, importing.of), of: importing.of }) : t(onAdd ? "media.importAndAdd" : "media.importFile")}</b>
          <span className="block text-[11.5px] leading-snug text-ink-3">{importing ? t("media.importingHint") : t("media.dropHint", { minutes: Math.round(longest / 60) })}</span>
        </span>
      </button>

      {media.length === 0 ? (
        loaded && <p className="px-1 text-[12.5px] leading-snug text-ink-3">{t("media.empty")}</p>
      ) : (
        <ul className={onAdd ? "flex flex-col gap-1" : "grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"}>
          {media.map((item) =>
            onAdd ? (
              <li key={item.id} className="group/media flex items-center gap-2.5 p-1.5 rounded-[10px] hover:bg-white/[0.05]">
                <Thumb item={item} playing={playing === item.id} onPlay={(on) => setPlaying(on ? item.id : null)} className="w-[72px]" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] leading-snug text-white truncate" title={item.name}>
                    {item.name}
                  </span>
                  <span className="mono flex items-center gap-1.5 text-[11px] text-ink-3">
                    {mediaClock(item.seconds)}
                    {used[item.id] ? (
                      <span className="inline-flex items-center gap-0.5 text-accent">
                        <Check className="w-3 h-3" strokeWidth={3} /> {t("media.used", { count: used[item.id] })}
                      </span>
                    ) : null}
                  </span>
                </span>
                <button type="button" onClick={() => onAdd([item])} aria-label={t("media.addNamed", { name: item.name })} title={t("media.add")} className="btn btn-glass btn-sm flex-none pl-2 pr-2.5">
                  <Plus className="w-3.5 h-3.5" strokeWidth={2.4} /> {t("media.add")}
                </button>
              </li>
            ) : (
              <li key={item.id} className="group/media min-w-0 flex flex-col gap-1.5 p-1.5 rounded-[14px] bg-white/[0.04] border border-white/[0.07]">
                <Thumb item={item} playing={playing === item.id} onPlay={(on) => setPlaying(on ? item.id : null)} className="w-full" />
                {renaming?.id === item.id ? (
                  <input
                    autoFocus
                    value={renaming.name}
                    maxLength={60}
                    aria-label={t("media.name")}
                    onChange={(e) => setRenaming({ id: item.id, name: e.target.value })}
                    onBlur={rename}
                    onKeyDown={(e) => (e.key === "Enter" ? e.currentTarget.blur() : e.key === "Escape" && setRenaming(null))}
                    className="h-7 min-w-0 px-2 rounded-[8px] bg-black/30 border border-accent-line text-[12.5px] text-white outline-none"
                  />
                ) : (
                  <div className="flex items-center gap-0.5 min-w-0 pl-1">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] leading-snug text-white truncate" title={item.name}>
                        {item.name}
                      </span>
                      <span className="block mono text-[11px] text-ink-3">{mediaClock(item.seconds)}</span>
                    </span>
                    <button type="button" onClick={() => setRenaming({ id: item.id, name: item.name })} aria-label={t("media.renameNamed", { name: item.name })} title={t("media.rename")} className="flex-none w-7 h-7 grid place-items-center rounded-[8px] text-ink-3 hover:text-white hover:bg-white/10">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setRemoving(item)} aria-label={t("media.removeNamed", { name: item.name })} title={t("media.remove")} className="flex-none w-7 h-7 grid place-items-center rounded-[8px] text-ink-3 hover:text-[#ff8a7a] hover:bg-white/10">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {over && (
        <div aria-hidden className="pointer-events-none absolute -inset-1.5 z-10 grid place-items-center rounded-[18px] border-2 border-dashed border-accent bg-[rgba(10,10,12,0.72)] text-[13px] font-[600] text-white">
          {t("media.dropHere")}
        </div>
      )}
      {/* (over the whole page: inside a blurred card, a fixed layer would stay shut in the card) */}
      {createPortal(
        <ConfirmModal
          open={!!removing}
          title={t("media.removeTitle", { name: removing?.name ?? "" })}
          message={t("media.removeBody")}
          confirmLabel={t("media.remove")}
          variant="danger"
          onConfirm={() => removing && remove(removing)}
          onCancel={() => setRemoving(null)}
        />,
        document.body,
      )}
    </section>
  );
}

/** A video's picture, whole (it may be upright); a click plays it right there, with its sound */
function Thumb({ item, playing, onPlay, className }: { item: MediaItem; playing: boolean; onPlay: (on: boolean) => void; className: string }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  // Another one starts: this one stops
  useEffect(() => {
    if (!playing) video.current?.pause();
  }, [playing]);
  return (
    <button
      type="button"
      onClick={() => onPlay(!playing)}
      aria-label={t(playing ? "media.stopNamed" : "media.playNamed", { name: item.name })}
      className={`relative flex-none aspect-video rounded-[8px] overflow-hidden bg-black ${className}`}
    >
      {playing ? (
        <video ref={video} src={mediaFileUrl(item.id)} autoPlay playsInline onEnded={() => onPlay(false)} className="absolute inset-0 w-full h-full object-contain" />
      ) : (
        <img src={mediaThumbUrl(item.id)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-contain" />
      )}
      <span aria-hidden className={`absolute inset-0 grid place-items-center transition-opacity ${playing ? "opacity-0 hover:opacity-100" : "opacity-0 group-hover/media:opacity-100"} bg-black/35`}>
        <span className="w-7 h-7 grid place-items-center rounded-full bg-white/90 text-black">{playing ? <Pause className="w-3.5 h-3.5" fill="currentColor" /> : <Play className="w-3.5 h-3.5 translate-x-px" fill="currentColor" />}</span>
      </span>
    </button>
  );
}
