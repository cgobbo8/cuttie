import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { BrandKit, FacecamRect } from "../../lib/api";
import SignaturePreview from "../SignaturePreview";

interface Props {
  kit: BrandKit;
  frameUrl: string | null;
  login: string | null;
  avatarUrl: string | null;
  /** An API key is missing or rejected: analyses won't run yet */
  keysMissing: boolean;
  onAddKeys: () => void;
  onGo: () => void;
}

/** The end: what their clips will look like, and off to the first analysis */
export default function ReadyStep({ kit, frameUrl, login, avatarUrl, keysMissing, onAddKeys, onGo }: Props) {
  const { t } = useTranslation();
  const facecam: FacecamRect | false | null = kit.facecam;

  return (
    <div className="flex flex-wrap items-center gap-8">
      <div className="flex-[1_1_260px] min-w-0">
        <div className="text-[13px] font-[550] text-accent">{t("welcome.ready.label")}</div>
        <h1 className="mt-2 text-[34px] leading-[1.08] tracking-[-0.03em] font-[650] text-white text-balance">{t("welcome.ready.title")}</h1>
        <p className="mt-2.5 text-[14.5px] leading-[1.55] text-ink-2 max-w-[40ch]">
          {frameUrl ? t("welcome.ready.lead") : t("welcome.ready.leadNoChannel")}
        </p>
        {keysMissing && (
          <div className="mt-5 p-3.5 rounded-[14px] inset text-[13px] leading-normal text-ink-2">
            {t("welcome.ready.keysMissing")}
            <button onClick={onAddKeys} className="btn btn-glass btn-sm mt-2.5 flex">
              {t("welcome.ready.addKeys")}
            </button>
          </div>
        )}
        <button onClick={onGo} className="btn btn-primary btn-lg mt-7">
          {t("welcome.ready.go")} <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
        </button>
      </div>
      {frameUrl && (
        <SignaturePreview
          className="w-[210px] flex-none rounded-[16px] border border-white/[0.14] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.9)] animate-rise"
          frameUrl={frameUrl}
          facecam={facecam}
          colors={kit.colors}
          avatarUrl={avatarUrl}
          login={login}
          lines={[t("welcome.ready.sample").split(" ")]}
          highlight={[0, 0]}
          subtitleStyle={kit.subtitles.style}
          showWidget={kit.widget.enabled}
        />
      )}
    </div>
  );
}
