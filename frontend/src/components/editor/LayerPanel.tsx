import { useState, useCallback, useRef } from "react";
import { Video, User, MessageSquare, MessagesSquare, Image, Square, Eye, EyeOff, Lock, GripVertical, Copy, Trash2 } from "lucide-react";
import type { Layer, LayerType } from "../../lib/editorTypes";

interface Props {
  layers: Layer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

const LAYER_ICONS: Record<LayerType, typeof Video> = {
  gameplay: Video,
  facecam: User,
  subtitles: MessageSquare,
  chat: MessagesSquare,
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
  onReorder,
  onDuplicate,
  onRemove,
  onRename,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // DnD state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dragIdRef = useRef<string | null>(null);

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

  // DnD handlers
  const handleDragStart = useCallback((e: React.DragEvent, layerId: string) => {
    dragIdRef.current = layerId;
    setDragId(layerId);
    e.dataTransfer.effectAllowed = "move";
    const el = document.createElement("div");
    el.style.opacity = "0";
    document.body.appendChild(el);
    e.dataTransfer.setDragImage(el, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(el));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, reversedIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(reversedIdx);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, reversedDropIdx: number) => {
    e.preventDefault();
    const fromId = dragIdRef.current;
    if (!fromId) return;

    const fromReversedIdx = reversed.findIndex((l) => l.id === fromId);
    if (fromReversedIdx < 0 || fromReversedIdx === reversedDropIdx) return;

    const fromRealIdx = layers.length - 1 - fromReversedIdx;
    const toRealIdx = layers.length - 1 - reversedDropIdx;
    onReorder(fromRealIdx, toRealIdx);

    setDragId(null);
    setDropTarget(null);
    dragIdRef.current = null;
  }, [reversed, layers.length, onReorder]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDropTarget(null);
    dragIdRef.current = null;
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          Calques
        </h4>
        <span className="text-[10px] text-zinc-600">{layers.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {reversed.map((layer, reversedIdx) => {
          const isSelected = layer.id === selectedId;
          const isDragging = layer.id === dragId;
          const isDropTarget = dropTarget === reversedIdx && dragId !== layer.id;
          return (
            <div
              key={layer.id}
              draggable={editingId !== layer.id && !layer.locked}
              onDragStart={(e) => handleDragStart(e, layer.id)}
              onDragOver={(e) => handleDragOver(e, reversedIdx)}
              onDrop={(e) => handleDrop(e, reversedIdx)}
              onDragEnd={handleDragEnd}
              className={`group flex items-center gap-1.5 px-1 py-1.5 transition-all border-l-2 ${
                layer.locked
                  ? "border-transparent opacity-60"
                  : isSelected
                    ? "bg-white/[0.06] border-white cursor-pointer"
                    : "border-transparent hover:bg-white/[0.03] cursor-pointer"
              } ${isDragging ? "opacity-30" : ""} ${
                isDropTarget ? "border-t-2 border-t-white" : ""
              }`}
              onClick={() => !layer.locked && onSelect(layer.id)}
            >
              {/* Drag grip */}
              <span className="shrink-0 text-zinc-700 hover:text-zinc-400 cursor-grab active:cursor-grabbing">
                <GripVertical className="w-3 h-3" />
              </span>

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
                  className="flex-1 min-w-0 bg-transparent text-xs text-white border-b border-white outline-none py-0.5"
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

              {/* Inline actions — visible on hover */}
              <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
                  onClick={(e) => { e.stopPropagation(); onDuplicate(layer.id); }}
                  title="Dupliquer"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  className="w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onRemove(layer.id); }}
                  title="Supprimer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Lock icon */}
              <button
                className={`shrink-0 w-4 h-4 flex items-center justify-center ${
                  layer.locked ? "text-zinc-500" : "text-transparent group-hover:text-zinc-600"
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
    </div>
  );
}
