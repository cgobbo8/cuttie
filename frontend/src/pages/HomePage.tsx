import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, ExternalLink, Link2, Loader2, Sparkles } from "lucide-react";
import {
  clipThumbUrl,
  listJobs,
  submitVod,
  type HotPoint,
  type JobResponse,
  type JobSummary,
  type TwitchVod,
} from "../lib/api";
import { useChannel } from "../lib/ChannelContext";
import { useLatestMoments } from "../lib/useLatestMoment";
import { useToast } from "../components/Toast";
import Storyboard from "../components/Storyboard";
import TemplatePreview, { useDefaultTemplate } from "../components/TemplatePreview";
import ProviderFix, { providerNotice } from "../components/ProviderFix";
import { ACTIVE_STATUSES, analysisProgress, clock, hoursMinutes, liveDate, sampleSubtitle, shortDate, splitVodTitle } from "../lib/format";

const HERO_HEIGHT = 700;

function useAnalyze() {
  const { t } = useTranslation();
  const toast = useToast();
  const { refreshChannel } = useChannel();
  const [busy, setBusy] = useState<string | null>(null);

  const analyze = useCallback(
    async (url: string, key: string) => {
      setBusy(key);
      try {
        await submitVod(url);
        toast.success(t("start.analysisStarted"));
        await refreshChannel();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("analyze.submitError"));
      } finally {
        setBusy(null);
      }
    },
    [refreshChannel, t, toast],
  );
  return { analyze, busy };
}

// ── Hero: the latest live ──────────────────────────────────────────────────

function Hero({ vod, busy, onAnalyze }: { vod: TwitchVod; busy: boolean; onAnalyze: () => void }) {
  const { t, i18n } = useTranslation();
  const { tag, title } = splitVodTitle(vod.title);
  const job = vod.job;
  const running = job && ACTIVE_STATUSES.has(job.status);
  const progress = running ? analysisProgress(job.status, job.progress) : null;
  const isNew = Date.now() - new Date(vod.published_at).getTime() < 2 * 86_400_000;
  // Stopped because the AI provider refuses every call (no credits, refused key)
  const stopped = job?.status === "ERROR" ? providerNotice(job.notices) : undefined;

  return (
    <div className="glass-strong rounded-[20px] w-[560px] max-w-full px-7 pt-[26px] pb-6 animate-rise">
      <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink-2">
        {job?.status === "DONE" ? (
          <span className="chip chip-accent">
            <Check className="w-3.5 h-3.5" strokeWidth={3} /> {t("start.momentsFound", { count: job.clip_count })}
          </span>
        ) : running ? (
          <span className="chip chip-accent">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("start.analyzing")}
          </span>
        ) : job?.status === "ERROR" ? (
          <span className="chip chip-danger">{t("start.failed")}</span>
        ) : vod.recording ? (
          <span className="chip chip-danger">
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> {t("start.liveNow")}
          </span>
        ) : isNew ? (
          <span className="chip chip-accent">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> {t("start.newLive")}
          </span>
        ) : null}
        <span>
          {t("start.latestLive")} · {liveDate(vod.published_at, i18n.language)}
        </span>
      </div>

      <h1 className="mt-4 text-[48px] leading-[1.02] tracking-[-0.035em] font-[650] text-white [text-wrap:balance]">{title}</h1>

      <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-2">
        <span className="tabular-nums">{hoursMinutes(vod.duration_seconds)}</span>
        {vod.game && (
          <>
            <span aria-hidden className="opacity-50">·</span>
            <span>{vod.game}</span>
          </>
        )}
        {tag && <span className="chip chip-neutral h-[22px] font-[550]">{tag}</span>}
      </div>

      {progress && (
        <div className="mt-5">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-accent shadow-[0_0_12px_var(--color-accent-glow)] transition-[width] duration-700" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">
            {t(`jobStatus.${job!.status}`)} · {t("start.minutesLeft", { minutes: progress.minutesLeft })}
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2.5">
        {job && job.status !== "ERROR" ? (
          <Link to={`/${job.id}`} className="btn btn-primary btn-lg">
            {job.status === "DONE" ? t("start.sortMoments") : t("start.seeAnalysis")}
            <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
          </Link>
        ) : vod.recording ? (
          <button disabled className="btn btn-primary btn-lg">
            <Sparkles className="w-4 h-4" /> {t("start.afterLive")}
          </button>
        ) : (
          <button onClick={onAnalyze} disabled={busy} className="btn btn-primary btn-lg">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {job?.status === "ERROR" ? t("start.retry") : t("start.findMoments")}
          </button>
        )}
        <a href={vod.url} target="_blank" rel="noreferrer" className="btn btn-glass btn-lg">
          {t("start.viewOnTwitch")}
          <ExternalLink className="w-[15px] h-[15px]" />
        </a>
      </div>
      {!job && <p className="mt-3.5 text-[12.5px] text-ink-3">{t(vod.recording ? "start.liveHint" : "start.estimate")}</p>}
      {job?.status === "ERROR" && (job.error || stopped) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-[220px] text-[13px] leading-snug text-red-200">{stopped ? t(`job.provider.${stopped.reason}`) : job.error}</p>
          {stopped && <ProviderFix notice={stopped} />}
        </div>
      )}
    </div>
  );
}

