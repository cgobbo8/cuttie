import { useCallback, useEffect, useRef, useState } from "react";
import { clipUrl, getEditEnvironment, renderClip, uploadAsset, listAssets, assetUrl, type EditEnvironment, type HotPoint, type AssetInfo } from "../../lib/api";
import type { Layer, SubtitleData } from "../../lib/editorTypes";
import type { ThemeLayerTemplate } from "../../lib/editorThemes";
import { getDefaultTheme } from "../../lib/editorThemes";
import { useEditorState } from "./useEditorState";
import CanvasViewport from "./CanvasViewport";
import LayerPanel from "./LayerPanel";
import PropertiesPanel from "./PropertiesPanel";
import ThemesPanel from "./ThemesPanel";
import PlaybackBar from "./PlaybackBar";
import CropEditor from "./CropEditor";

interface Props {
  jobId: string;
  hotPoint: HotPoint;
  onClose: () => void;
}

type RightTab = "properties" | "themes";

let _nextApplyId = 0;
function applyUid() {
  return `layer_a${++_nextApplyId}_${Date.now().toString(36)}`;
}

export default function CanvasEditor({
  jobId,
  hotPoint,
  onClose,
}: Props) {
  const clipKey = `${jobId}_${hotPoint.clip_filename}`;
  const editor = useEditorState(clipKey);
  const {
    layers, setLayers, selectedId, setSelectedId, selected,
    currentTime, duration, playing,
    registerVideo, seek, togglePlay,
    addLayer,
    updateTransform, commitTransform, updateStyle, updateVideoCrop, updateSubtitle, updateShape, moveLayer, duplicateLayer, removeLayer,
    renameLayer, toggleVisibility, toggleLock,
    undo, redo,
  } = editor;

  const rawClipUrl = clipUrl(jobId, hotPoint.clip_filename!);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [cropEditingId, setCropEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetLibrary, setAssetLibrary] = useState<AssetInfo[]>([]);

  // Right sidebar
  const [rightTab, setRightTab] = useState<RightTab>("properties");

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

  /* ── Add layer handlers ─────────────────────────────────── */

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
    const cam = env.facecam ?? {
      x: Math.round(env.clip_width * 0.65),
      y: Math.round(env.clip_height * 0.65),
      w: Math.round(Math.min(env.clip_width, env.clip_height) / 3),
      h: Math.round(Math.min(env.clip_width, env.clip_height) / 3),
    };
    const camSize = env.layout.cam_size;
    const camY = env.layout.cam_margin_top;
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

  const handleAddSubtitles = useCallback(async () => {
    setAddMenuOpen(false);
    const env = await fetchEditEnv();
    if (!env) return;
    const dc = env.dominant_color;
    const autoColor = dc
      ? `#${dc.r.toString(16).padStart(2, "0")}${dc.g.toString(16).padStart(2, "0")}${dc.b.toString(16).padStart(2, "0")}`
      : "#6464C8";
    addLayer({
      type: "subtitles",
      name: "Sous-titres",
      transform: { x: 40, y: 1650, width: 1000, height: 200 },
      subtitle: {
        words: env.words ?? [],
        fontFamily: "Luckiest Guy",
        fontSize: 75,
        colorMode: "auto",
        customColor: "#6464C8",
        autoColor,
        uppercase: true,
      },
    });
  }, [addLayer, fetchEditEnv]);

  const addAssetFromUrl = useCallback((url: string, name: string) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 540;
      const scale = Math.min(maxW / img.width, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      addLayer({
        type: "asset",
        name,
        transform: { x: Math.round((1080 - w) / 2), y: Math.round((1920 - h) / 2), width: w, height: h },
        asset: { src: url },
      });
    };
    img.src = url;
  }, [addLayer]);

  const handleAddAsset = useCallback(() => {
    setAddMenuOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleOpenLibrary = useCallback(async () => {
    setAddMenuOpen(false);
    const assets = await listAssets();
    setAssetLibrary(assets);
    setAssetLibraryOpen(true);
  }, []);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const result = await uploadAsset(file);
      const url = assetUrl(result.filename);
      addAssetFromUrl(url, file.name.replace(/\.[^.]+$/, ""));
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        addAssetFromUrl(reader.result as string, file.name.replace(/\.[^.]+$/, ""));
      };
      reader.readAsDataURL(file);
    }
  }, [addAssetFromUrl]);

  const handleAddShape = useCallback((shapeType: "rectangle" | "circle") => {
    setAddMenuOpen(false);
    const size = shapeType === "circle" ? 300 : 400;
    const h = shapeType === "circle" ? 300 : 250;
    addLayer({
      type: "shape",
      name: shapeType === "circle" ? "Cercle" : "Rectangle",
      transform: { x: Math.round((1080 - size) / 2), y: Math.round((1920 - h) / 2), width: size, height: h },
      shape: {
        shapeType,
        backgroundColor: "#a855f7",
        backgroundAlpha: 0.3,
        backdropBlur: 0,
        boxShadowPreset: "none",
      },
    });
  }, [addLayer]);

  /* ── Theme application ──────────────────────────────────── */

  const handleApplyTheme = useCallback(async (templates: ThemeLayerTemplate[]) => {
    // Snapshot current state for undo
    commitTransform();

    // Fetch edit-env lazily for facecam/subtitles
    let env: EditEnvironment | null = null;
    const needsEnv = templates.some((t) => t.type === "facecam" || t.type === "subtitles");
    if (needsEnv) {
      env = await fetchEditEnv();
    }

    const dc = env?.dominant_color;
    const autoColor = dc
      ? `#${dc.r.toString(16).padStart(2, "0")}${dc.g.toString(16).padStart(2, "0")}${dc.b.toString(16).padStart(2, "0")}`
      : "#6464C8";

    const newLayers: Layer[] = templates.map((tpl) => {
      const id = applyUid();
      const base: Layer = {
        id,
        name: tpl.name,
        type: tpl.type,
        visible: true,
        locked: false,
        transform: { ...tpl.transform },
        style: { ...tpl.style },
      };

      if (tpl.type === "gameplay") {
        base.video = { src: rawClipUrl };
      } else if (tpl.type === "facecam") {
        const crop = tpl.videoCrop ?? env?.facecam ?? {
          x: Math.round((env?.clip_width ?? 1920) * 0.65),
          y: Math.round((env?.clip_height ?? 1080) * 0.65),
          w: Math.round(Math.min(env?.clip_width ?? 1920, env?.clip_height ?? 1080) / 3),
          h: Math.round(Math.min(env?.clip_width ?? 1920, env?.clip_height ?? 1080) / 3),
        };
        base.video = { src: rawClipUrl, crop };
      } else if (tpl.type === "subtitles" && tpl.subtitle) {
        const sub: SubtitleData = {
          ...tpl.subtitle,
          words: env?.words ?? [],
          autoColor,
        };
        base.subtitle = sub;
      } else if (tpl.type === "shape" && tpl.shape) {
        base.shape = { ...tpl.shape };
      } else if (tpl.type === "asset" && tpl.asset) {
        base.asset = { ...tpl.asset };
      }

      return base;
    });

    setLayers(newLayers);
    setSelectedId(null);
  }, [commitTransform, fetchEditEnv, rawClipUrl, setLayers, setSelectedId]);

  /* ── Auto-apply default theme on first open ──────────────── */

  const defaultAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultAppliedRef.current) return;
    if (layers.length > 0) return; // Already has saved layers
    const defaultTheme = getDefaultTheme();
    if (!defaultTheme) return;
    defaultAppliedRef.current = true;
    handleApplyTheme(defaultTheme.layers);
  }, [layers.length, handleApplyTheme]);

  /* ── Export ──────────────────────────────────────────────── */

  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ filename: string; url: string; size_mb: number } | null>(null);

  const handleExport = useCallback(async () => {
    if (exporting || layers.length === 0) return;
    setExporting(true);
    setExportResult(null);
    try {
      const result = await renderClip(jobId, hotPoint.clip_filename!, layers);
      setExportResult(result);
    } catch (err) {
      alert(`Export échoué: ${err instanceof Error ? err.message : "erreur inconnue"}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, layers, jobId, hotPoint.clip_filename]);

  /* ── Popups & keyboard ──────────────────────────────────── */

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "Escape") onClose();
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !selected?.locked) {
        removeLayer(selectedId);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, onClose, selectedId, selected, removeLayer, undo, redo]);

  /* ── Render ─────────────────────────────────────────────── */

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

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-600 font-mono">1080×1920</span>
          <button
            onClick={handleExport}
            disabled={exporting || layers.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-white font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Export...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Exporter
              </>
            )}
          </button>
        </div>
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
                <button onClick={handleAddGameplay} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  Gameplay
                </button>
                <button onClick={handleAddFacecam} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  Facecam
                </button>
                <button onClick={handleAddSubtitles} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                  Sous-titres
                </button>
                <button onClick={handleAddAsset} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  Importer image
                </button>
                <button onClick={handleOpenLibrary} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                  Bibliothèque
                </button>
                <div className="h-px bg-white/[0.06] mx-2" />
                <button onClick={() => handleAddShape("rectangle")} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" /></svg>
                  Rectangle
                </button>
                <button onClick={() => handleAddShape("circle")} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth={2} /></svg>
                  Cercle
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: Canvas viewport */}
        <CanvasViewport
          layers={layers}
          selectedId={selectedId}
          currentTime={currentTime}
          registerVideo={registerVideo}
          onSelect={setSelectedId}
          onTransformChange={updateTransform}
          onTransformStart={commitTransform}
        />

        {/* ─── Right: Icon toolbar + panel ─── */}
        <div className="shrink-0 flex border-l border-white/[0.06]">
          {/* Content panel */}
          <div className="w-56 flex flex-col border-r border-white/[0.06]">
            {rightTab === "properties" && (
              selected ? (
                <PropertiesPanel
                  layer={selected}
                  onStyleChange={updateStyle}
                  onSubtitleChange={updateSubtitle}
                  onShapeChange={updateShape}
                  onTransformChange={updateTransform}
                  onCommit={commitTransform}
                  onStartCrop={setCropEditingId}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center px-4">
                  <p className="text-[11px] text-zinc-600 text-center">Sélectionne un calque pour voir ses propriétés</p>
                </div>
              )
            )}
            {rightTab === "themes" && (
              <ThemesPanel
                layers={layers}
                onApplyTheme={handleApplyTheme}
              />
            )}
          </div>

          {/* Icon strip */}
          <div className="w-11 flex flex-col items-center py-2 gap-1">
            <button
              onClick={() => setRightTab("properties")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                rightTab === "properties"
                  ? "bg-purple-500/15 text-purple-300"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"
              }`}
              title="Propriétés"
            >
              {/* Sliders icon */}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
            <button
              onClick={() => setRightTab("themes")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                rightTab === "themes"
                  ? "bg-purple-500/15 text-purple-300"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"
              }`}
              title="Thèmes"
            >
              {/* Layout/grid icon */}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm0 7a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5zm-10 2a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Bottom: Playback ─── */}
      <PlaybackBar
        currentTime={currentTime}
        duration={duration}
        playing={playing}
        onSeek={seek}
        onTogglePlay={togglePlay}
      />

      {/* Hidden file input for asset upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* ─── Asset library modal ─── */}
      {assetLibraryOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setAssetLibraryOpen(false)}>
          <div
            className="bg-zinc-900 border border-white/[0.08] rounded-xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white">Bibliothèque d'assets</h3>
              <button onClick={() => setAssetLibraryOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {assetLibrary.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-8">Aucun asset importé pour l'instant.</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {assetLibrary.map((a) => (
                    <button
                      key={a.filename}
                      className="group relative aspect-square rounded-lg overflow-hidden border border-white/[0.06] hover:border-purple-500/50 transition-colors bg-zinc-800"
                      onClick={() => {
                        const url = assetUrl(a.filename);
                        addAssetFromUrl(url, a.filename.replace(/\.[^.]+$/, ""));
                        setAssetLibraryOpen(false);
                      }}
                    >
                      <img src={assetUrl(a.filename)} alt={a.filename} className="w-full h-full object-contain" />
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[9px] text-zinc-300 truncate block">{a.filename}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-white/[0.06] px-4 py-3">
              <button
                onClick={() => { setAssetLibraryOpen(false); fileInputRef.current?.click(); }}
                className="w-full text-xs px-3 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 transition-colors flex items-center justify-center gap-2 font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Importer une nouvelle image
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Export result toast ─── */}
      {exportResult && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] bg-zinc-900 border border-white/[0.1] rounded-xl shadow-2xl px-5 py-4 flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-white font-medium">Export terminé</p>
            <p className="text-[11px] text-zinc-400">{exportResult.filename} — {exportResult.size_mb} MB</p>
          </div>
          <a
            href={clipUrl(jobId, exportResult.filename)}
            download={exportResult.filename}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 hover:text-purple-200 transition-colors font-medium"
          >
            Télécharger
          </a>
          <button
            onClick={() => setExportResult(null)}
            className="text-zinc-600 hover:text-white transition-colors ml-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ─── Crop editor modal ─── */}
      {cropEditingId && (() => {
        const cropLayer = layers.find((l) => l.id === cropEditingId);
        if (!cropLayer?.video?.crop) return null;
        return (
          <CropEditor
            videoSrc={cropLayer.video.src}
            initialCrop={cropLayer.video.crop}
            onConfirm={(newCrop) => {
              updateVideoCrop(cropEditingId, newCrop);
              setCropEditingId(null);
            }}
            onCancel={() => setCropEditingId(null)}
          />
        );
      })()}
    </div>
  );
}
