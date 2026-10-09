import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, KeyRound } from "lucide-react";
import type { JobNotice } from "../lib/api";

export const OPENROUTER_CREDITS_URL = "https://openrouter.ai/settings/credits";

/** The AI provider refusing every call (no credits, refused key), when that's why an analysis stopped */
export function providerNotice(notices: JobNotice[] | null | undefined): JobNotice | undefined {
  return notices?.find((n) => n.kind === "provider" && (n.reason === "credits" || n.reason === "key"));
}

/** What to do about it: top up on OpenRouter, or check the key in Settings */
export default function ProviderFix({ notice, className = "" }: { notice: JobNotice; className?: string }) {
  const { t } = useTranslation();
  return notice.reason === "credits" ? (
    <a href={OPENROUTER_CREDITS_URL} target="_blank" rel="noreferrer" className={`btn btn-primary btn-sm ${className}`}>
      {t("job.provider.topUp")} <ExternalLink className="w-3.5 h-3.5" />
    </a>
  ) : (
    <Link to="/settings" className={`btn btn-primary btn-sm ${className}`}>
      <KeyRound className="w-3.5 h-3.5" /> {t("job.provider.checkKey")}
    </Link>
  );
}
