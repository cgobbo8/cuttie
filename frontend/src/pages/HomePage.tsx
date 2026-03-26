import { useCallback } from "react";
import { useNavigate } from "react-router";
import { retryJob } from "../lib/api";
import UrlForm from "../components/UrlForm";
import JobList from "../components/JobList";

export default function HomePage() {
  const navigate = useNavigate();

  const handleSubmit = useCallback(
    (jobId: string) => navigate(`/${jobId}`),
    [navigate],
  );

  const handleSelect = useCallback(
    (jobId: string) => navigate(`/${jobId}`),
    [navigate],
  );

  const handleRetry = useCallback(
    async (jobId: string) => {
      try {
        await retryJob(jobId);
        navigate(`/${jobId}`);
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : "Retry failed");
      }
    },
    [navigate],
  );

  return (
    <div className="flex flex-col items-center">
      <div className="text-center mb-12">
        <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">
          Trouve les
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            {" "}moments forts
          </span>
        </h2>
        <p className="text-zinc-500 text-lg max-w-lg mx-auto">
          Colle l'URL d'une VOD Twitch et laisse l'IA detecter les meilleurs clips
        </p>
      </div>
      <UrlForm onSubmit={handleSubmit} />
      <div className="mt-16 w-full max-w-2xl">
        <JobList onSelect={handleSelect} onRetry={handleRetry} />
      </div>
    </div>
  );
}