// ── Recent lives ───────────────────────────────────────────────────────────

function LiveCard({ vod, index, busy, onAnalyze }: { vod: TwitchVod; index: number; busy: boolean; onAnalyze: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { title } = splitVodTitle(vod.title);
  const job = vod.job;
  const running = job && ACTIVE_STATUSES.has(job.status);
  const progress = running ? analysisProgress(job.status, job.progress) : null;
  const open = job && job.status !== "ERROR" ? () => navigate(`/${job.id}`) : null;

  return (
    <article className="group flex flex-col gap-2.5 animate-rise" style={{ "--i": index } as CSSProperties}>
      <div
        className={`relative aspect-video rounded-[14px] overflow-hidden border border-white/[0.08] bg-white/[0.04] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-[3px] ${open ? "cursor-pointer" : ""}`}
        onClick={open ?? undefined}
      >
        {vod.thumbnail_url ? (
          <img src={vod.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center px-4 text-center text-[12px] text-ink-3">{t("start.processing")}</div>
        )}
        {running && <div className="absolute inset-0 bg-black/35" />}

        <span className="absolute top-2 left-2 chip glass-chip text-white">
          {job?.status === "DONE" ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-accent" /> {t("start.momentsToSort", { count: job.clip_count })}
            </>
          ) : running ? (
            <>
              {t("start.analyzing")} · <span className="mono">{progress!.percent} %</span>
            </>
          ) : job?.status === "ERROR" ? (
            <span className="text-red-300">{t("start.failed")}</span>
          ) : (
            <span className="text-ink-2 font-[550]">{t("start.toAnalyze")}</span>
          )}
        </span>

        {!running && (
          <span className="mono absolute bottom-2 right-2 h-5 px-1.5 rounded-[5px] flex items-center bg-black/70 text-[11px] text-white">
            {clock(vod.duration_seconds)}
          </span>
        )}
        {progress && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-accent shadow-[0_0_12px_var(--color-accent-glow)] transition-[width] duration-700" style={{ width: `${progress.percent}%` }} />
          </div>
        )}

        {(!job || job.status === "ERROR") && vod.thumbnail_url && (
          <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <button onClick={onAnalyze} disabled={busy} className="btn btn-primary btn-sm">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {job ? t("start.retry") : t("start.analyze")}
            </button>
          </div>
        )}
      </div>
      <div>
        <h3 className="text-[14.5px] font-[550] leading-snug tracking-[-0.01em] text-white line-clamp-2">
          {open ? (
            <Link to={`/${job!.id}`} className="hover:underline underline-offset-2">
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          {shortDate(vod.published_at, i18n.language)} ·{" "}
          {progress ? t("start.minutesLeft", { minutes: progress.minutesLeft }) : t("start.views", { count: vod.view_count })}
        </p>
      </div>
    </article>
  );
}

function PasteLink() {
  const { t } = useTranslation();
  const { analyze, busy } = useAnalyze();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/twitch\.tv\/videos\/\d+/.test(url)) {
      setError(t("analyze.invalidUrl"));
      return;
    }
    analyze(url.trim(), "url").then(() => {
      setUrl("");
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-glass btn-sm">
        <Link2 className="w-[15px] h-[15px]" /> {t("start.pasteLink")}
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col items-end gap-1">
      <div className="glass flex items-center gap-2 pl-3 pr-1 h-10 rounded-[11px] w-[420px] max-w-[80vw]">
        <Link2 className="w-[15px] h-[15px] text-ink-3 shrink-0" />
        <input
          autoFocus
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder={t("start.pastePlaceholder")}
          aria-label={t("start.pasteLink")}
          className="flex-1 min-w-0 bg-transparent text-[13.5px] text-white placeholder:text-ink-4 outline-none"
        />
        <button type="submit" disabled={busy === "url"} className="btn btn-primary btn-sm">
          {busy === "url" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {t("start.analyze")}
        </button>
      </div>
      {error && <p className="text-[12.5px] text-red-300">{error}</p>}
    </form>
  );
}

// ── Resume + template ──────────────────────────────────────────────────────

function ResumeCard({ job, hotPoints }: { job: JobResponse; hotPoints: HotPoint[] }) {
  const { t } = useTranslation();
  const { title } = splitVodTitle(job.custom_title || job.vod_title);
  const top = hotPoints.slice(0, 5);
  const more = hotPoints.length - 4;

  return (
    <article className="glass rounded-[18px] p-[18px] flex flex-wrap gap-[22px] flex-[2_1_600px] min-w-0">
      <div className="grid grid-cols-[2fr_1fr_1fr] grid-rows-2 gap-2 h-[196px] flex-[1_1_380px] min-w-0">
        {top.map((hp, i) => (
          <div key={hp.clip_filename} className={`relative overflow-hidden bg-white/5 ${i === 0 ? "row-span-2 rounded-[11px]" : "rounded-[9px]"}`}>
            <img src={clipThumbUrl(job.job_id, hp.clip_filename!)} alt="" loading="lazy" className="w-full h-full object-cover" />
            {i === 0 && hp.final_score !== null && (
              <span className="mono absolute top-2 left-2 chip bg-accent text-accent-ink h-[22px] px-[7px]">{Math.round(hp.final_score * 100)}</span>
            )}
            {i === 4 && more > 0 && (
              <div className="absolute inset-0 grid place-items-center bg-black/55 text-[13px] font-semibold text-white">+{more}</div>
            )}
          </div>
        ))}
      </div>
      <div className="flex-[1_1_260px] min-w-0 flex flex-col">
        <div className="text-[12.5px] font-medium text-ink-3">{t("start.resume")}</div>
        <h3 className="mt-1.5 text-[22px] font-semibold tracking-[-0.025em] leading-[1.15] text-white">{title}</h3>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          {t("start.resumeText", { count: hotPoints.length, best: hotPoints[0]?.clip_name ?? "" })}
        </p>
        <div className="mt-auto pt-4">
          <div className="flex gap-1">
            <span className="flex-1 h-1 rounded-full bg-accent" />
            <span className="flex-1 h-1 rounded-full bg-white/30" />
            <span className="flex-1 h-1 rounded-full bg-white/10" />
            <span className="flex-1 h-1 rounded-full bg-white/10" />
          </div>
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink-3">{t("start.step", { n: 2, name: t("start.stepChoose") })}</span>
            <Link to={`/${job.job_id}`} className="btn btn-primary">
              {t("start.sortMoments")} <ArrowRight className="w-[15px] h-[15px]" strokeWidth={2.2} />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function TemplateCard({ job, best }: { job: JobResponse | null; best: HotPoint | null }) {
  const { t } = useTranslation();
  const { kit, channel } = useChannel();
  const template = useDefaultTemplate(kit);
  if (!kit) return null;
  const subtitle = sampleSubtitle(best?.llm?.transcript);

  return (
    <article className="glass rounded-[18px] p-[18px] flex gap-[18px] items-center flex-[1_1_320px] min-w-0">
      <TemplatePreview
        className="w-[112px] flex-none rounded-[12px] border border-white/10 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.8)]"
        kit={kit}
        templateKey={template.key}
        frameUrl={job && best?.clip_filename ? clipThumbUrl(job.job_id, best.clip_filename) : null}
        avatarUrl={channel?.avatar_url ?? null}
        login={channel?.login ?? kit.twitch_login}
        displayName={channel?.display_name}
        followers={channel?.followers}
        sample={subtitle.lines.flat()}
        hook={best?.llm?.hook || best?.clip_name || t("templateEditor.sampleHook")}
      />
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-ink-3">{t("start.yourTemplate")}</div>
        <div className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-white truncate">{template.name}</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{kit.facecam === null ? t("start.confirmCam") : template.desc}</p>
        <Link to="/chaine" className="btn btn-glass btn-sm mt-3.5">
          {t("start.tuneBrand")}
        </Link>
      </div>
    </article>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { t } = useTranslation();
  const { channel, channelError, refreshChannel } = useChannel();
  const { analyze, busy } = useAnalyze();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  const loadJobs = useCallback(() => {
    listJobs({ per_page: 12 })
      .then((page) => setJobs(page.data))
      .catch(() => setJobs([]));
  }, []);
  useEffect(loadJobs, [loadJobs]);

  // The latest finished analysis, to pick up where the streamer left off
  const resume = useLatestMoments(jobs?.find((j) => j.status === "DONE")?.job_id);

  // Keep progress fresh while something is being analyzed
  const hasActive =
    (channel?.vods.some((v) => v.job && ACTIVE_STATUSES.has(v.job.status)) ?? false) ||
    (jobs?.some((j) => ACTIVE_STATUSES.has(j.status)) ?? false);
  useEffect(() => {
    if (!hasActive) return;
    const id = window.setInterval(() => {
      refreshChannel();
      loadJobs();
    }, 4000);
    return () => window.clearInterval(id);
  }, [hasActive, refreshChannel, loadJobs]);

  const [latest, ...others] = channel?.vods ?? [];
  const heroImage = latest?.thumbnail_large_url ?? latest?.thumbnail_url ?? channel?.banner_url ?? null;
  const best = resume?.hotPoints[0] ?? null;

  const otherActive = useMemo(() => {
    const vodJobIds = new Set(channel?.vods.map((v) => v.job?.id).filter(Boolean));
    return (jobs ?? []).filter((j) => ACTIVE_STATUSES.has(j.status) && !vodJobIds.has(j.job_id));
  }, [channel, jobs]);

  return (
    <div className="relative">
      {/* Hero image: sharp at the top, fading into the blurred backdrop */}
      {heroImage && (
        <div
          className="absolute inset-x-0 top-0 overflow-hidden pointer-events-none [mask-image:linear-gradient(180deg,#000_52%,transparent_100%)]"
          style={{ height: HERO_HEIGHT }}
        >
          <img src={heroImage} alt="" className="w-full h-full object-cover object-[50%_30%]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,11,12,0.72)_0%,rgba(11,11,12,0.28)_42%,rgba(11,11,12,0)_68%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,11,12,0.5)_0%,rgba(11,11,12,0)_20%)]" />
        </div>
      )}

      <div className="relative max-w-[1320px] mx-auto px-8 pb-14">
        <section className="pt-[230px]">
          {channel === undefined ? (
            <div className="glass-strong rounded-[20px] w-[560px] max-w-full h-[300px] skeleton" />
          ) : latest ? (
            <>
              <Hero vod={latest} busy={busy === latest.id} onAnalyze={() => analyze(latest.url, latest.id)} />
              <Storyboard className="mt-[18px]" vodId={latest.id} durationSeconds={latest.duration_seconds} />
            </>
          ) : (
            <div className="glass-strong rounded-[20px] w-[560px] max-w-full p-7">
              <h1 className="title-large">{t("start.noChannelTitle")}</h1>
              <p className="mt-2 text-[14.5px] text-ink-2">{channelError ? t("start.twitchError") : t("start.noChannelText")}</p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Link to="/chaine" className="btn btn-primary btn-lg">{t("start.setChannel")}</Link>
                <PasteLink />
              </div>
            </div>
          )}
        </section>

        {otherActive.length > 0 && (
          <section className="mt-6 flex flex-col gap-2">
            {otherActive.map((job) => {
              const p = analysisProgress(job.status);
              return (
                <Link key={job.job_id} to={`/${job.job_id}`} className="glass rounded-[14px] px-4 py-3 flex items-center gap-4 hover:bg-white/[0.06] transition-colors">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span className="flex-1 min-w-0 truncate text-[14px] text-white">{splitVodTitle(job.vod_title).title || job.url}</span>
                  <span className="mono text-[12.5px] text-ink-3">{p.percent} %</span>
                </Link>
              );
            })}
          </section>
        )}

        {others.length > 0 && (
          <section className="mt-11">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">{t("start.yourLives")}</h2>
              <PasteLink />
            </div>
            <div className="grid gap-[18px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
              {others.slice(0, 10).map((vod, i) => (
                <LiveCard key={vod.id} vod={vod} index={i} busy={busy === vod.id} onAnalyze={() => analyze(vod.url, vod.id)} />
              ))}
            </div>
          </section>
        )}

        {(resume || channel) && (
          <section className="mt-11 flex flex-wrap gap-[18px]">
            {resume && resume.hotPoints.length > 0 && <ResumeCard job={resume.job} hotPoints={resume.hotPoints} />}
            <TemplateCard job={resume?.job ?? null} best={best} />
          </section>
        )}
      </div>
    </div>
  );
}
