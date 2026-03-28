import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Undo2, Redo2, Loader2, Download, Plus, Video, User, MessageSquare, MessagesSquare, ImagePlus, FolderOpen, Square, Circle, SlidersHorizontal, LayoutTemplate, X, Check, Type, Flame, FileText, Layers } from "lucide-react";
import { clipUrl, getEditEnvironment, startRender, uploadAsset, listAssets, assetUrl, type EditEnvironment, type HotPoint, type AssetInfo, type TranscriptWord } from "../../lib/api";
import type { Layer, SubtitleData } from "../../lib/editorTypes";
import type { ThemeLayerTemplate } from "../../lib/editorThemes";
import { getDefaultTheme } from "../../lib/editorThemes";
import { useEditorState } from "./useEditorState";
import CanvasViewport from "./CanvasViewport";
import LayerPanel from "./LayerPanel";
import PropertiesPanel from "./PropertiesPanel";
import ThemesPanel from "./ThemesPanel";
import PlaybackBar from "./PlaybackBar";
import HotPointsPanel from "./HotPointsPanel";
import TranscriptionPanel from "./TranscriptionPanel";
import CropEditor from "./CropEditor";

interface Props {
  jobId: string;
  hotPoint: HotPoint;
  onClose: () => void;
}

type RightTab = "properties" | "themes";
type LeftTab = "layers" | "hotpoints" | "transcription";

let _nextApplyId = 0;
function applyUid() {
  return `layer_a${++_nextApplyId}_${Date.now().toString(36)}`;
}

