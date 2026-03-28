import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { getJobStatus, type HotPoint } from "../lib/api";
import RemotionEditor from "../components/remotion-editor/RemotionEditor";
import { useTranslation } from "react-i18next";

export default function RemotionEditPage() {
  const { t } = useTranslation();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [clip, setClip] = useState<HotPoint | null>(null);
  const [loading, setLoading] = useState(true);

  const clipFile = searchParams.get("clip");

  useEffect(() => {
    if (!jobId) return;
    getJobStatus(jobId)
      .then((job) => {
        const clips = (job.hot_points ?? []).filter((hp) => hp.clip_filename);
        if (!clips.length) {
          navigate(`/${jobId}`);
          return;
        }
        const target = clipFile
          ? clips.find((hp) => hp.clip_filename === clipFile)
          : clips[0];
        setClip(target ?? null);
      })
      .catch(() => navigate("/"))
      .finally(() => setLoading(false));
  }, [jobId, clipFile, navigate]);

  if (loading) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="bg-zinc-900 border border-white/[0.08] rounded-2xl p-8 text-center">
          <p className="text-zinc-400 mb-4">{t("editPage.noClipAvailable")}</p>
          <button
            onClick={() => navigate(`/${jobId}`)}
            className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            {t("editPage.backToResults")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <RemotionEditor
      key={clip.clip_filename}
      jobId={jobId!}
      hotPoint={clip}
      onClose={() => navigate(`/${jobId}`)}
    />
  );
}
