import { NavLink, useNavigate } from "react-router";
import { useState, type FormEvent } from "react";
import { Film, FolderOpen, Plus, X, Loader2 } from "lucide-react";
import { submitVod } from "../lib/api";

export default function Sidebar() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!url.includes("twitch.tv/videos/")) {
      setError("URL invalide");
      return;
    }
    setLoading(true);
    try {
      const { job_id } = await submitVod(url);
      setUrl("");
      setShowForm(false);
      navigate(`/${job_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive
        ? "bg-white/[0.08] text-white font-medium"
        : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
    }`;

  return (
    <aside className="w-[240px] shrink-0 h-screen sticky top-0 flex flex-col border-r border-white/[0.06] bg-[#09090b]">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center justify-between">
        <NavLink to="/" className="flex items-center gap-2.5">
          <span className="text-lg font-bold tracking-tight text-white">
            Cuttie
          </span>
        </NavLink>
      </div>

      {/* New creation button */}
      <div className="px-3 mb-1">
        {showForm ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="twitch.tv/videos/..."
                autoFocus
                disabled={loading}
                className="flex-1 min-w-0 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white/[0.2] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => { setShowForm(false); setError(""); }}
                className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="w-full py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Analyse...
                </>
              ) : (
                "Analyser"
              )}
            </button>
            {error && <p className="text-xs text-red-400 px-1">{error}</p>}
          </form>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouvelle creation
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        <NavLink to="/" end className={navClass}>
          <FolderOpen className="w-4 h-4" />
          Creations
        </NavLink>
        <NavLink to="/exports" className={navClass}>
          <Film className="w-4 h-4" />
          Exports
        </NavLink>
      </nav>

    </aside>
  );
}
