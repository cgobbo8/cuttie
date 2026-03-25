<script lang="ts">
  import { clipUrl, type HotPoint, type KeyMoment } from "../api";

  let {
    hotPoints,
    vodTitle,
    vodGame,
    vodDuration,
    jobId,
    streamer = "",
    viewCount = 0,
    streamDate = "",
  }: {
    hotPoints: HotPoint[];
    vodTitle: string;
    vodGame: string;
    vodDuration: number;
    jobId: string;
    streamer?: string;
    viewCount?: number;
    streamDate?: string;
  } = $props();

  interface SignalInfo {
    label: string;
    color: string;
    bgColor: string;
    key: keyof HotPoint["signals"];
    description: string;
  }

  const SIGNALS: SignalInfo[] = [
    {
      label: "Volume",
      color: "bg-red-500",
      bgColor: "text-red-400",
      key: "rms",
      description: "Energie sonore (RMS). Un pic indique des cris, de l'excitation ou un moment fort sonore.",
    },
    {
      label: "Chat",
      color: "bg-purple-500",
      bgColor: "text-purple-400",
      key: "chat_speed",
      description: "Vitesse du chat Twitch (messages/seconde). Le chat qui s'emballe est un des meilleurs indicateurs de moment fort.",
    },
    {
      label: "Flux spectral",
      color: "bg-orange-500",
      bgColor: "text-orange-400",
      key: "spectral_flux",
      description: "Taux de changement dans le spectre audio. Detecte les transitions soudaines : explosion apres un silence, changement d'ambiance.",
    },
    {
      label: "Pitch",
      color: "bg-blue-500",
      bgColor: "text-blue-400",
      key: "pitch_variance",
      description: "Variance de la hauteur de voix. Une voix qui monte dans les aigus signale du stress, de la surprise ou de l'excitation.",
    },
    {
      label: "Brillance",
      color: "bg-green-500",
      bgColor: "text-green-400",
      key: "spectral_centroid",
      description: "Centre de gravite spectral. Un son brillant (hautes frequences) correspond souvent a une voix excitee ou energique.",
    },
    {
      label: "ZCR",
      color: "bg-zinc-400",
      bgColor: "text-zinc-400",
      key: "zcr",
      description: "Taux de passage par zero. Distingue bruit/cris de la parole normale. Un ZCR eleve peut indiquer des cris ou du bruit intense.",
    },
  ];

  let expandedClip = $state<number | null>(null);
  let videoElements: Record<number, HTMLVideoElement> = {};
  let activeMoment = $state<Record<number, number | null>>({});

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}min`;
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function toggleClip(index: number) {
    expandedClip = expandedClip === index ? null : index;
  }

  function seekTo(clipIndex: number, time: number, momentIndex: number) {
    const video = videoElements[clipIndex];
    if (video) {
      video.currentTime = time;
      video.play();
    }
    activeMoment[clipIndex] = momentIndex;
  }

  function scoreLabel(score: number): { text: string; class: string } {
    if (score > 0.7) return { text: "Tres fort", class: "text-red-400" };
    if (score > 0.5) return { text: "Fort", class: "text-orange-400" };
    if (score > 0.3) return { text: "Moyen", class: "text-yellow-400" };
    return { text: "Faible", class: "text-zinc-400" };
  }

  const CATEGORY_STYLES: Record<string, { label: string; bg: string; text: string }> = {
    fun: { label: "Fun", bg: "bg-yellow-500/20", text: "text-yellow-400" },
    rage: { label: "Rage", bg: "bg-red-500/20", text: "text-red-400" },
    clutch: { label: "Clutch", bg: "bg-emerald-500/20", text: "text-emerald-400" },
    skill: { label: "Skill", bg: "bg-blue-500/20", text: "text-blue-400" },
    fail: { label: "Fail", bg: "bg-orange-500/20", text: "text-orange-400" },
    emotional: { label: "Emotional", bg: "bg-pink-500/20", text: "text-pink-400" },
    reaction: { label: "Reaction", bg: "bg-purple-500/20", text: "text-purple-400" },
    storytelling: { label: "Story", bg: "bg-cyan-500/20", text: "text-cyan-400" },
    awkward: { label: "Awkward", bg: "bg-amber-500/20", text: "text-amber-400" },
    hype: { label: "Hype", bg: "bg-fuchsia-500/20", text: "text-fuchsia-400" },
  };

  function categoryStyle(cat: string) {
    return CATEGORY_STYLES[cat] || { label: cat, bg: "bg-zinc-500/20", text: "text-zinc-400" };
  }

  // Only show signals that have non-zero values across all hot points
  let activeSignals = $derived(
    SIGNALS.filter((signal) =>
      hotPoints.some((hp) => hp.signals[signal.key] > 0.01)
    )
  );
</script>

<div class="w-full max-w-4xl mx-auto">
  <!-- Header -->
  <div class="mb-8 text-center">
    <h2 class="text-2xl font-bold text-white mb-2">{vodTitle}</h2>
    <div class="flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-400 mb-1">
      {#if streamer}
        <span class="text-purple-400 font-medium">{streamer}</span>
      {/if}
      {#if vodGame}
        <span>{vodGame}</span>
      {/if}
      {#if streamDate}
        <span class="text-zinc-500">{streamDate}</span>
      {/if}
      <span>{formatDuration(vodDuration)}</span>
      {#if viewCount}
        <span class="text-zinc-500">{viewCount} vues</span>
      {/if}
    </div>
    <p class="text-zinc-500 text-sm">
      {hotPoints.length} moments forts detectes
    </p>
  </div>

  <!-- Hot points list -->
  <div class="space-y-4">
    {#each hotPoints as point, i}
      {@const displayScore = point.final_score ?? point.score}
      {@const label = scoreLabel(displayScore)}
      {@const moments = point.llm?.key_moments ?? []}
      <div
        class="bg-zinc-800/50 border border-zinc-700/50 rounded-xl overflow-hidden hover:border-purple-500/30 transition-colors"
      >
        <!-- Header row (clickable) -->
        <button
          class="w-full p-5 text-left cursor-pointer"
          onclick={() => toggleClip(i)}
        >
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
              <span
                class="text-sm font-bold text-zinc-500 bg-zinc-800 w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              >
                {i + 1}
              </span>
              <div>
                <span class="text-lg font-mono text-white">{point.timestamp_display}</span>
                <span
                  class="ml-3 text-sm font-semibold px-2 py-0.5 rounded-full {displayScore > 0.7
                    ? 'bg-red-500/20 text-red-400'
                    : displayScore > 0.5
                      ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-zinc-700/50 text-zinc-400'}"
                >
                  {Math.round(displayScore * 100)}%
                </span>
                {#if point.llm?.category}
                  {@const cat = categoryStyle(point.llm.category)}
                  <span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full {cat.bg} {cat.text}">
                    {cat.label}
                  </span>
                {/if}
                {#if point.llm && point.llm.virality_score > 0}
                  <span class="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-400">
                    Viral {Math.round(point.llm.virality_score * 100)}%
                  </span>
                {/if}
              </div>
            </div>
            <span class="text-zinc-500 text-sm">
              {expandedClip === i ? "▲ Masquer" : "▼ Details"}
            </span>
          </div>

          <!-- Summary line -->
          {#if point.llm?.summary}
            <p class="text-sm text-zinc-400 mb-3 line-clamp-2">{point.llm.summary}</p>
          {/if}

          <!-- Compact signal bars -->
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {#each activeSignals as signal}
              <div class="flex items-center gap-2">
                <span class="text-xs text-zinc-500 w-16 text-right">{signal.label}</span>
                <div class="flex-1 bg-zinc-700/30 rounded-full h-1.5 overflow-hidden">
                  <div
                    class="{signal.color} h-full rounded-full transition-all"
                    style="width: {Math.round(point.signals[signal.key] * 100)}%"
                  ></div>
                </div>
              </div>
            {/each}
          </div>
        </button>

        <!-- Expanded detail view -->
        {#if expandedClip === i}
          <div class="border-t border-zinc-700/50">
            <!-- Video player with timeline markers -->
            {#if point.clip_filename}
              <div class="p-4 bg-black/30">
                <video
                  bind:this={videoElements[i]}
                  controls
                  class="w-full rounded-lg max-h-[400px]"
                  src={clipUrl(jobId, point.clip_filename)}
                >
                  <track kind="captions" />
                </video>

                <!-- Key moments timeline (goto buttons) -->
                {#if moments.length > 0}
                  <div class="mt-3 flex flex-wrap gap-2">
                    {#each moments as moment, mi}
                      <button
                        class="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer
                          {activeMoment[i] === mi
                            ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                            : 'bg-zinc-700/40 text-zinc-300 border border-zinc-600/30 hover:bg-zinc-700/60 hover:text-white'}"
                        onclick={() => seekTo(i, moment.time, mi)}
                        title={moment.description}
                      >
                        <span class="font-mono text-zinc-500 mr-1">{formatTime(moment.time)}</span>
                        {moment.label}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Narrative + LLM Analysis -->
            {#if point.llm}
              <div class="p-5 border-b border-zinc-700/50 space-y-3">
                <!-- Narrative (the "film" of the clip) -->
                {#if point.llm.narrative}
                  <div>
                    <h4 class="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Recit du clip</h4>
                    <p class="text-sm text-zinc-200 leading-relaxed">{point.llm.narrative}</p>
                  </div>
                {/if}

                <!-- Tags -->
                <div class="flex flex-wrap gap-2 text-xs">
                  {#if point.llm.category}
                    {@const cat = categoryStyle(point.llm.category)}
                    <span class="px-2 py-1 rounded-full {cat.bg} {cat.text} font-semibold">{cat.label}</span>
                  {/if}
                  {#if point.llm.virality_score > 0}
                    <span class="px-2 py-1 rounded-full bg-fuchsia-500/15 text-fuchsia-400">
                      Potentiel viral : {Math.round(point.llm.virality_score * 100)}%
                    </span>
                  {/if}
                  {#if !point.llm.is_clipable}
                    <span class="px-2 py-1 rounded-full bg-zinc-700/50 text-zinc-400">
                      Necessite du contexte
                    </span>
                  {/if}
                  {#if point.llm.speech_rate > 0}
                    <span class="px-2 py-1 rounded-full bg-zinc-700/50 text-zinc-400">
                      {point.llm.speech_rate.toFixed(1)} mots/s
                    </span>
                  {/if}
                </div>

                <!-- Key moments detail list -->
                {#if moments.length > 0}
                  <details class="text-xs">
                    <summary class="text-zinc-500 cursor-pointer hover:text-zinc-300">
                      Moments cles ({moments.length})
                    </summary>
                    <div class="mt-2 space-y-2">
                      {#each moments as moment, mi}
                        <button
                          class="w-full text-left flex gap-3 p-2 rounded-lg hover:bg-zinc-700/30 transition-colors cursor-pointer"
                          onclick={() => seekTo(i, moment.time, mi)}
                        >
                          <span class="font-mono text-purple-400 shrink-0">{formatTime(moment.time)}</span>
                          <div>
                            <span class="text-zinc-200 font-medium">{moment.label}</span>
                            {#if moment.description}
                              <p class="text-zinc-500 mt-0.5">{moment.description}</p>
                            {/if}
                          </div>
                        </button>
                      {/each}
                    </div>
                  </details>
                {/if}

                <!-- Transcript -->
                {#if point.llm.transcript}
                  <details class="text-xs">
                    <summary class="text-zinc-500 cursor-pointer hover:text-zinc-300">Transcription</summary>
                    <p class="mt-2 text-zinc-400 italic leading-relaxed">{point.llm.transcript}</p>
                  </details>
                {/if}
              </div>
            {/if}

            <!-- Score detail -->
            <div class="p-5 space-y-4">
              <div class="flex items-center gap-2 mb-4">
                <span class="text-sm text-zinc-500">Score final :</span>
                <span class="text-lg font-bold {label.class}">
                  {Math.round(displayScore * 100)}% — {label.text}
                </span>
              </div>

              {#if point.final_score != null}
                <div class="flex gap-4 text-xs text-zinc-500 mb-2">
                  <span>Heuristique : {Math.round(point.score * 100)}% (x0.3)</span>
                  <span>LLM : {point.llm ? Math.round(point.llm.virality_score * 100) : 0}% (x0.7)</span>
                </div>
              {/if}

              <p class="text-xs text-zinc-600 mb-4">
                Le score combine l'analyse audio/chat (30%) et l'evaluation LLM du potentiel viral (70%).
              </p>

              <!-- Detailed signal breakdown -->
              <details class="text-sm">
                <summary class="text-zinc-500 cursor-pointer hover:text-zinc-300 text-xs">
                  Detail des signaux audio
                </summary>
                <div class="space-y-3 mt-3">
                  {#each activeSignals as signal}
                    {@const value = point.signals[signal.key]}
                    <div>
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-sm font-medium {signal.bgColor}">{signal.label}</span>
                        <span class="text-sm font-mono text-zinc-300">{Math.round(value * 100)}%</span>
                      </div>
                      <div class="w-full bg-zinc-700/30 rounded-full h-2 overflow-hidden mb-1">
                        <div
                          class="{signal.color} h-full rounded-full"
                          style="width: {Math.round(value * 100)}%"
                        ></div>
                      </div>
                      <p class="text-xs text-zinc-600">{signal.description}</p>
                    </div>
                  {/each}
                </div>
              </details>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
