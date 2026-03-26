import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { getJobStatus, clipUrl, type HotPoint } from "../lib/api";
import ClipEditor from "../components/ClipEditor";

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
        setClips(job.hot_points.filter((hp) => hp.vertical_filename));
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
          <p className="text-zinc-400 mb-4">Aucun clip vertical disponible.</p>
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

  const current = clips[selectedIdx];

  return (
    <ClipEditor
      key={selectedIdx}
      videoUrl={clipUrl(jobId!, current.vertical_filename!)}
      clipFilename={current.vertical_filename!}
      jobId={jobId!}
      llm={current.llm}
      clips={clips}
      selectedIdx={selectedIdx}
      onSelectClip={setSelectedIdx}
      onClose={() => navigate(`/${jobId}`)}
    />
  );
}
