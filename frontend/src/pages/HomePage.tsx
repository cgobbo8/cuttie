import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Link2, Loader2, Play, Sparkles } from "lucide-react";
import {
  getTwitchChannel,
  listJobs,
  submitVod,
  type JobSummary,
  type TwitchChannel,
  type TwitchVod,
} from "../lib/api";
import { useToast } from "../components/Toast";

const ACTIVE = new Set(["PENDING", "DOWNLOADING_AUDIO", "DOWNLOADING_CHAT", "ANALYZING_AUDIO", "ANALYZING_CHAT", "SCORING", "ANALYZING_CLIPS", "CLIPPING", "LLM_ANALYSIS"]);

/** Pipeline steps in order, with rough durations (minutes) measured on a 5 h VOD */
const STEPS = [
  { status: "DOWNLOADING_AUDIO", minutes: 1 },
  { status: "ANALYZING_AUDIO", minutes: 1 },
  { status: "SCORING", minutes: 0.2 },
  { status: "ANALYZING_CLIPS", minutes: 3 },
  { status: "CLIPPING", minutes: 1 },
];

function stepIndex(status: string): number {
  if (status === "DOWNLOADING_CHAT") return 0;
  if (status === "ANALYZING_CHAT") return 1;
  const i = STEPS.findIndex((s) => s.status === status);
  return i === -1 ? 0 : i;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

function vodIdFromUrl(url: string): string | null {
  return url.match(/videos\/(\d+)/)?.[1] ?? null;
}

function useRelativeDate() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
    return (iso: string) => {
      const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
      if (days > -1) {
        const hours = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
        return rtf.format(hours, "hour");
      }
      return days > -7 ? rtf.format(days, "day") : new Date(iso).toLocaleDateString(i18n.language, { day: "numeric", month: "short" });
    };
  }, [i18n.language]);
}

// ── In-progress analysis ────────────────────────────────────────────────────

