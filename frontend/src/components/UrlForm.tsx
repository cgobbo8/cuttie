import { useState, type FormEvent } from "react";
import { submitVod } from "../lib/api";

interface Props {
  onSubmit: (jobId: string) => void;
}

export default function UrlForm({ onSubmit }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!url.includes("twitch.tv/videos/")) {
      setError("L'URL doit etre une VOD Twitch (twitch.tv/videos/...)");
      return;
    }

    setLoading(true);
    try {
      const { job_id } = await submitVod(url);
      onSubmit(job_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de la soumission");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="glass rounded-2xl p-2 flex gap-2 focus-within:border-white/[0.15] transition-colors">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.twitch.tv/videos/123456789"
          disabled={loading}
          className="flex-1 px-4 py-3 bg-transparent text-white placeholder-zinc-600 focus:outline-none disabled:opacity-50 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="px-6 py-3 bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-black font-semibold rounded-xl transition-all text-sm shrink-0"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 spinner" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeLinecap="round" opacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Analyse...
            </span>
          ) : (
            "Analyser"
          )}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-red-400 text-sm px-2">{error}</p>
      )}
    </form>
  );
}
