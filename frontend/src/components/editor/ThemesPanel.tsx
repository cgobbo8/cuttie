import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pin, Trash2, Save, Loader2, RefreshCw } from "lucide-react";
import type { Layer } from "../../lib/editorTypes";
import type { EditorTheme, ThemeLayerTemplate } from "../../lib/editorThemes";
import { fetchAllThemes, saveTheme, patchTheme, removeTheme, toggleDefault } from "../../lib/editorThemes";
import { useToast } from "../Toast";

interface Props {
  layers: Layer[];
  onApplyTheme: (templates: ThemeLayerTemplate[]) => void;
}

function layersToTemplates(layers: Layer[]): ThemeLayerTemplate[] {
  return layers.map((l) => {
    const tpl: ThemeLayerTemplate = {
      type: l.type,
      name: l.name,
      transform: { ...l.transform },
      style: { ...l.style },
    };
    if (l.video?.crop) tpl.videoCrop = { ...l.video.crop };
    if (l.subtitle) {
      const { words: _w, autoColor: _a, ...rest } = l.subtitle;
      tpl.subtitle = rest;
    }
    if (l.chat) {
      const { messages: _m, ...rest } = l.chat;
      tpl.chat = rest;
    }
    if (l.shape) tpl.shape = { ...l.shape };
    if (l.asset) tpl.asset = { ...l.asset };
    if (l.text) {
      const { content: _c, ...rest } = l.text;
      tpl.text = rest;
    }
    if (l.animations && l.animations.length > 0) tpl.animations = l.animations.map((a) => ({ ...a }));
    if (l.keyframes && l.keyframes.length > 0) tpl.keyframes = l.keyframes.map((k) => ({ ...k }));
    return tpl;
  });
}

export default function ThemesPanel({ layers, onApplyTheme }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [themes, setThemes] = useState<EditorTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  const refresh = useCallback(async () => {
    const all = await fetchAllThemes();
    setThemes(all);
  }, []);

  useEffect(() => {
    fetchAllThemes()
      .then(setThemes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    const name = saveName.trim();
    if (!name || layers.length === 0) return;
    setSaving(true);
    try {
      await saveTheme(name, layersToTemplates(layers));
      setSaveName("");
      setShowSave(false);
      toast.success(t("editor.themeSaved"));
      await refresh();
    } catch {
      toast.error(t("editor.themeSaveError"));
    } finally {
      setSaving(false);
    }
  }, [saveName, layers, refresh, toast, t]);

  const handleUpdate = useCallback(async (theme: EditorTheme) => {
    if (typeof theme.id === "string" || layers.length === 0) return;
    try {
      await patchTheme(theme.id, { layers: layersToTemplates(layers) });
      toast.success(t("editor.themeUpdated"));
      await refresh();
    } catch {
      toast.error(t("editor.themeSaveError"));
    }
  }, [layers, refresh, toast, t]);

  const handleDelete = useCallback(async (id: number | string) => {
    if (typeof id === "string") return;
    try {
      await removeTheme(id);
      toast.success(t("editor.themeDeleted"));
      await refresh();
    } catch {
      toast.error(t("editor.themeDeleteError"));
    }
  }, [refresh, toast, t]);

  const handleToggleDefault = useCallback(async (id: number | string) => {
    if (typeof id === "string") return;
    try {
      await toggleDefault(id);
      await refresh();
    } catch {
      toast.error(t("editor.themeDefaultError"));
    }
  }, [refresh, toast, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          {t("editor.themes")}
        </h4>
        <span className="text-[10px] text-zinc-600">{themes.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {themes.map((theme) => {
          const isDefault = !!theme.isDefault;
          return (
            <div
              key={theme.id}
              className={`group relative flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors ${
                isDefault ? "bg-white/[0.03]" : ""
              }`}
            >
              {/* Mini preview */}
              <div className="shrink-0 w-8 h-8 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center gap-0.5 flex-wrap p-0.5">
                {theme.layers.map((l, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor:
                        l.type === "gameplay" ? "#a855f7" :
                        l.type === "facecam" ? "#3b82f6" :
                        l.type === "subtitles" ? "#f59e0b" :
                        l.type === "shape" ? "#10b981" :
                        "#6b7280",
                    }}
                  />
                ))}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-300 truncate flex items-center gap-1.5">
                  {theme.name}
                  {isDefault && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.1] text-zinc-200 font-medium leading-none shrink-0">
                      {t("editor.default")}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-600">
                  {t("editor.layerCount", { count: theme.layers.length })}
                  {theme.builtIn && <span className="ml-1 text-zinc-700">{t("editor.builtIn")}</span>}
                </div>
              </div>

              {/* Hover actions — absolute overlay */}
              <div className="absolute inset-0 flex items-center justify-end gap-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-l from-zinc-900 from-60% to-transparent pointer-events-none">
                {!theme.builtIn && (
                  <button
                    onClick={() => handleToggleDefault(theme.id)}
                    className={`pointer-events-auto text-[10px] px-1.5 py-1 rounded transition-colors ${
                      isDefault
                        ? "bg-white/[0.12] text-zinc-200"
                        : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                    }`}
                    title={isDefault ? t("editor.removeDefault") : t("editor.setDefault")}
                  >
                    <Pin className="w-3.5 h-3.5" fill={isDefault ? "currentColor" : "none"} />
                  </button>
                )}
                {!theme.builtIn && layers.length > 0 && (
                  <button
                    onClick={() => handleUpdate(theme)}
                    className="pointer-events-auto text-[10px] px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                    title={t("editor.updateTheme")}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onApplyTheme(theme.layers)}
                  className="pointer-events-auto text-[10px] px-2 py-1 rounded bg-white/[0.1] hover:bg-white/[0.15] text-zinc-200 hover:text-zinc-100 transition-colors font-medium"
                >
                  {t("common.apply")}
                </button>
                {!theme.builtIn && (
                  <button
                    onClick={() => handleDelete(theme.id)}
                    className="pointer-events-auto text-[10px] px-1.5 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-400 hover:text-red-300 transition-colors"
                    title={t("editor.deleteTheme")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Save current layout as theme */}
      <div className="shrink-0 border-t border-white/[0.06] p-2">
        {showSave ? (
          <div className="flex flex-col gap-2">
            <input
              className="w-full text-xs bg-white/[0.06] text-zinc-300 rounded-md px-2.5 py-1.5 border border-white/[0.06] outline-none focus:border-white/[0.2] placeholder-zinc-600"
              placeholder={t("editor.themeNamePlaceholder")}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowSave(false); }}
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={handleSave}
                disabled={!saveName.trim() || layers.length === 0 || saving}
                className="flex-1 text-[10px] px-2 py-1.5 rounded-md bg-white/[0.08] hover:bg-white/[0.12] text-zinc-200 hover:text-zinc-100 transition-colors font-medium disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                {t("editor.saveTheme")}
              </button>
              <button
                onClick={() => setShowSave(false)}
                className="text-[10px] px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {t("editor.cancelTheme")}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowSave(true)}
            disabled={layers.length === 0}
            className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 hover:text-zinc-100 transition-colors flex items-center justify-center gap-2 font-medium disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {t("editor.saveLayout")}
          </button>
        )}
      </div>
    </div>
  );
}
