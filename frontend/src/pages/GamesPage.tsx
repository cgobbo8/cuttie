import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { listGames, type GameSummary } from "../lib/api";
import { useTranslation } from "react-i18next";
import {
  Search,
  Loader2,
  Gamepad2,
  Users,
  Eye,
  Film,
  Calendar,
} from "lucide-react";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function GameCard({ game, onClick }: { game: GameSummary; onClick: () => void }) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const thumbnailUrl = game.thumbnail || null;

  return (
    <div
      onClick={onClick}
      className="surface-static rounded-xl overflow-hidden transition-all duration-200 cursor-pointer group hover:bg-white/[0.03]"
    >
      <div className="flex items-start gap-4 p-4">
        {/* Game thumbnail */}
        <div className="w-[80px] h-[107px] rounded-lg overflow-hidden bg-white/[0.04] shrink-0">
          {thumbnailUrl && !imgError ? (
            <img
              src={thumbnailUrl}
              alt={game.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Gamepad2 className="w-6 h-6 text-zinc-600" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 py-0.5">
          <h3 className="text-sm font-semibold text-zinc-300 group-hover:text-white transition-colors truncate mb-2">
            {game.name}
          </h3>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Film className="w-3 h-3 shrink-0" />
              <span>
                <span className="text-zinc-300 font-medium">{game.vod_count}</span>{" "}
                {t("games.vods")}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Users className="w-3 h-3 shrink-0" />
              <span>
                <span className="text-zinc-300 font-medium">{game.streamer_count}</span>{" "}
                {t("games.streamers")}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Eye className="w-3 h-3 shrink-0" />
              <span>
                <span className="text-zinc-300 font-medium">{formatNumber(game.avg_views)}</span>{" "}
                {t("games.avgViews")}
              </span>
            </div>
            {game.last_stream_date && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Calendar className="w-3 h-3 shrink-0" />
                <span className="text-zinc-400">{game.last_stream_date}</span>
              </div>
            )}
          </div>

          {/* Streamers list */}
          {game.streamers.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {game.streamers.slice(0, 5).map((streamer) => (
                <span
                  key={streamer}
                  className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white/[0.05] text-zinc-400"
                >
                  {streamer}
                </span>
              ))}
              {game.streamers.length > 5 && (
                <span className="text-[11px] text-zinc-600 px-1 py-0.5">
                  +{game.streamers.length - 5}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GamesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchGames = useCallback(async () => {
    try {
      const data = await listGames();
      setGames(data);
    } catch {
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  const filtered = useMemo(() => {
    if (!search.trim()) return games;
    const q = search.toLowerCase();
    return games.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.streamers.some((s) => s.toLowerCase().includes(q))
    );
  }, [games, search]);

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">
            {t("games.title")}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {t("games.gameCount", { count: games.length })}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("games.search")}
            className="w-full pl-10 pr-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white/[0.16] transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Gamepad2 className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            {search ? t("common.noResults") : t("games.noGames")}
          </p>
          {!search && (
            <p className="text-xs text-zinc-600 mt-1">
              {t("games.noGamesHint")}
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((game) => (
            <GameCard
              key={game.name}
              game={game}
              onClick={() => navigate(`/?search=${encodeURIComponent(game.name)}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