function ProgressCard({ job, thumbnail }: { job: JobSummary; thumbnail?: string | null }) {
  const { t } = useTranslation();
  const current = stepIndex(job.status);
  const remaining = STEPS.slice(current).reduce((sum, s) => sum + s.minutes, 0);
  const percent = Math.max(4, Math.round((STEPS.slice(0, current).reduce((s, x) => s + x.minutes, 0) / STEPS.reduce((s, x) => s + x.minutes, 0)) * 100));

  return (
    <Link to={`/${job.job_id}`} className="glass rounded-[24px] p-4 flex gap-4 items-center hover:bg-white/[0.04] transition-colors">
      <div className="w-36 aspect-video rounded-[14px] overflow-hidden bg-white/[0.04] shrink-0">
        {thumbnail && <img src={thumbnail} alt="" className="w-full h-full object-cover" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[13px] text-brand-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t(`jobStatus.${job.status}`)}
          <span className="text-zinc-500">· {t("analyze.remaining", { minutes: Math.max(1, Math.round(remaining)) })}</span>
        </div>
        <p className="text-[15px] font-medium text-white truncate mt-1">{job.custom_title || job.vod_title || t("home.untitledVod")}</p>
        <div className="mt-3 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
          <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex gap-3 text-[12px] text-zinc-500">
          {STEPS.map((s, i) => (
            <span key={s.status} className={i < current ? "text-zinc-300" : i === current ? "text-white" : ""}>
              {i < current ? "✓ " : ""}
              {t(`analyze.steps.${s.status}`)}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

// ── VOD card ────────────────────────────────────────────────────────────────

function VodCard({ vod, index, busy, onAnalyze }: { vod: TwitchVod; index: number; busy: boolean; onAnalyze: () => void }) {
  const { t } = useTranslation();
  const relative = useRelativeDate();
  const job = vod.job;
  const running = job && ACTIVE.has(job.status);

  return (
    <article className="group glass rounded-[24px] overflow-hidden animate-rise flex flex-col" style={{ "--i": index } as CSSProperties}>
      <div className="relative aspect-video overflow-hidden bg-white/[0.03]">
        {vod.thumbnail_url ? (
          <img src={vod.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]" />
        ) : (
          <div className="w-full h-full grid place-items-center text-[12px] text-zinc-500">{t("analyze.processing")}</div>
        )}
        <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md text-[12px] font-medium text-white tabular-nums">
          {formatDuration(vod.duration_seconds)}
        </span>
        {job?.status === "DONE" && (
          <span className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md text-[12px] text-brand-2">
            <CheckCircle2 className="w-3.5 h-3.5" /> {t("analyze.clipCount", { count: job.clip_count })}
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1">
        <h3 className="text-[15px] font-medium leading-snug text-white line-clamp-2">{vod.title}</h3>
        <p className="mt-1 text-[13px] text-zinc-400">
          {relative(vod.published_at)}
          {vod.game ? ` · ${vod.game}` : ""}
        </p>
        <div className="mt-auto pt-4">
          {job && job.status === "DONE" ? (
            <Link to={`/${job.id}`} className="btn btn-glass btn-sm">
              {t("analyze.openClips")} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : running ? (
            <Link to={`/${job.id}`} className="btn btn-glass btn-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("analyze.inProgress")}
            </Link>
          ) : (
            <button onClick={onAnalyze} disabled={busy} className="btn btn-primary btn-sm">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {job?.status === "ERROR" ? t("analyze.retry") : t("analyze.analyze")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function VodSkeleton() {
  return (
    <div className="glass rounded-[24px] overflow-hidden">
      <div className="aspect-video skeleton" />
      <div className="p-4 space-y-2">
        <div className="h-4 rounded-full skeleton w-4/5" />
        <div className="h-3 rounded-full skeleton w-2/5" />
        <div className="h-8 rounded-full skeleton w-28 mt-4" />
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const showError = toast.error;
  const relative = useRelativeDate();

  const [channel, setChannel] = useState<TwitchChannel | null | undefined>(undefined);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadJobs = useCallback(() => {
    listJobs({ per_page: 8 })
      .then((page) => setJobs(page.data))
      .catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    getTwitchChannel()
      .then(setChannel)
      .catch((err: Error) => {
        setChannel(null);
        setChannelError(err.message);
      });
    loadJobs();
  }, [loadJobs]);

  // Refresh while an analysis is running
  const hasActive = jobs?.some((j) => ACTIVE.has(j.status)) ?? false;
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(loadJobs, 4000);
    return () => clearInterval(id);
  }, [hasActive, loadJobs]);

  const analyze = async (vodUrl: string, key: string) => {
    setBusy(key);
    try {
      const { job_id } = await submitVod(vodUrl);
      navigate(`/${job_id}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("analyze.submitError"));
      setBusy(null);
    }
  };

  const submitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/twitch\.tv\/videos\/\d+/.test(url)) {
      setUrlError(t("analyze.invalidUrl"));
      return;
    }
    analyze(url.trim(), "url");
  };

  const thumbnailByVod = useMemo(() => {
    const map = new Map<string, string | null>();
    channel?.vods.forEach((v) => map.set(v.id, v.thumbnail_url));
    return map;
  }, [channel]);

  const active = jobs?.filter((j) => ACTIVE.has(j.status)) ?? [];
  const recent = jobs?.filter((j) => !ACTIVE.has(j.status)).slice(0, 6) ?? [];
  const hour = new Date().getHours();

  return (
    <div className="space-y-10 pb-10">
      <header className="animate-rise">
        <p className="text-[15px] text-zinc-400">
          {t(hour < 18 && hour >= 5 ? "analyze.hello" : "analyze.evening", { name: channel?.display_name ?? "" })}
        </p>
        <h1 className="title-large mt-1">{t("analyze.title")}</h1>
        <p className="mt-2 text-[15px] text-zinc-400 max-w-xl">{t("analyze.subtitle")}</p>
      </header>

      {active.length > 0 && (
        <section className="space-y-3">
          {active.map((job) => (
            <ProgressCard key={job.job_id} job={job} thumbnail={thumbnailByVod.get(vodIdFromUrl(job.url) ?? "")} />
          ))}
        </section>
      )}

      <section>
        <div className="flex items-center gap-3 mb-4">
          {channel?.avatar_url && <img src={channel.avatar_url} alt="" className="w-7 h-7 rounded-[9px]" />}
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">{t("analyze.latestVods")}</h2>
        </div>

        {channel === undefined ? (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
            {Array.from({ length: 4 }, (_, i) => <VodSkeleton key={i} />)}
          </div>
        ) : channel && channel.vods.length > 0 ? (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
            {channel.vods.slice(0, 8).map((vod, i) => (
              <VodCard key={vod.id} vod={vod} index={i} busy={busy === vod.id} onAnalyze={() => analyze(vod.url, vod.id)} />
            ))}
          </div>
        ) : (
          <div className="glass rounded-[24px] p-6 flex items-center gap-3 text-[14px] text-zinc-300">
            <AlertCircle className="w-5 h-5 text-zinc-400 shrink-0" />
            {channelError ? t("analyze.twitchError") : t("analyze.noChannel")}
          </div>
        )}
      </section>

      <section>
        <form onSubmit={submitUrl} className="glass rounded-[24px] p-2 pl-5 flex items-center gap-3">
          <Link2 className="w-4 h-4 text-zinc-500 shrink-0" />
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
            placeholder={t("analyze.urlPlaceholder")}
            className="flex-1 min-w-0 bg-transparent text-[15px] text-white placeholder:text-zinc-500 outline-none h-10"
          />
          <button type="submit" disabled={busy === "url"} className="btn btn-glass">
            {busy === "url" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {t("analyze.analyze")}
          </button>
        </form>
        {urlError && <p className="mt-2 ml-5 text-[13px] text-red-400">{urlError}</p>}
      </section>

      {recent.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">{t("analyze.recentAnalyses")}</h2>
            <Link to="/projects" className="text-[14px] text-zinc-400 hover:text-white transition-colors">
              {t("analyze.seeAll")}
            </Link>
          </div>
          <div className="glass rounded-[24px] divide-y divide-white/[0.06] overflow-hidden">
            {recent.map((job) => {
              const thumb = thumbnailByVod.get(vodIdFromUrl(job.url) ?? "");
              return (
                <Link key={job.job_id} to={`/${job.job_id}`} className="flex items-center gap-4 p-3 pr-5 hover:bg-white/[0.04] transition-colors">
                  <div className="w-24 aspect-video rounded-[12px] overflow-hidden bg-white/[0.05] shrink-0">
                    {thumb && <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-white truncate">{job.custom_title || job.vod_title || t("home.untitledVod")}</p>
                    <p className="text-[13px] text-zinc-500 mt-0.5 flex items-center gap-1.5">
                      <Clock3 className="w-3.5 h-3.5" /> {relative(job.created_at)}
                      {job.vod_duration_seconds ? ` · ${formatDuration(job.vod_duration_seconds)}` : ""}
                    </p>
                  </div>
                  {job.status === "ERROR" ? (
                    <span className="text-[12px] px-2.5 py-1 rounded-full bg-red-500/10 text-red-300">{t("status.error")}</span>
                  ) : (
                    <ArrowRight className="w-4 h-4 text-zinc-500" />
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
