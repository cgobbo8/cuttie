import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { getJobStatus, type HotPoint } from "../lib/api";
import CanvasEditor from "../components/editor/CanvasEditor";

export default function EditPage() {
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
        if (job.status !== "DONE" || !job.hot_points) {
          navigate(`/${jobId}`);
          return;
        }
        const clips = job.hot_points.filter((hp) => hp.clip_filename);
        // If a clip is specified in the URL, use it; otherwise use the first one
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
        <svg className="w-8 h-8 spinner text-zinc-400" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" opacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="glass rounded-2xl p-8 text-center">
          <p className="text-zinc-400 mb-4">Aucun clip disponible pour l'edition.</p>
          <button
            onClick={() => navigate(`/${jobId}`)}
            className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            Retour aux resultats
          </button>
        </div>
      </div>
    );
  }

  return (
    <CanvasEditor
      key={clip.clip_filename}
      jobId={jobId!}
      hotPoint={clip}
      onClose={() => navigate(`/${jobId}`)}
    />
  );
}
