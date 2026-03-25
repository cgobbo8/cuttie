<script lang="ts">
  import { listJobs, type JobSummary } from "../api";

  let { onSelect, onRetry }: { onSelect: (jobId: string) => void; onRetry?: (jobId: string) => void } = $props();

  let jobs = $state<JobSummary[]>([]);
  let loading = $state(true);

  $effect(() => {
    loadJobs();
  });

  async function loadJobs() {
    loading = true;
    try {
      jobs = await listJobs();
    } catch {
      jobs = [];
    }
    loading = false;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return "";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}min`;
  }

  const STATUS_COLORS: Record<string, string> = {
    DONE: "text-green-400",
    ERROR: "text-red-400",
  };
</script>

{#if loading}
  <p class="text-zinc-500 text-center">Chargement...</p>
{:else if jobs.length === 0}
  <p class="text-zinc-500 text-center text-sm">Aucune analyse precedente</p>
{:else}
  <div class="space-y-2">
    <h3 class="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-3">
      Analyses precedentes
    </h3>
    {#each jobs as job}
      <button
        class="w-full text-left p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/30 hover:border-purple-500/30 transition-colors"
        onclick={() => onSelect(job.job_id)}
        disabled={job.status !== "DONE" && job.status !== "ERROR"}
      >
        <div class="flex items-center justify-between">
          <div class="min-w-0 flex-1">
            <p class="text-sm text-white truncate">
              {job.vod_title || "VOD sans titre"}
            </p>
            <p class="text-xs text-zinc-500 mt-0.5">
              {formatDate(job.created_at)}
              {#if job.vod_duration_seconds}
                <span class="ml-2">{formatDuration(job.vod_duration_seconds)}</span>
              {/if}
            </p>
          </div>
          {#if job.status === "ERROR" && onRetry}
            <button
              class="text-xs ml-3 text-orange-400 hover:text-orange-300 cursor-pointer"
              onclick={(e: MouseEvent) => { e.stopPropagation(); onRetry?.(job.job_id); }}
            >
              Reprendre
            </button>
          {:else}
            <span class="text-xs ml-3 {STATUS_COLORS[job.status] || 'text-zinc-500'}">
              {job.status === "DONE" ? "Voir" : job.status}
            </span>
          {/if}
        </div>
      </button>
    {/each}
  </div>
{/if}
