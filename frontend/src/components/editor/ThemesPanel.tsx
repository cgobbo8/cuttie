import { useCallback, useEffect, useState } from "react";
import type { Layer } from "../../lib/editorTypes";
import type { EditorTheme, ThemeLayerTemplate } from "../../lib/editorThemes";
import { getAllThemes, loadUserThemes, saveUserThemes } from "../../lib/editorThemes";

interface Props {
  layers: Layer[];
  onApplyTheme: (templates: ThemeLayerTemplate[]) => void;
}

export default function ThemesPanel({ layers, onApplyTheme }: Props) {
  const [themes, setThemes] = useState<EditorTheme[]>(() => getAllThemes());
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  // Refresh when panel mounts
  useEffect(() => setThemes(getAllThemes()), []);

  const handleSave = useCallback(() => {
    const name = saveName.trim();
    if (!name || layers.length === 0) return;

    // Convert current layers to templates (strip clip-specific data)
    const templates: ThemeLayerTemplate[] = layers.map((l) => {
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
      if (l.shape) tpl.shape = { ...l.shape };
      if (l.asset) tpl.asset = { ...l.asset };
      return tpl;
    });

    const theme: EditorTheme = {
      id: `user_${Date.now().toString(36)}`,
      name,
      layers: templates,
    };

    const userThemes = [...loadUserThemes(), theme];
    saveUserThemes(userThemes);
    setThemes(getAllThemes());
    setSaveName("");
    setShowSave(false);
  }, [saveName, layers]);

  const handleDelete = useCallback((id: string) => {
    const userThemes = loadUserThemes().filter((t) => t.id !== id);
    saveUserThemes(userThemes);
    setThemes(getAllThemes());
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          Thèmes
        </h4>
        <span className="text-[10px] text-zinc-600">{themes.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {themes.map((theme) => (
          <div
            key={theme.id}
            className="group flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
          >
            {/* Mini preview: colored dots for each layer type */}
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
              <div className="text-xs text-zinc-300 truncate">{theme.name}</div>
              <div className="text-[10px] text-zinc-600">
                {theme.layers.length} calque{theme.layers.length > 1 ? "s" : ""}
                {theme.builtIn && <span className="ml-1 text-zinc-700">- intégré</span>}
              </div>
            </div>

            <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onApplyTheme(theme.layers)}
                className="text-[10px] px-2 py-1 rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 hover:text-purple-200 transition-colors font-medium"
              >
                Appliquer
              </button>
              {!theme.builtIn && (
                <button
                  onClick={() => handleDelete(theme.id)}
                  className="text-[10px] px-1.5 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
                  title="Supprimer"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Save current layout as theme */}
      <div className="shrink-0 border-t border-white/[0.06] p-2">
        {showSave ? (
          <div className="flex flex-col gap-2">
            <input
              className="w-full text-xs bg-white/[0.06] text-zinc-300 rounded-md px-2.5 py-1.5 border border-white/[0.06] outline-none focus:border-purple-500/50 placeholder-zinc-600"
              placeholder="Nom du thème..."
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowSave(false); }}
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={handleSave}
                disabled={!saveName.trim() || layers.length === 0}
                className="flex-1 text-[10px] px-2 py-1.5 rounded-md bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 hover:text-purple-200 transition-colors font-medium disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Enregistrer
              </button>
              <button
                onClick={() => setShowSave(false)}
                className="text-[10px] px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowSave(true)}
            disabled={layers.length === 0}
            className="w-full text-xs px-3 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 transition-colors flex items-center justify-center gap-2 font-medium disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Sauvegarder le layout
          </button>
        )}
      </div>
    </div>
  );
}
