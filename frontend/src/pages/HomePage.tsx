import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { getDashboard, type DashboardData } from "../lib/api";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  FolderOpen,
  Film,
  Users,
  Gamepad2,
  Eye,
  ArrowRight,
  BarChart3,
} from "lucide-react";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDate(iso: string, lng: string): string {
  const locale = lng === "es" ? "es-ES" : lng === "en" ? "en-US" : "fr-FR";
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({ icon: Icon, value, label }: { icon: typeof FolderOpen; value: string | number; label: string }) {
  return (
    <div className="surface-static rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-zinc-400" />
      </div>
      <div>
        <p className="text-lg font-semibold text-white">{value}</p>
        <p className="text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  );
}

// ── All Mode Dashboard ──────────────────────────────────────────────────────

function AllDashboard({ data, lng }: { data: DashboardData; lng: string }) {
  const { t } = useTranslation();
  const { setCreator, creators } = useCreatorWorkspace();

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard icon={FolderOpen} value={data.stats.completed_projects} label={t("dashboard.totalProjects")} />
        <StatCard icon={Film} value={data.stats.total_exports} label={t("dashboard.totalExports")} />
        <StatCard icon={Users} value={data.stats.total_creators} label={t("dashboard.totalCreators")} />
        <StatCard icon={BarChart3} value={data.stats.total_projects} label={t("dashboard.totalAnalyses")} />
      </div>

      {/* Top Creators */}
      {data.top_creators && data.top_creators.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-300">{t("dashboard.topCreators")}</h2>
            <Link to="/creators" className="text-xs text-zinc-500 hover:text-white flex items-center gap-1 transition-colors">
              {t("dashboard.seeAll")} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {data.top_creators.map((c) => {
              const full = creators.find((cr) => cr.id === c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => { if (full) { setCreator(full); } }}
                  className="surface-static rounded-xl p-4 flex flex-col items-center gap-2 min-w-[120px] hover:bg-white/[0.03] transition-colors cursor-pointer shrink-0"
                >
                  {c.thumbnail ? (
                    <img src={c.thumbnail} alt="" className="w-12 h-12 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-white/[0.06] flex items-center justify-center">
                      <Users className="w-5 h-5 text-zinc-600" />
                    </div>
                  )}
                  <span className="text-xs font-medium text-zinc-300 truncate max-w-[100px]">{c.display_name}</span>
                  <span className="text-[11px] text-zinc-600">{c.vod_count} VODs</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Latest Projects */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-300">{t("dashboard.latestProjects")}</h2>
          <Link to="/projects" className="text-xs text-zinc-500 hover:text-white flex items-center gap-1 transition-colors">
            {t("dashboard.seeAll")} <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {data.latest_projects.length > 0 ? (
          <div className="surface-static rounded-xl overflow-hidden divide-y divide-white/[0.04]">
            {data.latest_projects.map((p) => (
              <Link
                key={p.id}
                to={`/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
              >
                {p.streamer_thumbnail ? (
                  <img src={p.streamer_thumbnail} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded-full shrink-0 bg-white/[0.06] flex items-center justify-center">
                    <Users className="w-3.5 h-3.5 text-zinc-600" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-300 truncate">{p.vod_title || "Untitled VOD"}</p>
                  <div className="text-[11px] text-zinc-500 flex items-center gap-2">
                    {p.streamer && <span>{p.streamer}</span>}
                    {p.vod_game && (
                      <span className="flex items-center gap-1">
                        <Gamepad2 className="w-2.5 h-2.5" /> {p.vod_game}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-[11px] text-zinc-600 shrink-0">{formatDate(p.created_at, lng)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">{t("dashboard.noData")}</p>
        )}
      </section>

      {/* Latest Exports */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-300">{t("dashboard.latestExports")}</h2>
          <Link to="/exports" className="text-xs text-zinc-500 hover:text-white flex items-center gap-1 transition-colors">
            {t("dashboard.seeAll")} <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {data.latest_exports.length > 0 ? (
          <div className="surface-static rounded-xl overflow-hidden divide-y divide-white/[0.04]">
            {data.latest_exports.map((e) => (
              <div key={e.render_id} className="flex items-center gap-3 px-4 py-3">
                <Film className="w-4 h-4 text-zinc-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-300 truncate">{e.clip_name || e.vod_title || "Export"}</p>
                  <p className="text-[11px] text-zinc-500">{e.vod_game}</p>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                  e.status === "done" ? "bg-emerald-500/10 text-emerald-400" :
                  e.status === "error" ? "bg-red-500/10 text-red-400" :
                  "bg-white/[0.06] text-zinc-400"
                }`}>{e.status}</span>
                <span className="text-[11px] text-zinc-600 shrink-0">{formatDate(e.created_at, lng)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">{t("dashboard.noData")}</p>
        )}
      </section>
    </>
  );
}

// ── Creator Mode Dashboard ──────────────────────────────────────────────────

function CreatorDashboard({ data, lng }: { data: DashboardData; lng: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!data.creator) return null;

  return (
    <>
      {/* Creator header */}
      <div className="flex items-center gap-4 mb-8">
        {data.creator.thumbnail ? (
          <img src={data.creator.thumbnail} alt="" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-white/[0.06] flex items-center justify-center">
            <Users className="w-7 h-7 text-zinc-600" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold text-white">{data.creator.display_name}</h1>
          <p className="text-sm text-zinc-500">@{data.creator.login}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard icon={FolderOpen} value={data.stats.completed_projects} label={t("dashboard.totalProjects")} />
        <StatCard icon={Film} value={data.stats.total_exports} label={t("dashboard.totalExports")} />
        <StatCard icon={Gamepad2} value={data.stats.total_games} label={t("dashboard.totalGames")} />
        <StatCard icon={Eye} value={formatNumber(data.stats.avg_views)} label={t("dashboard.avgViews")} />
      </div>

      {/* Top Games */}
      {data.top_games && data.top_games.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-300">{t("dashboard.topGames")}</h2>
            <Link to="/games" className="text-xs text-zinc-500 hover:text-white flex items-center gap-1 transition-colors">
              {t("dashboard.seeAll")} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {data.top_games.map((g) => (
              <button
                key={g.name}
                onClick={() => navigate(`/projects?game=${encodeURIComponent(g.name)}`)}
                className="surface-static rounded-xl p-3 flex items-center gap-3 min-w-[200px] hover:bg-white/[0.03] transition-colors cursor-pointer shrink-0"
              >
                {g.thumbnail ? (
                  <img src={g.thumbnail} alt="" className="w-10 h-[54px] rounded-md object-cover shrink-0" loading="lazy" />
                ) : (
                  <div className="w-10 h-[54px] rounded-md bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Gamepad2 className="w-4 h-4 text-zinc-600" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-300 truncate">{g.name}</p>
                  <p className="text-[11px] text-zinc-500">{g.vod_count} VODs</p>
                  <p className="text-[11px] text-zinc-600">{formatNumber(g.avg_views)} {t("dashboard.avgViews")}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Latest Projects */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-300">{t("dashboard.latestProjects")}</h2>
          <Link to="/projects" className="text-xs text-zinc-500 hover:text-white flex items-center gap-1 transition-colors">
            {t("dashboard.seeAll")} <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {data.latest_projects.length > 0 ? (
          <div className="surface-static rounded-xl overflow-hidden divide-y divide-white/[0.04]">
            {data.latest_projects.map((p) => (
              <Link
                key={p.id}
                to={`/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-300 truncate">{p.vod_title || "Untitled VOD"}</p>
                  {p.vod_game && (
                    <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <Gamepad2 className="w-2.5 h-2.5" /> {p.vod_game}
                    </p>
                  )}
                </div>
                <span className="text-[11px] text-zinc-600 shrink-0">{formatDate(p.created_at, lng)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">{t("dashboard.noData")}</p>
        )}
      </section>

      {/* Latest Exports */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-300">{t("dashboard.latestExports")}</h2>
          <Link to="/exports" className="text-xs text-zinc-500 hover:text-white flex items-center gap-1 transition-colors">
            {t("dashboard.seeAll")} <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {data.latest_exports.length > 0 ? (
          <div className="surface-static rounded-xl overflow-hidden divide-y divide-white/[0.04]">
            {data.latest_exports.map((e) => (
              <div key={e.render_id} className="flex items-center gap-3 px-4 py-3">
                <Film className="w-4 h-4 text-zinc-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-300 truncate">{e.clip_name || e.vod_title || "Export"}</p>
                  <p className="text-[11px] text-zinc-500">{e.vod_game}</p>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                  e.status === "done" ? "bg-emerald-500/10 text-emerald-400" :
                  e.status === "error" ? "bg-red-500/10 text-red-400" :
                  "bg-white/[0.06] text-zinc-400"
                }`}>{e.status}</span>
                <span className="text-[11px] text-zinc-600 shrink-0">{formatDate(e.created_at, lng)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">{t("dashboard.noData")}</p>
        )}
      </section>
    </>
  );
}

// ── Main HomePage ───────────────────────────────────────────────────────────

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const { creator, isAllMode } = useCreatorWorkspace();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getDashboard(creator?.id)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [creator?.id]);

  return (
    <div className="animate-fade-in">
      {/* Header (all mode only) */}
      {isAllMode && (
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white tracking-tight">{t("dashboard.welcomeBack")}</h1>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      ) : !data ? (
        <div className="text-center py-20">
          <BarChart3 className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">{t("dashboard.noData")}</p>
          <p className="text-xs text-zinc-600 mt-1">{t("dashboard.noDataHint")}</p>
        </div>
      ) : isAllMode ? (
        <AllDashboard data={data} lng={i18n.language} />
      ) : (
        <CreatorDashboard data={data} lng={i18n.language} />
      )}
    </div>
  );
}
