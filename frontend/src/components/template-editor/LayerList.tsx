import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Captions, ChevronDown, ChevronUp, EyeOff, Gamepad2, GripVertical, Image, MessageSquare, Sparkles, Type, Webcam } from "lucide-react";

export interface LayerItem {
  key: string;
  label: string;
  /** Hidden for now (webcam, hook or chat switched off) */
  hidden?: boolean;
}

interface Props {
  /** Bottom to top, like the render */
  items: LayerItem[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** Move `key` to `index` in the bottom-to-top order */
  onMove: (key: string, index: number) => void;
  /** Extra controls in the header (add a widget) */
  action?: ReactNode;
}

const ROW = 36;

function iconOf(key: string) {
  if (key === "game") return Gamepad2;
  if (key === "cam") return Webcam;
  if (key === "subtitles") return Captions;
  if (key === "hook") return Type;
  if (key === "chat") return MessageSquare;
  if (key === "background") return Image;
  return Sparkles;
}

/**
 * The template's layers, front ones first: click to select, drag the grip
 * (or use the arrows) to put an element in front of or behind another. The
 * background stays at the back.
 */
export default function LayerList({ items, selected, onSelect, onMove, action }: Props) {
  const { t } = useTranslation();
  // Front first on screen
  const rows = [...items].reverse();
  const [drag, setDrag] = useState<{ key: string; from: number; dy: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const target = drag ? Math.max(0, Math.min(rows.length - 1, drag.from + Math.round(drag.dy / ROW))) : null;
  const toOrderIndex = (row: number) => rows.length - 1 - row;

  const startDrag = (e: ReactPointerEvent, key: string, from: number) => {
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    setDrag({ key, from, dy: 0 });
    const move = (ev: PointerEvent) => setDrag((d) => (d ? { ...d, dy: ev.clientY - y0 } : d));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const to = Math.max(0, Math.min(rows.length - 1, d.from + Math.round(d.dy / ROW)));
      if (to !== d.from) onMove(d.key, toOrderIndex(to));
      else onSelect(d.key);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** Where a row sits while another one is dragged over the list */
  const shift = (row: number) => {
    if (!drag || target === null || row === drag.from) return 0;
    if (drag.from < row && row <= target) return -ROW;
    if (target <= row && row < drag.from) return ROW;
    return 0;
  };

  const rowClass = (key: string, hidden?: boolean) =>
    `group/layer relative flex items-center gap-2 h-[34px] pl-1 pr-1.5 rounded-[9px] text-[12.5px] font-[550] cursor-pointer select-none ${
      selected === key ? "bg-white text-ground" : hidden ? "text-ink-4 hover:bg-white/[0.05] hover:text-ink-2" : "text-ink-2 hover:bg-white/[0.06] hover:text-white"
    }`;

  return (
    <div className="glass rounded-[18px] p-3">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <span className="text-[12px] font-[550] text-ink-3">{t("templateEditor.layers")}</span>
        {action}
      </div>
      <ol aria-label={t("templateEditor.layers")} className="relative flex flex-col gap-[2px]">
        {rows.map((item, row) => {
          const Icon = iconOf(item.key);
          const dragged = drag?.key === item.key;
          return (
            <li
              key={item.key}
              className={`${rowClass(item.key, item.hidden)} ${dragged ? "z-10 shadow-[0_8px_24px_rgba(0,0,0,0.45)] bg-[#2a2c31] text-white" : "transition-transform duration-150"}`}
              style={{ transform: `translateY(${dragged ? drag.dy : shift(row)}px)` }}
              onClick={() => onSelect(item.key)}
            >
              <span
                role="button"
                aria-label={t("templateEditor.dragLayer")}
                title={t("templateEditor.dragLayer")}
                className="w-5 h-7 grid place-items-center cursor-grab active:cursor-grabbing opacity-40 group-hover/layer:opacity-80 touch-none"
                onPointerDown={(e) => startDrag(e, item.key, row)}
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical className="w-3.5 h-3.5" />
              </span>
              <Icon className="w-3.5 h-3.5 flex-none opacity-80" />
              <span className="flex-1 min-w-0 truncate">{item.label}</span>
              {item.hidden && <EyeOff aria-label={t("templateEditor.hidden")} className="w-3.5 h-3.5 flex-none opacity-70" />}
              <span className={`flex items-center ${selected === item.key ? "" : "opacity-0 group-hover/layer:opacity-100"}`}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (row > 0) onMove(item.key, toOrderIndex(row - 1));
                  }}
                  disabled={row === 0}
                  aria-label={t("templateEditor.bringForward")}
                  title={t("templateEditor.bringForward")}
                  className="w-6 h-6 grid place-items-center rounded-[6px] hover:bg-black/10 disabled:opacity-30"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (row < rows.length - 1) onMove(item.key, toOrderIndex(row + 1));
                  }}
                  disabled={row === rows.length - 1}
                  aria-label={t("templateEditor.sendBackward")}
                  title={t("templateEditor.sendBackward")}
                  className="w-6 h-6 grid place-items-center rounded-[6px] hover:bg-black/10 disabled:opacity-30"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          );
        })}
        <li className={rowClass("background")} onClick={() => onSelect("background")}>
          <span className="w-5" />
          <Image className="w-3.5 h-3.5 flex-none opacity-80" />
          <span className="flex-1 min-w-0 truncate">{t("templateEditor.el.background")}</span>
        </li>
      </ol>
    </div>
  );
}
