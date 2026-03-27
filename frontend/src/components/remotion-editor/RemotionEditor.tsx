import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Undo2, Redo2, Loader2, Download, Plus, Video, User, MessageSquare, MessagesSquare, ImagePlus, FolderOpen, Square, Circle, SlidersHorizontal, LayoutTemplate, X, Check } from "lucide-react";
import { clipUrl, getEditEnvironment, startRender, uploadAsset, listAssets, assetUrl, type EditEnvironment, type HotPoint, type AssetInfo } from "../../lib/api";
import type { Layer, SubtitleData } from "../../lib/editorTypes";
import type { ThemeLayerTemplate } from "../../lib/editorThemes";
import { getDefaultTheme } from "../../lib/editorThemes";
import { useEditorState } from "../editor/useEditorState";
import NativePreviewViewport from "./NativePreviewViewport";
import LayerPanel from "../editor/LayerPanel";
import PropertiesPanel from "../editor/PropertiesPanel";
import ThemesPanel from "../editor/ThemesPanel";
import PlaybackBar from "../editor/PlaybackBar";
import CropEditor from "../editor/CropEditor";

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

export default function RemotionEditor({ jobId, hotPoint, onClose }: Props) {
  const clipKey = `${jobId}_${hotPoint.clip_filename}`;
  const editor = useEditorState(clipKey);
  const {
    layers, setLayers, selectedId, setSelectedId, selected,
    currentTime, duration,
    addLayer,
    updateTransform, commitTransform, updateStyle, updateVideoCrop, updateSubtitle, updateShape, updateChat, reorderLayers, duplicateLayer, removeLayer,
    renameLayer, toggleVisibility, toggleLock,
    undo, redo,
  } = editor;

  const rawClipUrl = clipUrl(jobId, hotPoint.clip_filename!);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [cropEditingId, setCropEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetLibrary, setAssetLibrary] = useState<AssetInfo[]>([]);
  const [rightTab, setRightTab] = useState<RightTab>("properties");

  // Video metadata — probed via a lightweight metadata-only fetch
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  useEffect(() => {
    const vid = document.createElement("video");
    vid.src = rawClipUrl;
    vid.preload = "metadata";
    vid.onloadedmetadata = () => setVideoDuration(vid.duration);
    return () => { vid.src = ""; };
  }, [rawClipUrl]);

  // Playback state — driven by native video events from NativePreviewViewport
  const [playerTime, setPlayerTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const handleTimeUpdate = useCallback((t: number) => setPlayerTime(t), []);
  const handlePlay = useCallback(() => setPlaying(true), []);
  const handlePause = useCallback(() => setPlaying(false), []);
  const handleDuration = useCallback((d: number) => setVideoDuration(d), []);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(t, videoDuration ?? 0));
    if (videoRef.current) videoRef.current.currentTime = clamped;
    setPlayerTime(clamped);
  }, [videoDuration]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) video.pause();
    else video.play().catch(() => {});
  }, [playing]);

  // Cache edit-env
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

  const handleAddChat = useCallback(async () => {
    setAddMenuOpen(false);
    const env = await fetchEditEnv();
    if (!env) return;
    addLayer({
      type: "chat",
      name: "Chat Twitch",
      transform: { x: 40, y: 800, width: 500, height: 400 },
      chat: {
        messages: env.chat_messages ?? [],
        maxVisible: 6,
        fontSize: 28,
        fontFamily: "Inter",
        showDuration: 5,
      },
    });
  }, [addLayer, fetchEditEnv]);

  const addAssetFromUrl = useCallback((url: string, name: string) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 540;
      const s = Math.min(maxW / img.width, 1);
      const w = Math.round(img.width * s);
      const h = Math.round(img.height * s);
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
    commitTransform();
    let env: EditEnvironment | null = null;
    const needsEnv = templates.some((t) => t.type === "facecam" || t.type === "subtitles" || t.type === "chat");
    if (needsEnv) env = await fetchEditEnv();

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
        const sub: SubtitleData = { ...tpl.subtitle, words: env?.words ?? [], autoColor };
        base.subtitle = sub;
      } else if (tpl.type === "shape" && tpl.shape) {
        base.shape = { ...tpl.shape };
      } else if (tpl.type === "chat") {
        base.chat = {
          maxVisible: 6,
          fontSize: 28,
          fontFamily: "Inter",
          showDuration: 5,
          ...tpl.chat,
          messages: env?.chat_messages ?? [],
        };
      } else if (tpl.type === "asset" && tpl.asset) {
        base.asset = { ...tpl.asset };
      }

      return base;
    });

    setLayers(newLayers);
    setSelectedId(null);
  }, [commitTransform, fetchEditEnv, rawClipUrl, setLayers, setSelectedId]);

  /* ── Auto-apply default theme ──────────────────────────── */

  const defaultAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultAppliedRef.current) return;
    if (layers.length > 0) return;
    const defaultTheme = getDefaultTheme();
    if (!defaultTheme) return;
    defaultAppliedRef.current = true;
    handleApplyTheme(defaultTheme.layers);
  }, [layers.length, handleApplyTheme]);

  /* ── Export ──────────────────────────────────────────────── */

  const [exporting, setExporting] = useState(false);
  const [exportToast, setExportToast] = useState(false);

  const handleExport = useCallback(async () => {
    if (exporting || layers.length === 0) return;
    setExporting(true);
    try {
      let exportLayers = layers;
      const subLayer = layers.find((l) => l.type === "subtitles" && l.visible && l.subtitle && l.subtitle.words.length === 0);
      if (subLayer) {
        const env = await getEditEnvironment(jobId, hotPoint.clip_filename!);
        if (env?.words?.length) {
          exportLayers = layers.map((l) =>
            l.id === subLayer.id && l.subtitle
              ? { ...l, subtitle: { ...l.subtitle, words: env.words } }
              : l,
          );
          editEnvRef.current = env;
          updateSubtitle(subLayer.id, { words: env.words });
        }
      }
      await startRender(jobId, hotPoint.clip_filename!, exportLayers);
      setExportToast(true);
      setTimeout(() => setExportToast(false), 6000);
    } catch (err) {
      alert(`Export échoué: ${err instanceof Error ? err.message : "erreur inconnue"}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, layers, jobId, hotPoint.clip_filename, updateSubtitle]);

  /* ── Popups & keyboard ──────────────────────────────────── */

  useEffect(() => {
    if (!addMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    }
    document.addEventListener("pointerdown", onClick);
    return () => document.removeEventListener("pointerdown", onClick);
  }, [addMenuOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") { e.preventDefault(); seek(playerTime - 5); }
      if (e.key === "ArrowRight") { e.preventDefault(); seek(playerTime + 5); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !selected?.locked) removeLayer(selectedId);
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, onClose, selectedId, selected, removeLayer, undo, redo, seek, playerTime]);

  /* ── Loading state ─────────────────────────────────────── */

  if (videoDuration === null) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────── */

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden relative">
      {/* Loading overlay */}
      {editEnvLoading && (
        <div className="absolute inset-0 z-[100] bg-zinc-950/70 flex items-center justify-center backdrop-blur-sm">
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            Chargement des donnees du clip...
          </div>
        </div>
      )}

      {/* ─── Top bar ─── */}
      <div className="shrink-0 h-11 border-b border-white/[0.06] flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1.5 text-xs">
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
          <div className="h-5 w-px bg-white/[0.06]" />
          <span className="text-sm font-semibold text-white">Cuttie Editor</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">Remotion</span>
          <div className="h-5 w-px bg-white/[0.06]" />
          <div className="flex gap-0.5">
            <button onClick={undo} className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.05]" title="Annuler (⌘Z)">
              <Undo2 className="w-4 h-4" />
            </button>
            <button onClick={redo} className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.05]" title="Rétablir (⌘⇧Z)">
              <Redo2 className="w-4 h-4" />
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
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Export...</>
            ) : (
              <><Download className="w-3.5 h-3.5" />Exporter</>
            )}
          </button>
        </div>
      </div>

      {/* ─── Main area ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Layer panel */}
        <div className="w-64 shrink-0 border-r border-white/[0.06] flex flex-col">
          <LayerPanel
            layers={layers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleVisibility={toggleVisibility}
            onToggleLock={toggleLock}
            onReorder={reorderLayers}
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
              <Plus className="w-4 h-4" />
              Ajouter layer
            </button>

            {addMenuOpen && (
              <div className="absolute bottom-full left-2 right-2 mb-1 bg-zinc-900 border border-white/[0.08] rounded-lg shadow-xl overflow-hidden z-50">
                <button onClick={handleAddGameplay} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <Video className="w-4 h-4 text-purple-400 shrink-0" />Gameplay
                </button>
                <button onClick={handleAddFacecam} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                  <User className="w-4 h-4 text-purple-400 shrink-0" />Facecam
                </button>
                <button onClick={handleAddSubtitles} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                  <MessageSquare className="w-4 h-4 text-purple-400 shrink-0" />Sous-titres
                </button>
                <button onClick={handleAddChat} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                  <MessagesSquare className="w-4 h-4 text-purple-400 shrink-0" />Chat Twitch
                </button>
                <button onClick={handleAddAsset} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <ImagePlus className="w-4 h-4 text-purple-400 shrink-0" />Importer image
                </button>
                <button onClick={handleOpenLibrary} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-purple-400 shrink-0" />Bibliothèque
                </button>
                <div className="h-px bg-white/[0.06] mx-2" />
                <button onClick={() => handleAddShape("rectangle")} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <Square className="w-4 h-4 text-purple-400 shrink-0" />Rectangle
                </button>
                <button onClick={() => handleAddShape("circle")} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                  <Circle className="w-4 h-4 text-purple-400 shrink-0" />Cercle
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: Native preview viewport */}
        <NativePreviewViewport
          layers={layers}
          selectedId={selectedId}
          videoRef={videoRef}
          duration={videoDuration ?? 0}
          onSelect={setSelectedId}
          onTransformChange={updateTransform}
          onTransformStart={commitTransform}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onDuration={handleDuration}
        />

        {/* ─── Right: Icon toolbar + panel ─── */}
        <div className="shrink-0 flex border-l border-white/[0.06]">
          <div className="w-56 flex flex-col border-r border-white/[0.06]">
            {rightTab === "properties" && (
              selected ? (
                <PropertiesPanel
                  layer={selected}
                  onStyleChange={updateStyle}
                  onSubtitleChange={updateSubtitle}
                  onShapeChange={updateShape}
                  onChatChange={updateChat}
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
              <ThemesPanel layers={layers} onApplyTheme={handleApplyTheme} />
            )}
          </div>
          <div className="w-11 flex flex-col items-center py-2 gap-1">
            <button
              onClick={() => setRightTab("properties")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${rightTab === "properties" ? "bg-purple-500/15 text-purple-300" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"}`}
              title="Propriétés"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            <button
              onClick={() => setRightTab("themes")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${rightTab === "themes" ? "bg-purple-500/15 text-purple-300" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"}`}
              title="Thèmes"
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Bottom: Playback ─── */}
      <PlaybackBar
        currentTime={playerTime}
        duration={videoDuration}
        playing={playing}
        onSeek={seek}
        onTogglePlay={togglePlay}
      />

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />

      {/* Asset library modal */}
      {assetLibraryOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setAssetLibraryOpen(false)}>
          <div className="bg-zinc-900 border border-white/[0.08] rounded-xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white">Bibliothèque d'assets</h3>
              <button onClick={() => setAssetLibraryOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
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
                      onClick={() => { addAssetFromUrl(assetUrl(a.filename), a.filename.replace(/\.[^.]+$/, "")); setAssetLibraryOpen(false); }}
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
                <Plus className="w-4 h-4" />Importer une nouvelle image
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export toast */}
      {exportToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] bg-zinc-900 border border-white/[0.1] rounded-xl shadow-2xl px-5 py-4 flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-purple-500/15 flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <p className="text-sm text-white font-medium">Export lance</p>
            <p className="text-[11px] text-zinc-400">Tu peux suivre la progression et telecharger dans la page Exports.</p>
          </div>
          <a href="/exports" className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 hover:text-purple-200 transition-colors font-medium whitespace-nowrap">
            Voir les exports
          </a>
          <button onClick={() => setExportToast(false)} className="text-zinc-600 hover:text-white transition-colors ml-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Crop editor modal */}
      {cropEditingId && (() => {
        const cropLayer = layers.find((l) => l.id === cropEditingId);
        if (!cropLayer?.video?.crop) return null;
        return (
          <CropEditor
            videoSrc={cropLayer.video.src}
            initialCrop={cropLayer.video.crop}
            onConfirm={(newCrop) => { updateVideoCrop(cropEditingId, newCrop); setCropEditingId(null); }}
            onCancel={() => setCropEditingId(null)}
          />
        );
      })()}
    </div>
  );
}
