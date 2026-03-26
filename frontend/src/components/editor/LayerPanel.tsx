import { useState, useCallback } from "react";
import type { Layer, LayerType } from "../../lib/editorTypes";

interface Props {
  layers: Layer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function LayerIcon({ type }: { type: LayerType }) {
  if (type === "facecam") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

export default function LayerPanel({
  layers,
  selectedId,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onMove,
  onDuplicate,
  onRemove,
  onRename,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const startRename = useCallback((layer: Layer) => {
    setEditingId(layer.id);
    setEditName(layer.name);
  }, []);

  const commitRename = useCallback(() => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName.trim());
    }
    setEditingId(null);
  }, [editingId, editName, onRename]);

  // Display top-to-bottom (highest z-index first)
  const reversed = [...layers].reverse();

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          Calques
        </h4>
        <span className="text-[10px] text-zinc-600">{layers.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {reversed.map((layer) => {
          const isSelected = layer.id === selectedId;
          return (
            <div
              key={layer.id}
              className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors border-l-2 ${
                isSelected
                  ? "bg-purple-500/10 border-purple-500"
                  : "border-transparent hover:bg-white/[0.03]"
              }`}
              onClick={() => onSelect(layer.id)}
            >
              {/* Visibility toggle */}
              <button
                className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors ${
                  layer.visible ? "text-zinc-400 hover:text-white" : "text-zinc-700"
                }`}
                onClick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }}
                title={layer.visible ? "Masquer" : "Afficher"}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {layer.visible ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
                  )}
                </svg>
              </button>

              {/* Type icon */}
              <span className={`shrink-0 ${layer.visible ? "text-zinc-400" : "text-zinc-700"}`}>
                <LayerIcon type={layer.type} />
              </span>

              {/* Name */}
              {editingId === layer.id ? (
                <input
                  className="flex-1 min-w-0 bg-transparent text-xs text-white border-b border-purple-500 outline-none py-0.5"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className={`flex-1 min-w-0 text-xs truncate ${
                    layer.visible ? "text-zinc-300" : "text-zinc-600"
                  }`}
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(layer); }}
                >
                  {layer.name}
                </span>
              )}

              {/* Lock icon */}
              <button
                className={`shrink-0 w-4 h-4 flex items-center justify-center ${
                  layer.locked ? "text-zinc-500" : "text-transparent hover:text-zinc-600"
                }`}
                onClick={(e) => { e.stopPropagation(); onToggleLock(layer.id); }}
                title={layer.locked ? "Deverrouiller" : "Verrouiller"}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions for selected layer */}
      {selectedId && (
        <div className="shrink-0 border-t border-white/[0.06] px-2 py-2 flex gap-1">
          <button
            className="text-[10px] px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors"
            onClick={() => onMove(selectedId, "up")}
            title="Monter"
          >
            ↑
          </button>
          <button
            className="text-[10px] px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors"
            onClick={() => onMove(selectedId, "down")}
            title="Descendre"
          >
            ↓
          </button>
          <button
            className="text-[10px] px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors"
            onClick={() => onDuplicate(selectedId)}
            title="Dupliquer"
          >
            Dupliquer
          </button>
          <button
            className="text-[10px] px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors ml-auto"
            onClick={() => onRemove(selectedId)}
            title="Supprimer"
          >
            Suppr
          </button>
        </div>
      )}
    </div>
  );
}