export default function CanvasEditor({
  jobId,
  hotPoint,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const clipKey = `${jobId}_${hotPoint.clip_filename}`;
  const editor = useEditorState(clipKey);
  const {
    layers, setLayers, selectedId, setSelectedId, selected,
    currentTime, duration, playing,
    registerVideo, seek, togglePlay,
    addLayer,
    updateTransform, commitTransform, updateStyle, updateSubtitle, updateShape, updateChat, updateAsset, updateText, reorderLayers, duplicateLayer, removeLayer,
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

  // Left sidebar
  const [leftTab, setLeftTab] = useState<LeftTab>("layers");
  const [transcriptWords, setTranscriptWords] = useState<TranscriptWord[]>([]);

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
      if (env.words?.length) setTranscriptWords(env.words);
      return env;
    } finally {
      setEditEnvLoading(false);
    }
  }, [jobId, hotPoint.clip_filename]);

  // Auto-fetch edit environment when switching to transcription tab
  useEffect(() => {
    if (leftTab === "transcription" && transcriptWords.length === 0 && !editEnvRef.current) {
      fetchEditEnv();
    }
  }, [leftTab, transcriptWords.length, fetchEditEnv]);

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
    const camWidth = env.layout.cam_size;
    const camHeight = Math.round(camWidth * (cam.h / cam.w));
    const camY = env.layout.cam_margin_top;
    const camX = Math.round((1080 - camWidth) / 2);
    addLayer({
      type: "facecam",
      name: "Facecam",
      clipUrl: rawClipUrl,
      transform: { x: camX, y: camY, width: camWidth, height: camHeight },
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
    const messages = env.chat_messages ?? [];
    addLayer({
      type: "chat",
      name: "Chat Twitch",
      transform: { x: 40, y: 800, width: 500, height: 400 },
      chat: {
        messages,
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

  const handleAddText = useCallback(() => {
    setAddMenuOpen(false);
    addLayer({
      type: "text",
      name: "Texte",
      transform: { x: 140, y: 900, width: 800, height: 200, rotation: 0 },
      text: {
        content: "Texte",
        fontFamily: "Inter",
        fontSize: 64,
        color: "#ffffff",
        fontWeight: "bold",
        textAlign: "center",
        uppercase: false,
        lineHeight: 1.2,
      },
    });
  }, [addLayer]);

  /* ── Theme application ──────────────────────────────────── */

  const handleApplyTheme = useCallback(async (templates: ThemeLayerTemplate[]) => {
    // Snapshot current state for undo
    commitTransform();

    // Fetch edit-env lazily for facecam/subtitles/chat
    let env: EditEnvironment | null = null;
    const needsEnv = templates.some((t) => t.type === "facecam" || t.type === "subtitles" || t.type === "chat");
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
        // Adjust height to match crop aspect ratio (avoid distortion)
        base.transform.height = Math.round(base.transform.width * (crop.h / crop.w));
      } else if (tpl.type === "subtitles" && tpl.subtitle) {
        const sub: SubtitleData = {
          ...tpl.subtitle,
          words: env?.words ?? [],
          autoColor,
        };
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
  const [exportToast, setExportToast] = useState(false);

  const handleExport = useCallback(async () => {
    if (exporting || layers.length === 0) return;
    setExporting(true);
    try {
      // If subtitle layer has empty words, re-fetch from backend (bypass cache)
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
          // Update cache + editor state so next export doesn't re-fetch
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
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onClick);
    return () => document.removeEventListener("pointerdown", onClick);
  }, [addMenuOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
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
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden relative">
      {/* Loading overlay */}
      {editEnvLoading && (
        <div className="absolute inset-0 z-[100] bg-zinc-950/70 flex items-center justify-center backdrop-blur-sm">
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <Loader2 className="w-5 h-5 animate-spin text-white" />
            Chargement des donnees du clip...
          </div>
        </div>
      )}

      {/* ─── Top bar ─── */}
      <div className="shrink-0 h-11 border-b border-white/[0.06] flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1.5 text-xs"
          >
            <ArrowLeft className="w-4 h-4" />
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
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={redo}
              className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.05]"
              title="Rétablir (⌘⇧Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-600 font-mono">1080×1920</span>
          <button
            onClick={handleExport}
            disabled={exporting || layers.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Export...
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Exporter
              </>
            )}
          </button>
        </div>
      </div>

      {/* ─── Main area ─── */}
      <div className="flex-1 flex min-h-0">
        {/* ─── Left: Icon toolbar + panel ─── */}
        <div className="shrink-0 flex border-r border-white/[0.06]">
          {/* Icon strip */}
          <div className="w-11 flex flex-col items-center py-2 gap-1 border-r border-white/[0.06]">
            <button
              onClick={() => setLeftTab("layers")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                leftTab === "layers"
                  ? "bg-white/[0.08] text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"
              }`}
              title="Calques"
            >
              <Layers className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLeftTab("hotpoints")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                leftTab === "hotpoints"
                  ? "bg-white/[0.08] text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"
              }`}
              title="Temps forts"
            >
              <Flame className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLeftTab("transcription")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                leftTab === "transcription"
                  ? "bg-white/[0.08] text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"
              }`}
              title="Transcription"
            >
              <FileText className="w-4 h-4" />
            </button>
          </div>

          {/* Content panel */}
          <div className="w-56 flex flex-col">
            {leftTab === "layers" && (
              <>
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
                    className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 hover:text-zinc-100 transition-colors flex items-center justify-center gap-2 font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter layer
                  </button>

                  {addMenuOpen && (
                    <div className="absolute bottom-full left-2 right-2 mb-1 bg-zinc-900 border border-white/[0.08] rounded-lg shadow-xl overflow-hidden z-50">
                      <button onClick={handleAddGameplay} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <Video className="w-4 h-4 text-white shrink-0" />
                        Gameplay
                      </button>
                      <button onClick={handleAddFacecam} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                        <User className="w-4 h-4 text-white shrink-0" />
                        Facecam
                      </button>
                      <button onClick={handleAddSubtitles} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                        <MessageSquare className="w-4 h-4 text-white shrink-0" />
                        Sous-titres
                      </button>
                      <button onClick={handleAddChat} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                        <MessagesSquare className="w-4 h-4 text-white shrink-0" />
                        Chat Twitch
                      </button>
                      <button onClick={handleAddAsset} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <ImagePlus className="w-4 h-4 text-white shrink-0" />
                        Importer image
                      </button>
                      <button onClick={handleOpenLibrary} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-white shrink-0" />
                        Bibliothèque
                      </button>
                      <button onClick={handleAddText} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <Type className="w-4 h-4 text-white shrink-0" />
                        Texte
                      </button>
                      <div className="h-px bg-white/[0.06] mx-2" />
                      <button onClick={() => handleAddShape("rectangle")} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <Square className="w-4 h-4 text-white shrink-0" />
                        Rectangle
                      </button>
                      <button onClick={() => handleAddShape("circle")} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <Circle className="w-4 h-4 text-white shrink-0" />
                        Cercle
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {leftTab === "hotpoints" && (
              <HotPointsPanel
                hotPoint={hotPoint}
                currentTime={currentTime}
                onSeek={seek}
              />
            )}

            {leftTab === "transcription" && (
              editEnvLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                </div>
              ) : (
                <TranscriptionPanel
                  words={transcriptWords}
                  currentTime={currentTime}
                  onSeek={seek}
                />
              )
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
                  onChatChange={updateChat}
                  onAssetChange={updateAsset}
                  onTextChange={updateText}
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
                  ? "bg-white/[0.08] text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"
              }`}
              title={t("editor.properties")}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            <button
              onClick={() => setRightTab("themes")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                rightTab === "themes"
                  ? "bg-white/[0.08] text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"
              }`}
              title={t("editor.themes")}
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Bottom: Playback ─── */}
      <PlaybackBar
        currentTime={currentTime}
        duration={duration}
        playing={playing}
        trimStart={0}
        trimEnd={duration}
        onSeek={seek}
        onTogglePlay={togglePlay}
        onTrimChange={() => {}}
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
                      className="group relative aspect-square rounded-lg overflow-hidden border border-white/[0.06] hover:border-white/[0.2] transition-colors bg-zinc-800"
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
                className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 hover:text-zinc-100 transition-colors flex items-center justify-center gap-2 font-medium"
              >
                <Plus className="w-4 h-4" />
                Importer une nouvelle image
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Export launched toast ─── */}
      {exportToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] bg-zinc-900 border border-white/[0.1] rounded-xl shadow-2xl px-5 py-4 flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm text-white font-medium">Export lance</p>
            <p className="text-[11px] text-zinc-400">
              Tu peux suivre la progression et telecharger dans la page Exports.
            </p>
          </div>
          <a
            href="/exports"
            className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-zinc-200 hover:text-zinc-100 transition-colors font-medium whitespace-nowrap"
          >
            Voir les exports
          </a>
          <button
            onClick={() => setExportToast(false)}
            className="text-zinc-600 hover:text-white transition-colors ml-1"
          >
            <X className="w-4 h-4" />
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
              // Adjust transform to match the new crop's aspect ratio (no distortion)
              commitTransform();
              setLayers((prev) =>
                prev.map((l) => {
                  if (l.id !== cropEditingId || !l.video) return l;
                  const aspectRatio = newCrop.h / newCrop.w;
                  const newHeight = Math.round(l.transform.width * aspectRatio);
                  return {
                    ...l,
                    video: { ...l.video, crop: newCrop },
                    transform: { ...l.transform, height: newHeight },
                  };
                }),
              );
              setCropEditingId(null);
            }}
            onCancel={() => setCropEditingId(null)}
          />
        );
      })()}
    </div>
  );
}
