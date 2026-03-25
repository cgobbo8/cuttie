<script lang="ts">
  import { getJobStatus, type JobResponse, type JobStatus } from "../api";

  let {
    jobId,
    onComplete,
  }: {
    jobId: string;
    onComplete: (job: JobResponse) => void;
  } = $props();

  let status = $state<JobStatus>("PENDING");
  let progress = $state("Starting...");

  const STATUS_LABELS: Record<JobStatus, string> = {
    PENDING: "En attente...",
    DOWNLOADING_AUDIO: "Telechargement de l'audio...",
    DOWNLOADING_CHAT: "Telechargement du chat...",
    ANALYZING_AUDIO: "Analyse audio en cours...",
    ANALYZING_CHAT: "Analyse du chat...",
    SCORING: "Calcul des scores...",
    TRIAGE: "Pre-analyse LLM...",
    CLIPPING: "Extraction des clips...",
    VERTICAL: "Generation des clips verticaux...",
    TRANSCRIBING: "Transcription des clips...",
    LLM_ANALYSIS: "Analyse LLM en cours...",
    DONE: "Terminé !",
    ERROR: "Erreur",
  };

  const STATUS_ORDER: JobStatus[] = [
    "PENDING",
    "DOWNLOADING_AUDIO",
    "DOWNLOADING_CHAT",
    "ANALYZING_AUDIO",
    "ANALYZING_CHAT",
    "SCORING",
    "TRIAGE",
    "CLIPPING",
    "VERTICAL",
    "TRANSCRIBING",
    "LLM_ANALYSIS",
    "DONE",
  ];

  let progressPct = $derived(() => {
    const idx = STATUS_ORDER.indexOf(status);
    if (idx < 0) return 0;
    return Math.round((idx / (STATUS_ORDER.length - 1)) * 100);
  });

  $effect(() => {
    const interval = setInterval(async () => {
      try {
        const job = await getJobStatus(jobId);
        status = job.status;
        progress = job.progress || STATUS_LABELS[job.status];

        if (job.status === "DONE" || job.status === "ERROR") {
          clearInterval(interval);
          onComplete(job);
        }
      } catch {
        // Network error — keep polling
      }
    }, 2000);

    return () => clearInterval(interval);
  });
</script>

<div class="w-full max-w-2xl mx-auto text-center">
  <div class="mb-6">
    <div class="inline-block animate-spin text-purple-400 text-3xl mb-4">&#9696;</div>
    <p class="text-lg text-zinc-300">{progress}</p>
    <p class="text-sm text-zinc-500 mt-1">{STATUS_LABELS[status]}</p>
  </div>

  <!-- Progress bar -->
  <div class="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
    <div
      class="bg-purple-500 h-full rounded-full transition-all duration-500"
      style="width: {progressPct()}%"
    ></div>
  </div>

  <!-- Step indicators -->
  <div class="flex justify-between mt-3 text-xs text-zinc-600">
    {#each STATUS_ORDER.slice(1, -1) as step}
      <span
        class={STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf(step)
          ? "text-purple-400"
          : ""}
      >
        {STATUS_LABELS[step].replace("...", "")}
      </span>
    {/each}
  </div>
</div>
