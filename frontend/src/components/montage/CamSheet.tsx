import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import type { FacecamRect } from "../../lib/api";
import WebcamFrame from "../WebcamFrame";

interface Props {
  /** A frame of the clip on screen */
  frameUrl: string;
  clipW: number;
  clipH: number;
  /** This live's webcam as resolved now, in clip pixels */
  initial: { x: number; y: number; w: number; h: number } | null;
  /** The framing was set by hand for this live */
  manual: boolean;
  /** rect = this framing, false = no cam on this live, null = back to automatic */
  onSave: (facecam: FacecamRect | false | null, remember: boolean) => Promise<void>;
  onClose: () => void;
}

/** Frame the webcam for one live (and optionally keep it as the usual position) */
export default function CamSheet({ frameUrl, clipW, clipH, initial, manual, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [rect, setRect] = useState<FacecamRect>(() =>
    initial
      ? { ...initial, ref_w: clipW, ref_h: clipH }
      : { x: Math.round(clipW * 0.78), y: 0, w: Math.round(clipW * 0.22), h: Math.round(clipH * 0.41), ref_w: clipW, ref_h: clipH },
  );
  const [remember, setRemember] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (facecam: FacecamRect | false | null, keep = false) => {
    setSaving(true);
    try {
      await onSave(facecam, keep);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6 bg-black/50 backdrop-blur-[6px] animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cam-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="glass-strong rounded-[22px] p-6 w-[720px] max-w-full animate-rise"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="cam-sheet-title" className="text-[22px] font-semibold tracking-[-0.02em] text-white">
              {t("montage.cam.sheetTitle")}
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-2">{t("montage.cam.sheetHint")}</p>
          </div>
          <button onClick={onClose} aria-label={t("montage.cam.cancel")} className="btn btn-ghost btn-icon -mr-2 -mt-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <WebcamFrame className="mt-5" frameUrl={frameUrl} rect={rect} editing onChange={setRect} />

        <label className="mt-4 flex items-center gap-2.5 text-[13.5px] text-ink-2 cursor-pointer select-none">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 accent-[var(--color-accent)]" />
          {t("montage.cam.remember")}
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button onClick={() => save(rect, remember)} disabled={saving} className="btn btn-primary">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("montage.cam.save")}
          </button>
          <button onClick={() => save(false)} disabled={saving} className="btn btn-glass">
            {t("montage.cam.noCamHere")}
          </button>
          {manual && (
            <button onClick={() => save(null)} disabled={saving} className="btn btn-ghost">
              {t("montage.cam.automatic")}
            </button>
          )}
          <button onClick={onClose} disabled={saving} className="btn btn-ghost ml-auto">
            {t("montage.cam.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
