<script lang="ts">
  import UrlForm from "./lib/components/UrlForm.svelte";
  import JobStatus from "./lib/components/JobStatus.svelte";
  import HotPoints from "./lib/components/HotPoints.svelte";
  import JobList from "./lib/components/JobList.svelte";
  import { getJobStatus, retryJob, type JobResponse } from "./lib/api";

  let phase = $state<"input" | "processing" | "results" | "error">("input");
  let jobId = $state("");
  let results = $state<JobResponse | null>(null);

  function onSubmit(id: string) {
    jobId = id;
    phase = "processing";
  }

  function onComplete(job: JobResponse) {
    results = job;
    phase = job.status === "DONE" ? "results" : "error";
  }

  function onReset() {
    phase = "input";
    results = null;
    jobId = "";
  }

  async function onSelectJob(id: string) {
    try {
      const job = await getJobStatus(id);
      results = job;
      jobId = id;
      phase = job.status === "DONE" ? "results" : "error";
    } catch {
      // ignore
    }
  }

  async function onRetryJob(id: string) {
    try {
      await retryJob(id);
      jobId = id;
      phase = "processing";
    } catch (e: any) {
      alert(e.message);
    }
  }
</script>

<div class="min-h-screen bg-zinc-900 text-zinc-100">
  <!-- Header -->
  <header class="border-b border-zinc-800 py-6">
    <div class="max-w-5xl mx-auto px-6 flex items-center justify-between">
      <button onclick={onReset} class="hover:opacity-80 transition-opacity">
        <h1 class="text-3xl font-bold">
          <span class="text-purple-400">Cuttie</span>
          <span class="text-zinc-500 font-normal text-lg ml-2">Twitch VOD Clip Finder</span>
        </h1>
      </button>
      {#if phase === "results" || phase === "error"}
        <button
          onclick={onReset}
          class="text-sm text-zinc-500 hover:text-purple-400 transition-colors"
        >
          Nouvelle analyse
        </button>
      {/if}
    </div>
  </header>

  <!-- Main -->
  <main class="max-w-5xl mx-auto px-6 py-12">
    {#if phase === "input"}
      <div class="text-center mb-10">
        <p class="text-zinc-400 text-lg mb-8">
          Colle l'URL d'une VOD Twitch pour detecter les moments forts
        </p>
        <UrlForm {onSubmit} />
      </div>

      <!-- Past analyses -->
      <div class="mt-12 max-w-2xl mx-auto">
        <JobList onSelect={onSelectJob} onRetry={onRetryJob} />
      </div>

    {:else if phase === "processing"}
      <JobStatus {jobId} {onComplete} />

    {:else if phase === "results" && results?.hot_points}
      <HotPoints
        hotPoints={results.hot_points}
        vodTitle={results.vod_title || "VOD"}
        vodGame={results.vod_game || ""}
        vodDuration={results.vod_duration_seconds || 0}
        jobId={results.job_id}
      />

    {:else if phase === "error"}
      <div class="text-center">
        <p class="text-red-400 text-lg mb-4">
          {results?.error || "Une erreur est survenue"}
        </p>
        <div class="flex gap-3 justify-center">
          <button
            onclick={async () => {
              if (!results) return;
              try {
                await retryJob(results.job_id);
                jobId = results.job_id;
                phase = "processing";
              } catch (e: any) {
                alert(e.message);
              }
            }}
            class="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
          >
            Reprendre l'analyse
          </button>
          <button
            onclick={onReset}
            class="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
          >
            Nouvelle analyse
          </button>
        </div>
      </div>
    {/if}
  </main>
</div>
