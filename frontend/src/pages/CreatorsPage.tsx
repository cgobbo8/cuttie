import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { listCreators, type CreatorSummary } from "../lib/api";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { useTranslation } from "react-i18next";
import {
  Search,
  Loader2,
  Users,
  Eye,
  Film,
  Calendar,
  Gamepad2,
} from "lucide-react";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function CreatorCard({ creator, onClick }: { creator: CreatorSummary; onClick: () => void }) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);

  return (
    <div
      onClick={onClick}
      className="surface-static rounded-xl overflow-hidden transition-all duration-200 cursor-pointer group hover:bg-white/[0.03]"
    >
      <div className="flex items-start gap-4 p-4">
        {/* Avatar */}
        <div className="w-[72px] h-[72px] rounded-full overflow-hidden bg-white/[0.04] shrink-0">
          {creator.thumbnail && !imgError ? (
            <img
              src={creator.thumbnail}
              alt={creator.display_name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Users className="w-6 h-6 text-zinc-600" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 py-0.5">
          <h3 className="text-sm font-semibold text-zinc-300 group-hover:text-white transition-colors truncate mb-2">
            {creator.display_name}
          </h3>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Film className="w-3 h-3 shrink-0" />
              <span>
                <span className="text-zinc-300 font-medium">{creator.vod_count}</span>{" "}
                {t("creators.vods")}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Eye className="w-3 h-3 shrink-0" />
              <span>
                <span className="text-zinc-300 font-medium">{formatNumber(creator.avg_views)}</span>{" "}
                {t("creators.avgViews")}
              </span>
            </div>
            {creator.last_stream_date && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Calendar className="w-3 h-3 shrink-0" />
                <span className="text-zinc-400">{creator.last_stream_date}</span>
              </div>
            )}
          </div>

          {/* Games list */}
          {creator.games.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {creator.games.slice(0, 4).map((game) => (
                <span
                  key={game}
                  className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white/[0.05] text-zinc-400 flex items-center gap-1"
                >
                  <Gamepad2 className="w-2.5 h-2.5" />
                  {game}
                </span>
              ))}
              {creator.games.length > 4 && (
                <span className="text-[11px] text-zinc-600 px-1 py-0.5">
                  +{creator.games.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CreatorsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAllMode, setCreator } = useCreatorWorkspace();
  const [creators, setCreators] = useState<CreatorSummary[]>([]);

  // Redirect to dashboard when in creator mode
  useEffect(() => {
    if (!isAllMode) navigate("/", { replace: true });
  }, [isAllMode, navigate]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchCreators = useCallback(async () => {
    try {
      const data = await listCreators();
      setCreators(data);
    } catch {
      setCreators([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCreators();
  }, [fetchCreators]);

  const filtered = useMemo(() => {
    if (!search.trim()) return creators;
    const q = search.toLowerCase();
    return creators.filter(
      (c) =>
        c.display_name.toLowerCase().includes(q) ||
        c.login.toLowerCase().includes(q) ||
        c.games.some((g) => g.toLowerCase().includes(q))
    );
  }, [creators, search]);

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">
            {t("creators.title")}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {t("creators.creatorCount", { count: creators.length })}
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
            placeholder={t("creators.search")}
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
          <Users className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            {search ? t("common.noResults") : t("creators.noCreators")}
          </p>
          {!search && (
            <p className="text-xs text-zinc-600 mt-1">
              {t("creators.noCreatorsHint")}
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((creator) => (
            <CreatorCard
              key={creator.id}
              creator={creator}
              onClick={() => { setCreator(creator); navigate("/"); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
