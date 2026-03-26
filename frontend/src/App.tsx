import { useState, useCallback } from "react";
import { getJobStatus, retryJob, type JobResponse } from "./lib/api";
import UrlForm from "./components/UrlForm";
import JobStatus from "./components/JobStatus";
import HotPoints from "./components/HotPoints";
import JobList from "./components/JobList";

type Phase = "input" | "processing" | "results" | "error";

export default function App() {
  const [phase, setPhase] = useState<Phase>("input");
  const [jobId, setJobId] = useState("");
  const [results, setResults] = useState<JobResponse | null>(null);

  const handleSubmit = useCallback((id: string) => {
    setJobId(id);
    setPhase("processing");
  }, []);

  const handleComplete = useCallback((job: JobResponse) => {
    setResults(job);
    setPhase(job.status === "DONE" ? "results" : "error");
  }, []);

  const handleReset = useCallback(() => {
    setPhase("input");
    setResults(null);
    setJobId("");
  }, []);

  const handleSelectJob = useCallback(async (id: string) => {
    try {
      const job = await getJobStatus(id);
      setJobId(id);
      if (job.status === "DONE") {
        setResults(job);
        setPhase("results");
      } else if (job.status === "ERROR") {
        setResults(job);
        setPhase("error");
      } else {
        setPhase("processing");
      }
    } catch {
      // ignore
    }
  }, []);

  const handleRetryJob = useCallback(async (id: string) => {
    try {
      await retryJob(id);
      setJobId(id);
      setPhase("processing");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Retry failed");
    }
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background ambient blobs */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-purple-500/[0.04] blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-blue-500/[0.03] blur-[120px]" />
        <div className="absolute top-[40%] right-[20%] w-[400px] h-[400px] rounded-full bg-pink-500/[0.02] blur-[100px]" />
      </div>

      {/* Header */}
      <header className="border-b border-white/[0.04] py-5">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <button onClick={handleReset} className="group flex items-center gap-3">
            <span className="text-2xl font-extrabold tracking-tight text-white group-hover:text-purple-400 transition-colors">
              Cuttie
            </span>
            <span className="text-sm text-zinc-600 font-medium hidden sm:inline">
              Twitch VOD Clip Finder
            </span>
          </button>
          {(phase === "results" || phase === "error") && (
            <button
              onClick={handleReset}
              className="text-sm text-zinc-500 hover:text-white transition-colors px-4 py-2 rounded-xl glass"
            >
              Nouvelle analyse
            </button>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        {phase === "input" && (
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
              <JobList onSelect={handleSelectJob} onRetry={handleRetryJob} />
            </div>
          </div>
        )}

        {phase === "processing" && (
          <JobStatus jobId={jobId} onComplete={handleComplete} />
        )}

        {phase === "results" && results?.hot_points && (
          <HotPoints
            hotPoints={results.hot_points}
            vodTitle={results.vod_title || "VOD"}
            vodGame={results.vod_game || ""}
            vodDuration={results.vod_duration_seconds || 0}
            jobId={results.job_id}
            streamer={results.streamer || ""}
            viewCount={results.view_count || 0}
            streamDate={results.stream_date || ""}
          />
        )}

        {phase === "error" && (
          <div className="text-center max-w-md mx-auto">
            <div className="glass rounded-2xl p-8">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-red-400 mb-6">{results?.error || "Une erreur est survenue"}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={async () => {
                    if (!results) return;
                    try {
                      await retryJob(results.job_id);
                      setJobId(results.job_id);
                      setPhase("processing");
                    } catch (e: unknown) {
                      alert(e instanceof Error ? e.message : "Retry failed");
                    }
                  }}
                  className="px-5 py-2.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-xl transition-colors border border-purple-500/20"
                >
                  Reprendre
                </button>
                <button
                  onClick={handleReset}
                  className="px-5 py-2.5 glass rounded-xl text-zinc-400 hover:text-white transition-colors"
                >
                  Nouvelle analyse
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
