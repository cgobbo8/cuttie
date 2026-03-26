import { useEffect, useState } from "react";
import { getEditEnvironment, clipUrl, type HotPoint } from "../../lib/api";
import type { EditEnvironment } from "../../lib/editorTypes";
import { buildDefaultLayers, useEditorState } from "./useEditorState";
import CanvasViewport from "./CanvasViewport";
import LayerPanel from "./LayerPanel";
import PlaybackBar from "./PlaybackBar";

interface Props {
  jobId: string;
  hotPoint: HotPoint;
  clips: HotPoint[];
  selectedIdx: number;
  onSelectClip: (idx: number) => void;
  onClose: () => void;
}

export default function CanvasEditor({
  jobId,
  hotPoint,
  clips,
  selectedIdx,
  onSelectClip,
  onClose,
}: Props) {
  const [env, setEnv] = useState<EditEnvironment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const editor = useEditorState();
  const {
    layers, setLayers, selectedId, setSelectedId, selected,
    currentTime, duration,
    playing, registerVideo, seek, togglePlay,
    updateTransform, moveLayer, duplicateLayer, removeLayer,
    renameLayer, toggleVisibility, toggleLock,
  } = editor;

  const rawClipUrl = clipUrl(jobId, hotPoint.clip_filename!);

  // Fetch edit environment + build default layers
  useEffect(() => {
    setLoading(true);
    setError("");
    getEditEnvironment(jobId, hotPoint.clip_filename!)
      .then((data: EditEnvironment) => {
        setEnv(data);
        setLayers(buildDefaultLayers(data, rawClipUrl));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [jobId, hotPoint.clip_filename, rawClipUrl, setLayers]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "Escape") onClose();
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId && !selected?.locked) removeLayer(selectedId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, onClose, selectedId, selected, removeLayer]);

  /* ── Loading / Error ──── */
  if (loading) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-8 h-8 spinner text-purple-400 mx-auto mb-3" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" opacity="0.3" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <p className="text-zinc-500 text-sm">Preparation de l'editeur...</p>
        </div>
      </div>
    );
  }

  if (error || !env) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="glass rounded-2xl p-8 text-center max-w-md">
          <p className="text-red-400 mb-4">{error || "Erreur de chargement"}</p>
          <button onClick={onClose} className="text-sm text-purple-400 hover:text-purple-300 transition-colors">
            Retour
          </button>
        </div>
      </div>
    );
  }

  /* ── Fullscreen editor ──── */
  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden" data-editor-canvas>
      {/* ─── Top bar ─── */}
      <div className="shrink-0 h-11 border-b border-white/[0.06] flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1.5 text-xs"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Retour
          </button>
          <div className="h-5 w-px bg-white/[0.06]" />
          <span className="text-sm font-semibold text-white">Cuttie Editor</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Clip selector */}
          {clips.length > 1 && (
            <div className="flex gap-1 mr-3">
              {clips.map((hp, i) => (
                <button
                  key={i}
                  onClick={() => onSelectClip(i)}
                  className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                    selectedIdx === i
                      ? "bg-purple-500/20 text-purple-300"
                      : "text-zinc-600 hover:text-zinc-300"
                  }`}
                >
                  {hp.timestamp_display}
                </button>
              ))}
            </div>
          )}

          <span className="text-[10px] text-zinc-600 font-mono">
            {env.layout.canvas_w}×{env.layout.canvas_h}
          </span>
        </div>
      </div>

      {/* ─── Main area: layers + canvas ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Layer panel */}
        <div className="w-56 shrink-0 border-r border-white/[0.06]">
          <LayerPanel
            layers={layers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleVisibility={toggleVisibility}
            onToggleLock={toggleLock}
            onMove={moveLayer}
            onDuplicate={duplicateLayer}
            onRemove={removeLayer}
            onRename={renameLayer}
          />
        </div>

        {/* Center: Canvas viewport */}
        <CanvasViewport
          layers={layers}
          selectedId={selectedId}
          currentTime={currentTime}
          clipWidth={env.clip_width}
          clipHeight={env.clip_height}
          registerVideo={registerVideo}
          onSelect={setSelectedId}
          onTransformChange={updateTransform}
        />
      </div>

      {/* ─── Bottom: Playback ─── */}
      <PlaybackBar
        currentTime={currentTime}
        duration={duration}
        playing={playing}
        onSeek={seek}
        onTogglePlay={togglePlay}
      />
    </div>
  );
}
