import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Undo2, Redo2, Loader2, Download, Plus, Video, User, MessageSquare, MessagesSquare, ImagePlus, FolderOpen, Square, Circle, SlidersHorizontal, LayoutTemplate, Sparkles, X, Check, Pencil, Type, Flame, FileText, Layers, Bot, Puzzle } from "lucide-react";
import { clipUrl, getEditEnvironment, startRender, renameClip, uploadAsset, listAssets, assetUrl, type EditEnvironment, type HotPoint, type AssetInfo, type TranscriptWord } from "../../lib/api";
import type { Layer, SubtitleData } from "../../lib/editorTypes";
import { DEFAULT_SUBTITLE_CONFIG } from "../../lib/editorTypes";
import type { ThemeLayerTemplate } from "../../lib/editorThemes";
import { fetchDefaultTheme } from "../../lib/editorThemes";
import { useEditorState } from "../editor/useEditorState";
import NativePreviewViewport from "./NativePreviewViewport";
import LayerPanel from "../editor/LayerPanel";
import PropertiesPanel from "../editor/PropertiesPanel";
import AnimationsPanel from "../editor/AnimationsPanel";
import ThemesPanel from "../editor/ThemesPanel";
import PlaybackBar from "../editor/PlaybackBar";
import HotPointsPanel from "../editor/HotPointsPanel";
import TranscriptionPanel from "../editor/TranscriptionPanel";
import CropEditor from "../editor/CropEditor";
import AiPanel from "../editor/AiPanel";
import WidgetLibraryPanel from "../editor/WidgetLibraryPanel";
import { buildDefaultProps, type WidgetDefinition } from "../editor/widgets/registry";
import { useAccess } from "../../lib/useAccess";
import { Permissions } from "../../lib/permissions";

interface Props {
  jobId: string;
  hotPoint: HotPoint;
  onClose: () => void;
}

type RightTab = "properties" | "animations" | "themes" | "widgets" | "ai";
type LeftTab = "layers" | "hotpoints" | "transcription";

let _nextApplyId = 0;
function applyUid() {
  return `layer_a${++_nextApplyId}_${Date.now().toString(36)}`;
}

