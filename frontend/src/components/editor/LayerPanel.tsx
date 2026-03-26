import { useState, useCallback } from "react";
import { Video, User, MessageSquare, Image, Square, Eye, EyeOff, Lock } from "lucide-react";
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

const LAYER_ICONS: Record<LayerType, typeof Video> = {
  gameplay: Video,
  facecam: User,
  subtitles: MessageSquare,
  asset: Image,
  shape: Square,
};

function LayerIcon({ type }: { type: LayerType }) {
  const Icon = LAYER_ICONS[type] ?? Video;
  return <Icon className="w-3.5 h-3.5" />;
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
                {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
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
                <Lock className="w-3 h-3" />
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
