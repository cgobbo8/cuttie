import { Plus } from "lucide-react";
import { WIDGET_REGISTRY, buildDefaultProps, type WidgetDefinition } from "./widgets/registry";

interface Props {
  onAddWidget: (def: WidgetDefinition) => void;
}

function WidgetCard({ def, onAdd }: { def: WidgetDefinition; onAdd: () => void }) {
  return (
    <div className="group border border-white/[0.06] rounded-lg overflow-hidden hover:border-white/[0.15] transition-colors bg-white/[0.02]">
      {/* Preview */}
      <div className="relative h-24 flex items-center justify-center bg-zinc-900/50 overflow-hidden px-3">
        <div style={{ transform: "scale(0.4)", transformOrigin: "center center" }}>
          <def.Component
            props={buildDefaultProps(def)}
            width={def.defaultTransform.width}
            height={def.defaultTransform.height}
          />
        </div>
      </div>

      {/* Info + action */}
      <div className="px-2.5 py-2 flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-300 font-medium truncate">{def.name}</div>
          <div className="text-[10px] text-zinc-600 truncate">{def.description}</div>
        </div>
        <button
          onClick={onAdd}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-400 hover:text-zinc-100 transition-colors"
          title="Ajouter au canvas"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function WidgetLibraryPanel({ onAddWidget }: Props) {
  const widgets = Object.values(WIDGET_REGISTRY);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          Widgets
        </h4>
        <span className="text-[10px] text-zinc-600">{widgets.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
        {widgets.map((def) => (
          <WidgetCard
            key={def.id}
            def={def}
            onAdd={() => onAddWidget(def)}
          />
        ))}

        {widgets.length === 0 && (
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="text-[11px] text-zinc-600 text-center">Aucun widget disponible</p>
          </div>
        )}
      </div>
    </div>
  );
}