export default function RemotionEditor({ jobId, hotPoint, onClose }: Props) {
  const { t } = useTranslation();
  const clipKey = `${jobId}_${hotPoint.clip_filename}`;
  const editor = useEditorState(clipKey);
  const {
    layers, setLayers, selectedId, setSelectedId, selected,
    setCurrentTime,
    addLayer,
    updateTransform, commitTransform, updateStyle, updateSubtitle, updateShape, updateChat, updateAsset, updateText, updateWidget,
    addAnimation, updateAnimation, removeAnimation,
    addKeyframe, toggleKeyframe, removeKeyframe, updateKeyframeEasing,
    reorderLayers, duplicateLayer, removeLayer, renameLayer, toggleVisibility, toggleLock,
    undo, redo, hadSavedLayers,
  } = editor;

  const canUseAi = useAccess(Permissions.EDITOR_AI_WRITE);

  const rawClipUrl = clipUrl(jobId, hotPoint.clip_filename!);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [cropEditingId, setCropEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetLibrary, setAssetLibrary] = useState<AssetInfo[]>([]);
  const [rightTab, setRightTab] = useState<RightTab>("properties");
  const [leftTab, setLeftTab] = useState<LeftTab>("layers");
  const [transcriptWords, setTranscriptWords] = useState<TranscriptWord[]>([]);
  const [showSafeZones, setShowSafeZones] = useState(() => localStorage.getItem("cuttie_safe_zones") === "1");

  // ── Clip name state ──
  const [clipName, setClipName] = useState(hotPoint.clip_name || `Clip ${hotPoint.timestamp_display}`);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(clipName);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleNameSubmit = useCallback(() => {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== clipName) {
      setClipName(trimmed);
      renameClip(jobId, hotPoint.clip_filename!, trimmed).catch(() => {});
    }
    setEditingName(false);
  }, [nameInput, clipName, jobId, hotPoint.clip_filename]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleNameSubmit();
    if (e.key === "Escape") { setNameInput(clipName); setEditingName(false); }
    e.stopPropagation();
  }, [handleNameSubmit, clipName]);

  useEffect(() => {
    if (editingName && nameInputRef.current) nameInputRef.current.select();
  }, [editingName]);

  // Video metadata — probed via a lightweight metadata-only fetch
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  useEffect(() => {
    const vid = document.createElement("video");
    vid.src = rawClipUrl;
    vid.preload = "metadata";
    vid.onloadedmetadata = () => setVideoDuration(vid.duration);
    return () => { vid.src = ""; };
  }, [rawClipUrl]);

  // ── Trim state (persisted separately from layers) ──
  const trimKey = `cuttie_trim_${clipKey}`;
  const [trimStart, setTrimStart] = useState<number>(() => {
    try { const v = localStorage.getItem(trimKey); if (v) { const p = JSON.parse(v); return p.start ?? 0; } } catch {} return 0;
  });
  const [trimEnd, setTrimEnd] = useState<number>(() => {
    try { const v = localStorage.getItem(trimKey); if (v) { const p = JSON.parse(v); return p.end ?? Infinity; } } catch {} return Infinity;
  });

  // Resolve trimEnd once duration is known
  const effectiveTrimEnd = trimEnd === Infinity ? (videoDuration ?? 0) : trimEnd;

  // Persist trim
  useEffect(() => {
    if (videoDuration === null) return;
    try {
      localStorage.setItem(trimKey, JSON.stringify({ start: trimStart, end: effectiveTrimEnd }));
    } catch {}
  }, [trimKey, trimStart, effectiveTrimEnd, videoDuration]);

  // Initialize trimEnd to full duration once known
  useEffect(() => {
    if (videoDuration !== null && trimEnd === Infinity) setTrimEnd(videoDuration);
  }, [videoDuration, trimEnd]);

  const handleTrimChange = useCallback((start: number, end: number) => {
    setTrimStart(start);
    setTrimEnd(end);
    // Push playhead if it falls outside new trim bounds
    const video = videoRef.current;
    if (video) {
      if (video.currentTime < start) { video.currentTime = start; setPlayerTime(start); }
      else if (video.currentTime > end) { video.currentTime = end; setPlayerTime(end); }
    }
  }, []);

  // ── Waveform extraction (Web Audio API) ──
  const [waveform, setWaveform] = useState<Float32Array | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(rawClipUrl);
        if (cancelled) return;
        const buf = await resp.arrayBuffer();
        if (cancelled) return;
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const audio = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        const raw = audio.getChannelData(0);
        // Downsample to ~500 peaks
        const PEAK_COUNT = 500;
        const blockSize = Math.floor(raw.length / PEAK_COUNT);
        const peaks = new Float32Array(PEAK_COUNT);
        for (let i = 0; i < PEAK_COUNT; i++) {
          let max = 0;
          const start = i * blockSize;
          for (let j = start; j < start + blockSize && j < raw.length; j++) {
            const v = Math.abs(raw[j]);
            if (v > max) max = v;
          }
          peaks[i] = max;
        }
        if (!cancelled) setWaveform(peaks);
      } catch {
        // Audio extraction failed — no waveform, that's fine
      }
    })();
    return () => { cancelled = true; };
  }, [rawClipUrl]);

  // ── Derive chat timestamps + subtitle words from layers ──
  const chatTimestamps = layers
    .filter((l) => l.type === "chat" && l.chat)
    .flatMap((l) => l.chat!.messages.map((m) => m.timestamp));

  const subtitleLayer = layers.find((l) => l.type === "subtitles" && l.subtitle);
  const subtitleWords = subtitleLayer
    ? subtitleLayer.subtitle!.words.map((w) => ({ start: w.start, end: w.end, speaker: w.speaker }))
    : [];

  // Playback state — driven by native video events from NativePreviewViewport
  const [playerTime, setPlayerTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Sync playerTime to the editor hook so keyframes use the correct time
  useEffect(() => { setCurrentTime(playerTime); }, [playerTime, setCurrentTime]);

  const handleTimeUpdate = useCallback((t: number) => {
    setPlayerTime(t);
    // Pause at trim end
    if (t >= effectiveTrimEnd - 0.05) {
      const video = videoRef.current;
      if (video && !video.paused) {
        video.pause();
        video.currentTime = effectiveTrimEnd;
      }
    }
  }, [effectiveTrimEnd]);
  const handlePlay = useCallback(() => setPlaying(true), []);
  const handlePause = useCallback(() => setPlaying(false), []);
  const handleDuration = useCallback((d: number) => setVideoDuration(d), []);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(trimStart, Math.min(t, effectiveTrimEnd));
    if (videoRef.current) videoRef.current.currentTime = clamped;
    setPlayerTime(clamped);
  }, [trimStart, effectiveTrimEnd]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
    } else {
      // If at trim end, jump to trim start before playing
      if (video.currentTime >= effectiveTrimEnd - 0.05) {
        video.currentTime = trimStart;
        setPlayerTime(trimStart);
      }
      video.play().catch(() => {});
    }
  }, [playing, trimStart, effectiveTrimEnd]);

  // Cache edit-env
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

  const handleAddGameplay = useCallback(async () => {
    setAddMenuOpen(false);
    const env = await fetchEditEnv();
    const clipAspect = (env?.clip_width ?? 1920) / (env?.clip_height ?? 1080);
    const h = Math.round(1080 / clipAspect);
    addLayer({
      type: "gameplay",
      name: "Gameplay",
      clipUrl: rawClipUrl,
      transform: { x: 0, y: Math.round((1920 - h) / 2), width: 1080, height: h },
    });
  }, [addLayer, rawClipUrl, fetchEditEnv]);

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
        showSpeaker: (env.words ?? []).some((w) => w.speaker),
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

  const handleAddWidget = useCallback((def: WidgetDefinition) => {
    addLayer({
      type: "widget",
      name: def.name,
      transform: { ...def.defaultTransform },
      widget: {
        widgetId: def.id,
        props: buildDefaultProps(def),
      },
    });
  }, [addLayer]);

  /* ── Theme application ──────────────────────────────────── */

  const handleApplyTheme = useCallback(async (templates: ThemeLayerTemplate[]) => {
    commitTransform();
    let env: EditEnvironment | null = null;
    const needsEnv = templates.some((t) => t.type === "gameplay" || t.type === "facecam" || t.type === "subtitles" || t.type === "chat");
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
        const crop = env?.facecam ?? tpl.videoCrop ?? {
          x: Math.round((env?.clip_width ?? 1920) * 0.65),
          y: Math.round((env?.clip_height ?? 1080) * 0.65),
          w: Math.round(Math.min(env?.clip_width ?? 1920, env?.clip_height ?? 1080) / 3),
          h: Math.round(Math.min(env?.clip_width ?? 1920, env?.clip_height ?? 1080) / 3),
        };
        base.video = { src: rawClipUrl, crop };
      } else if (tpl.type === "subtitles") {
        const subtitleConfig = tpl.subtitle ?? DEFAULT_SUBTITLE_CONFIG;
        const sub: SubtitleData = { ...subtitleConfig, words: env?.words ?? [], autoColor };
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
      } else if (tpl.type === "widget" && tpl.widget) {
        base.widget = { ...tpl.widget, props: { ...tpl.widget.props } };
      }

      if (tpl.animations && tpl.animations.length > 0) {
        base.animations = tpl.animations.map((a) => ({ ...a }));
      }
      if (tpl.keyframes && tpl.keyframes.length > 0) {
        base.keyframes = tpl.keyframes.map((k) => ({ ...k }));
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
    if (hadSavedLayers) return; // clip already has a saved layout — don't override
    defaultAppliedRef.current = true;
    setEditEnvLoading(true);
    fetchDefaultTheme()
      .then((theme) => {
        if (theme) return handleApplyTheme(theme.layers);
      })
      .catch(() => {})
      .finally(() => setEditEnvLoading(false));
  }, [hadSavedLayers, handleApplyTheme]);

  /* ── Export ──────────────────────────────────────────────── */

  const [exporting, setExporting] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportSuccessOpen, setExportSuccessOpen] = useState(false);

  type Resolution = "480p" | "720p" | "1080p";
  type FpsOption = 24 | 30 | 60;
  const RESOLUTIONS: { value: Resolution; label: string; w: number; h: number }[] = [
    { value: "480p", label: "480p", w: 480, h: 854 },
    { value: "720p", label: "HD 720p", w: 720, h: 1280 },
    { value: "1080p", label: "Full HD 1080p", w: 1080, h: 1920 },
  ];
  const FPS_OPTIONS: FpsOption[] = [24, 30, 60];
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [fps, setFps] = useState<FpsOption>(30);

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
      const hasTrim = trimStart > 0 || effectiveTrimEnd < (videoDuration ?? 0);
      const res = RESOLUTIONS.find((r) => r.value === resolution)!;
      await startRender(
        jobId, hotPoint.clip_filename!, exportLayers,
        hasTrim ? { trimStart, trimEnd: effectiveTrimEnd } : undefined,
        clipName,
        { width: res.w, height: res.h, fps },
      );
      setExportModalOpen(false);
      setExportSuccessOpen(true);
    } catch (err) {
      alert(t("editor.exportFailed", { error: err instanceof Error ? err.message : "erreur inconnue" }));
    } finally {
      setExporting(false);
    }
  }, [exporting, layers, jobId, hotPoint.clip_filename, updateSubtitle, trimStart, effectiveTrimEnd, videoDuration, clipName, resolution, fps]);

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
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") { e.preventDefault(); seek(playerTime - (e.shiftKey ? 1 / 30 : 5)); }
      if (e.key === "ArrowRight") { e.preventDefault(); seek(playerTime + (e.shiftKey ? 1 / 30 : 5)); }
      if (e.key === "i" || e.key === "I") { e.preventDefault(); handleTrimChange(playerTime, effectiveTrimEnd); }
      if (e.key === "o" || e.key === "O") { e.preventDefault(); handleTrimChange(trimStart, playerTime); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !selected?.locked) removeLayer(selectedId);
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, onClose, selectedId, selected, removeLayer, undo, redo, seek, playerTime, handleTrimChange, trimStart, effectiveTrimEnd]);

  /* ── Loading state ─────────────────────────────────────── */

  if (videoDuration === null) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
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
            <Loader2 className="w-5 h-5 animate-spin text-white" />
            {t("editor.loadingClipData")}
          </div>
        </div>
      )}

      {/* ─── Top bar ─── */}
      <div className="shrink-0 h-11 border-b border-white/[0.06] flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1.5 text-xs">
            <ArrowLeft className="w-4 h-4" />
            {t("clipEditor.back")}
          </button>
          <div className="h-5 w-px bg-white/[0.06]" />
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={handleNameKeyDown}
              className="text-sm font-semibold text-white bg-white/[0.08] border border-white/[0.2] rounded px-2 py-0.5 outline-none w-48"
              maxLength={60}
            />
          ) : (
            <button
              onClick={() => { setNameInput(clipName); setEditingName(true); }}
              className="text-sm font-semibold text-white hover:text-zinc-200 transition-colors flex items-center gap-1.5 group"
              title={t("editor.renameClip")}
            >
              {clipName}
              <Pencil className="w-3 h-3 text-zinc-600 group-hover:text-white transition-colors" />
            </button>
          )}
          <div className="h-5 w-px bg-white/[0.06]" />
          <div className="flex gap-0.5">
            <button onClick={undo} className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.05]" title={t("editor.undo")}>
              <Undo2 className="w-4 h-4" />
            </button>
            <button onClick={redo} className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-white/[0.05]" title={t("editor.redo")}>
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-600 font-mono">1080×1920</span>
          <button
            onClick={() => setExportModalOpen(true)}
            disabled={layers.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />{t("editor.export")}
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
              title={t("editor.layers")}
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
              title={t("editor.hotpoints")}
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
              title={t("editor.transcription")}
            >
              <FileText className="w-4 h-4" />
            </button>
          </div>

          {/* Content panel */}
          <div className="w-72 flex flex-col">
            {leftTab === "layers" && (
              <>
                <LayerPanel
                  layers={layers}
                  selectedId={selectedId}
                  showSafeZones={showSafeZones}
                  onToggleSafeZones={() => setShowSafeZones((v) => { const next = !v; localStorage.setItem("cuttie_safe_zones", next ? "1" : "0"); return next; })}
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
                    {t("editor.addLayer")}
                  </button>

                  {addMenuOpen && (
                    <div className="absolute bottom-full left-2 right-2 mb-1 bg-zinc-900 border border-white/[0.08] rounded-lg shadow-xl overflow-hidden z-50">
                      <button onClick={handleAddGameplay} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <Video className="w-4 h-4 text-white shrink-0" />{t("editor.gameplay")}
                      </button>
                      <button onClick={handleAddFacecam} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                        <User className="w-4 h-4 text-white shrink-0" />{t("editor.facecam")}
                      </button>
                      <button onClick={handleAddSubtitles} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                        <MessageSquare className="w-4 h-4 text-white shrink-0" />{t("editor.subtitles")}
                      </button>
                      <button onClick={handleAddChat} disabled={editEnvLoading} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-40">
                        <MessagesSquare className="w-4 h-4 text-white shrink-0" />{t("editor.twitchChat")}
                      </button>
                      <button onClick={handleAddAsset} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <ImagePlus className="w-4 h-4 text-white shrink-0" />{t("editor.importImage")}
                      </button>
                      <button onClick={handleOpenLibrary} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-white shrink-0" />{t("editor.library")}
                      </button>
                      <button onClick={handleAddText} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <Type className="w-4 h-4 text-white shrink-0" />{t("editor.text")}
                      </button>
                      <div className="h-px bg-white/[0.06] mx-2" />
                      <button onClick={() => handleAddShape("rectangle")} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <Square className="w-4 h-4 text-white shrink-0" />{t("editor.rectangle")}
                      </button>
                      <button onClick={() => handleAddShape("circle")} className="w-full text-left text-xs px-3 py-2.5 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors flex items-center gap-2">
                        <Circle className="w-4 h-4 text-white shrink-0" />{t("editor.circle")}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {leftTab === "hotpoints" && (
              <HotPointsPanel
                hotPoint={hotPoint}
                currentTime={playerTime}
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
                  currentTime={playerTime}
                  onSeek={seek}
                />
              )
            )}
          </div>
        </div>

        {/* Center: Native preview viewport */}
        <NativePreviewViewport
          layers={layers}
          selectedId={selectedId}
          showSafeZones={showSafeZones}
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
                  onAssetChange={updateAsset}
                  onTextChange={updateText}
                  onWidgetChange={updateWidget}
                  onTransformChange={updateTransform}
                  onCommit={commitTransform}
                  onStartCrop={setCropEditingId}
                  currentTime={playerTime}
                  onToggleKeyframe={toggleKeyframe}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center px-4">
                  <p className="text-[11px] text-zinc-600 text-center">{t("editor.selectLayerProperties")}</p>
                </div>
              )
            )}
            {rightTab === "animations" && (
              selected ? (
                <AnimationsPanel
                  layer={selected}
                  clipDuration={videoDuration ?? 0}
                  onAddAnimation={addAnimation}
                  onUpdateAnimation={updateAnimation}
                  onRemoveAnimation={removeAnimation}
                  onCommit={commitTransform}
                  keyframes={selected.keyframes}
                  currentTime={playerTime}
                  onRemoveKeyframe={(kfId) => removeKeyframe(selected.id, kfId)}
                  onSeekToKeyframe={seek}
                  onUpdateKeyframeEasing={(kfId, easing) => updateKeyframeEasing(selected.id, kfId, easing)}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center px-4">
                  <p className="text-[11px] text-zinc-600 text-center">{t("editor.selectLayerAnimations")}</p>
                </div>
              )
            )}
            {rightTab === "themes" && (
              <ThemesPanel layers={layers} onApplyTheme={handleApplyTheme} />
            )}
            {rightTab === "widgets" && (
              <WidgetLibraryPanel onAddWidget={handleAddWidget} />
            )}
            {rightTab === "ai" && canUseAi && (
              <AiPanel
                layers={layers}
                selectedId={selectedId}
                currentTime={playerTime}
                duration={videoDuration ?? 0}
                trimStart={trimStart}
                trimEnd={effectiveTrimEnd}
                updateTransform={updateTransform}
                updateStyle={updateStyle}
                commitTransform={commitTransform}
                setSelectedId={setSelectedId}
                seek={seek}
                addKeyframe={addKeyframe}
                removeKeyframe={removeKeyframe}
                addAnimation={addAnimation}
                removeAnimation={removeAnimation}
                toggleVisibility={toggleVisibility}
                removeLayer={removeLayer}
                onTrimChange={handleTrimChange}
              />
            )}
          </div>
          <div className="w-11 flex flex-col items-center py-2 gap-1">
            <button
              onClick={() => setRightTab("properties")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${rightTab === "properties" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"}`}
              title={t("editor.properties")}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            <button
              onClick={() => setRightTab("animations")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${rightTab === "animations" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"}`}
              title={t("editor.animations")}
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={() => setRightTab("themes")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${rightTab === "themes" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"}`}
              title={t("editor.themes")}
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
            <button
              onClick={() => setRightTab("widgets")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${rightTab === "widgets" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"}`}
              title="Widgets"
            >
              <Puzzle className="w-4 h-4" />
            </button>
            {canUseAi && (
              <>
                <div className="w-6 border-t border-white/[0.06] mx-auto my-1" />
                <button
                  onClick={() => setRightTab("ai")}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${rightTab === "ai" ? "bg-purple-500/20 text-purple-400" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]"}`}
                  title="AI Assistant"
                >
                  <Bot className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Bottom: Playback ─── */}
      <PlaybackBar
        currentTime={playerTime}
        duration={videoDuration}
        playing={playing}
        trimStart={trimStart}
        trimEnd={effectiveTrimEnd}
        onSeek={seek}
        onTogglePlay={togglePlay}
        onTrimChange={handleTrimChange}
        waveform={waveform}
        chatTimestamps={chatTimestamps.length > 0 ? chatTimestamps : undefined}
        subtitleWords={subtitleWords.length > 0 ? subtitleWords : undefined}
        speakerStyles={subtitleLayer?.subtitle?.speakerStyles}
        selectedLayer={selected}
        selectedLayerKeyframes={selected?.keyframes}
        onUpdateAnimation={updateAnimation}
        onCommitAnimation={commitTransform}
      />

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />

      {/* Asset library modal */}
      {assetLibraryOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setAssetLibraryOpen(false)}>
          <div className="bg-zinc-900 border border-white/[0.08] rounded-xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white">{t("editor.assetLibrary")}</h3>
              <button onClick={() => setAssetLibraryOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {assetLibrary.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-8">{t("editor.noAssets")}</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {assetLibrary.map((a) => (
                    <button
                      key={a.filename}
                      className="group relative aspect-square rounded-lg overflow-hidden border border-white/[0.06] hover:border-white/[0.2] transition-colors bg-zinc-800"
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
                className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 hover:text-zinc-100 transition-colors flex items-center justify-center gap-2 font-medium"
              >
                <Plus className="w-4 h-4" />{t("editor.importNewImage")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export settings modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !exporting && setExportModalOpen(false)} />
          <div className="relative w-full max-w-md mx-4 bg-zinc-900 border border-white/[0.08] rounded-2xl shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
              <h2 className="text-base font-semibold text-white">{t("editor.exportSettings")}</h2>
              <button onClick={() => !exporting && setExportModalOpen(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 block">
                    {t("batchExport.resolution")}
                  </label>
                  <div className="flex flex-col gap-1">
                    {RESOLUTIONS.map((res) => (
                      <button
                        key={res.value}
                        onClick={() => setResolution(res.value)}
                        className={`text-left text-xs px-3 py-2 rounded-lg border transition-all ${
                          resolution === res.value
                            ? "border-white/20 bg-white/[0.06] text-zinc-200"
                            : "border-white/[0.04] bg-white/[0.02] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                        }`}
                      >
                        {res.label}
                        <span className="text-[10px] text-zinc-600 ml-1.5">{res.w}×{res.h}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 block">
                    FPS
                  </label>
                  <div className="flex flex-col gap-1">
                    {FPS_OPTIONS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setFps(f)}
                        className={`text-left text-xs px-3 py-2 rounded-lg border transition-all ${
                          fps === f
                            ? "border-white/20 bg-white/[0.06] text-zinc-200"
                            : "border-white/[0.04] bg-white/[0.02] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                        }`}
                      >
                        {f} fps
                        {f === 24 && <span className="text-[10px] text-zinc-600 ml-1.5">{t("batchExport.fastest")}</span>}
                        {f === 60 && <span className="text-[10px] text-zinc-600 ml-1.5">{t("batchExport.smoothest")}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/[0.06] flex justify-end gap-2">
              <button
                onClick={() => setExportModalOpen(false)}
                disabled={exporting}
                className="text-xs px-4 py-2 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || layers.length === 0}
                className="text-xs px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40"
              >
                {exporting ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t("editor.exporting")}</>
                ) : (
                  <><Download className="w-3.5 h-3.5" />{t("editor.export")}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export success modal */}
      {exportSuccessOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExportSuccessOpen(false)} />
          <div className="relative w-full max-w-sm mx-4 bg-zinc-900 border border-white/[0.08] rounded-2xl shadow-2xl animate-fade-in text-center px-6 py-8">
            <div className="w-12 h-12 rounded-full bg-white/[0.08] flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">{t("editor.exportStarted")}</h3>
            <p className="text-sm text-zinc-400 mb-6">{t("editor.exportStartedHint")}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setExportSuccessOpen(false)}
                className="text-xs px-4 py-2 rounded-lg border border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
              >
                {t("common.cancel")}
              </button>
              <a
                href="/exports"
                className="text-xs px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black font-medium transition-colors"
              >
                {t("editor.viewExports")}
              </a>
            </div>
          </div>
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
            onConfirm={(newCrop) => {
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
