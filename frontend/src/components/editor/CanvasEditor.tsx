import { useCallback, useEffect, useRef, useState } from "react";
import { clipUrl, getEditEnvironment, type EditEnvironment, type HotPoint } from "../../lib/api";
import { useEditorState } from "./useEditorState";
import CanvasViewport from "./CanvasViewport";
import LayerPanel from "./LayerPanel";
import PropertiesPanel from "./PropertiesPanel";
import PlaybackBar from "./PlaybackBar";

interface Props {
  jobId: string;
  hotPoint: HotPoint;
  onClose: () => void;
}

export default function CanvasEditor({
  jobId,
  hotPoint,
  onClose,
}: Props) {
  const clipKey = `${jobId}_${hotPoint.clip_filename}`;
  const editor = useEditorState(clipKey);
  const {
    layers, selectedId, setSelectedId, selected,
    currentTime, duration, playing,
    registerVideo, seek, togglePlay,
    addLayer,
    updateTransform, commitTransform, updateStyle, moveLayer, duplicateLayer, removeLayer,
    renameLayer, toggleVisibility, toggleLock,
    undo, redo,
  } = editor;

  const rawClipUrl = clipUrl(jobId, hotPoint.clip_filename!);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Cache edit-env (facecam data) — fetched once lazily
  const editEnvRef = useRef<EditEnvironment | null>(null);
  const [editEnvLoading, setEditEnvLoading] = useState(false);

  const fetchEditEnv = useCallback(async () => {
    if (editEnvRef.current) return editEnvRef.current;
    setEditEnvLoading(true);
    try {
      const env = await getEditEnvironment(jobId, hotPoint.clip_filename!);
      editEnvRef.current = env;
      return env;
    } finally {
      setEditEnvLoading(false);
    }
  }, [jobId, hotPoint.clip_filename]);

  const handleAddGameplay = useCallback(() => {
    setAddMenuOpen(false);
    addLayer({
      type: "gameplay",
      name: "Gameplay",
      clipUrl: rawClipUrl,
      transform: { x: 0, y: Math.round((1920 - Math.round(1080 * 9 / 16)) / 2), width: 1080, height: Math.round(1080 * 9 / 16) },
    });
  }, [addLayer, rawClipUrl]);

  const handleAddFacecam = useCallback(async () => {
    setAddMenuOpen(false);
    const env = await fetchEditEnv();
    if (!env) return;
    // Use detected facecam or fallback to bottom-right quarter of the source
    const cam = env.facecam ?? {
      x: Math.round(env.clip_width * 0.65),
      y: Math.round(env.clip_height * 0.65),
      w: Math.round(Math.min(env.clip_width, env.clip_height) / 3),
      h: Math.round(Math.min(env.clip_width, env.clip_height) / 3),
    };
    const camSize = env.layout.cam_size; // 560
    const camY = env.layout.cam_margin_top; // 40
    const camX = Math.round((1080 - camSize) / 2);
    addLayer({
      type: "facecam",
      name: "Facecam",
      clipUrl: rawClipUrl,
      transform: { x: camX, y: camY, width: camSize, height: camSize },
      style: { borderRadius: env.layout.cam_border_radius },
      video: { src: rawClipUrl, crop: cam },
    });
  }, [addLayer, rawClipUrl, fetchEditEnv]);

  // Close popup on outside click
  useEffect(() => {
    if (!addMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onClick);
    return () => document.removeEventListener("pointerdown", onClick);
  }, [addMenuOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't capture when renaming a layer (input focused)
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "Escape") onClose();
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !selected?.locked) {
        removeLayer(selectedId);
      }
      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, onClose, selectedId, selected, removeLayer, undo, redo]);

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
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
          <div className="h-5 w-px bg-white/[0.06]" />
          <div className="flex gap-0.5">
            <button
              onClick={undo}
              className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.05]"
              title="Annuler (⌘Z)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
              </svg>
            </button>
            <button
              onClick={redo}
              className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.05]"
              title="Rétablir (⌘⇧Z)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
              </svg>
            </button>
          </div>
        </div>

        <span className="text-[10px] text-zinc-600 font-mono">1080×1920</span>
      </div>

      {/* ─── Main area ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Layer panel */}
        <div className="w-56 shrink-0 border-r border-white/[0.06] flex flex-col">
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

          {/* Add layer */}
          <div className="shrink-0 border-t border-white/[0.06] p-2 relative" ref={addMenuRef}>
            <button
              onClick={() => setAddMenuOpen((v) => !v)}
              className="w-full text-xs px-3 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 transition-colors flex items-center justify-center gap-2 font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Ajouter layer
            </button>

            {addMenuOpen && (
              <div className="absolute bottom-full left-2 right-2 mb-1 bg-zinc-900 border border-white/[0.08] rounded-lg shadow-xl overflow-hidden z-50">
                <button
                  onClick={handleAddGameplay}
                  className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Gameplay
                </button>
                <button
                  onClick={handleAddFacecam}
                  disabled={editEnvLoading}
                  className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40"
                >
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Facecam
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: Canvas viewport */}
        <CanvasViewport
          layers={layers}
          selectedId={selectedId}
          registerVideo={registerVideo}
          onSelect={setSelectedId}
          onTransformChange={updateTransform}
          onTransformStart={commitTransform}
        />

        {/* Right: Properties panel — visible when a layer is selected */}
        {selected && (
          <div className="w-56 shrink-0 border-l border-white/[0.06] flex flex-col">
            <PropertiesPanel layer={selected} onStyleChange={updateStyle} onCommit={commitTransform} />
          </div>
        )}
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
