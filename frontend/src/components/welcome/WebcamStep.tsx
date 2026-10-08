import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { FacecamRect } from "../../lib/api";
import WebcamFrame from "../WebcamFrame";
import { Progress, type CamSearch } from "./shared";

interface Props {
  search: CamSearch;
  /** Thumbnail of the latest live, shown while looking */
  placeholder: string | null;
  onRetry: () => void;
  onConfirm: (rect: FacecamRect, frameKey: string | null) => Promise<void>;
  onNoCam: () => Promise<void>;
  onSkip: () => void;
}

/** Where a cam usually is when we have to place it by hand: top-right corner */
function defaultRect(w = 1920, h = 1080): FacecamRect {
  return { x: Math.round(w * 0.78), y: 0, w: Math.round(w * 0.22), h: Math.round(h * 0.41), ref_w: w, ref_h: h };
}

/** Step 3: confirm (or place) the webcam found on the latest live */
export default function WebcamStep({ search, placeholder, onRetry, onConfirm, onNoCam, onSkip }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<FacecamRect | null>(null);
  const [saving, setSaving] = useState(false);

  const result = search.status === "done" ? search.result : null;
  const found = result?.facecam ?? null;

  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
    } finally {
      setSaving(false);
    }
  };

  const lead =
    search.status === "error"
      ? t("welcome.cam.error")
      : result && !found
        ? t("welcome.cam.notFound")
        : editing
          ? t("welcome.cam.adjustHint")
          : t("welcome.cam.lead");

  return (
    <>
      <Progress step={2} />
      <div className="mt-[22px] text-[13px] font-[550] text-accent">{t("welcome.cam.label")}</div>
      <h1 className="mt-2 text-[34px] leading-[1.08] tracking-[-0.03em] font-[650] text-white text-balance">{t("welcome.cam.title")}</h1>
      <p className="mt-2.5 text-[14.5px] leading-[1.55] text-ink-2 max-w-[46ch]" aria-live="polite">
        {lead}
      </p>

      {result ? (
        <WebcamFrame className="mt-5" frameUrl={result.frame_url} rect={editing ?? found} editing={!!editing} onChange={setEditing} />
      ) : (
        <div className="relative mt-5 aspect-video rounded-[12px] overflow-hidden border border-white/[0.08] bg-white/[0.04]">
          {placeholder && <img src={placeholder} alt="" className="absolute inset-0 w-full h-full object-cover brightness-[0.45] saturate-[0.8]" />}
          {search.status !== "error" && (
            <>
              <div className="absolute inset-0 scan-line" />
              <div className="absolute inset-0 grid place-items-center">
                <span className="chip glass-chip text-white h-8 px-3 gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("welcome.cam.searching")}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button onClick={() => run(() => onConfirm(editing, result?.frame_key ?? null))} disabled={saving} className="btn btn-primary">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("welcome.cam.save")}
            </button>
            <button onClick={() => setEditing(null)} disabled={saving} className="btn btn-ghost">
              {t("welcome.cam.cancel")}
            </button>
          </>
        ) : search.status === "error" ? (
          <>
            <button onClick={onRetry} className="btn btn-primary">
              {t("welcome.retry")}
            </button>
            <button onClick={onSkip} className="btn btn-ghost">
              {t("welcome.cam.skip")}
            </button>
          </>
        ) : result ? (
          <>
            {found ? (
              <>
                <button onClick={() => run(() => onConfirm(found, result.frame_key))} disabled={saving} className="btn btn-primary">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("welcome.cam.yes")}
                </button>
                <button onClick={() => setEditing(found)} disabled={saving} className="btn btn-glass">
                  {t("welcome.cam.adjust")}
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(defaultRect(1920, 1080))} disabled={saving} className="btn btn-primary">
                {t("welcome.cam.draw")}
              </button>
            )}
            <button onClick={() => run(onNoCam)} disabled={saving} className="btn btn-glass">
              {t("welcome.cam.none")}
            </button>
          </>
        ) : (
          <button onClick={onSkip} className="btn btn-ghost -ml-2">
            {t("welcome.cam.skip")}
          </button>
        )}
      </div>
    </>
  );
}
