import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { getJobStatus, type HotPoint } from "../lib/api";
import CanvasEditor from "../components/editor/CanvasEditor";

export default function EditPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [clips, setClips] = useState<HotPoint[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!jobId) return;
    getJobStatus(jobId)
      .then((job) => {
        if (job.status !== "DONE" || !job.hot_points) {
          navigate(`/${jobId}`);
          return;
        }
        // Keep clips that have both a raw clip and a vertical version
        setClips(job.hot_points.filter((hp) => hp.clip_filename && hp.vertical_filename));
      })
      .catch(() => navigate("/"))
      .finally(() => setLoading(false));
  }, [jobId, navigate]);

  if (loading) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <svg className="w-8 h-8 spinner text-purple-400" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" opacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="glass rounded-2xl p-8 text-center">
          <p className="text-zinc-400 mb-4">Aucun clip disponible pour l'edition.</p>
          <button
            onClick={() => navigate(`/${jobId}`)}
            className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
          >
            Retour aux resultats
          </button>
        </div>
      </div>
    );
  }

  return (
    <CanvasEditor
      key={selectedIdx}
      jobId={jobId!}
      hotPoint={clips[selectedIdx]}
      clips={clips}
      selectedIdx={selectedIdx}
      onSelectClip={setSelectedIdx}
      onClose={() => navigate(`/${jobId}`)}
    />
  );
}
