<script lang="ts">
  import { submitVod } from "../api";

  let { onSubmit }: { onSubmit: (jobId: string) => void } = $props();

  let url = $state("");
  let loading = $state(false);
  let error = $state("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = "";

    if (!url.includes("twitch.tv/videos/")) {
      error = "L'URL doit etre une VOD Twitch (twitch.tv/videos/...)";
      return;
    }

    loading = true;
    try {
      const { job_id } = await submitVod(url);
      onSubmit(job_id);
    } catch (err: any) {
      error = err.message || "Erreur lors de la soumission";
    } finally {
      loading = false;
    }
  }
</script>

<form onsubmit={handleSubmit} class="w-full max-w-2xl mx-auto">
  <div class="flex gap-3">
    <input
      type="text"
      bind:value={url}
      placeholder="https://www.twitch.tv/videos/123456789"
      disabled={loading}
      class="flex-1 px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
    />
    <button
      type="submit"
      disabled={loading || !url.trim()}
      class="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
    >
      {#if loading}
        <span class="inline-block animate-spin mr-2">&#9696;</span>
      {/if}
      Analyser
    </button>
  </div>
  {#if error}
    <p class="mt-3 text-red-400 text-sm">{error}</p>
  {/if}
</form>
