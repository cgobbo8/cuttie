import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Player, type PlayerRef } from "@remotion/player";
import type { Layer } from "../../lib/editorTypes";
import { COVERED_ZONES, coveredBy, dragBox, type Box, type Guide, type Handle } from "../../lib/templateSpec";
import CuttieComposition from "../remotion-editor/CuttieComposition";
import TemplateSketch from "../montage/TemplateSketch";

/** An element of the template the streamer can grab */
export interface CanvasElement {
  key: string;
  label: string;
  box: Box;
  /** Corners keep the shape (round webcam, logos) */
  keepRatio?: boolean;
  /** Warn when the apps' interface hides it (not for the game, which may run under it) */
  checkZones?: boolean;
}

interface Props {
  layers: Layer[];
  elements: CanvasElement[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** `done`: the drag ended (worth an undo step) */
  onBoxChange: (key: string, box: Box, done: boolean) => void;
  showZones: boolean;
  /** Display height in pixels (the frame is 1080x1920) */
  height: number;
  durationInFrames: number;
  playerRef: RefObject<PlayerRef | null>;
  initialFrame?: number;
  /** No clip to play: a still frame instead */
  still: { frameUrl: string | null; sample: string[] } | null;
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSORS: Record<Handle, string> = {
  move: "move",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/** Grab area around each handle, bigger than the square drawn */
const GRAB = 22;

function handleStyle(h: Handle): React.CSSProperties {
  const style: React.CSSProperties = { cursor: CURSORS[h], width: GRAB, height: GRAB };
  if (h.includes("n")) style.top = -GRAB / 2;
  else if (h.includes("s")) style.bottom = -GRAB / 2;
  else style.top = `calc(50% - ${GRAB / 2}px)`;
  if (h.includes("w")) style.left = -GRAB / 2;
  else if (h.includes("e")) style.right = -GRAB / 2;
  else style.left = `calc(50% - ${GRAB / 2}px)`;
  return style;
}

/**
 * The live preview with every element grabbable: click to select, drag to
 * move, handles to resize. Elements stick to the frame, its center, the other
 * elements and the parts TikTok / Shorts / Reels cover, and may run past the
 * frame's edges. The selected element's handles sit above everything, so an
 * element on top of it never steals them.
 */
export default function EditorCanvas({
  layers,
  elements,
  selected,
  onSelect,
  onBoxChange,
  showZones,
  height,
  durationInFrames,
  playerRef,
  initialFrame = 0,
  still,
}: Props) {
  const { t } = useTranslation();
  const scale = height / 1920;
  const width = Math.round(1080 * scale);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const dragging = useRef(false);

  const px = (b: Box): React.CSSProperties => ({ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale });
  const isCovered = (element: CanvasElement) => showZones && element.checkZones !== false && coveredBy(element.box).length > 0;

  const startDrag = (e: ReactPointerEvent, element: CanvasElement, handle: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(element.key);
    const start = element.box;
    const others = elements.filter((el) => el.key !== element.key).map((el) => el.box);
    const origin = { x: e.clientX, y: e.clientY };
    let last = start;
    dragging.current = true;

    const move = (ev: PointerEvent) => {
      const { box, guides: lines } = dragBox(start, handle, (ev.clientX - origin.x) / scale, (ev.clientY - origin.y) / scale, others, {
        keepRatio: (element.keepRatio && handle.length === 2) || ev.shiftKey,
        snap: !ev.altKey,
      });
      last = box;
      setGuides(lines);
      onBoxChange(element.key, box, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragging.current = false;
      setGuides([]);
      if (last !== start) onBoxChange(element.key, last, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const active = elements.find((el) => el.key === selected) ?? null;
  const activeCovered = active ? isCovered(active) : false;

  return (
    <div className="relative select-none" style={{ width, height }}>
      {/* The frame: what the clip shows */}
      <div className="absolute inset-0 rounded-[22px] overflow-hidden border border-white/[0.14] bg-black">
        {still ? (
          <TemplateSketch layers={layers} frameUrl={still.frameUrl} width={width} sample={still.sample} />
        ) : (
          <Player
            ref={playerRef}
            component={CuttieComposition}
            inputProps={{ layers }}
            compositionWidth={1080}
            compositionHeight={1920}
            fps={30}
            durationInFrames={durationInFrames}
            initialFrame={Math.min(initialFrame, durationInFrames - 1)}
            loop
            controls={false}
            clickToPlay={false}
            acknowledgeRemotionLicense
            style={{ width, height }}
          />
        )}
        {showZones &&
          COVERED_ZONES.map((zone) => (
            <div
              key={zone.id}
              className="absolute pointer-events-none border border-dashed border-white/30 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.10)_0_6px,transparent_6px_14px)]"
              style={px(zone.box)}
            >
              <span
                className={`absolute text-[10px] font-semibold uppercase tracking-wide text-white/70 whitespace-nowrap ${zone.id === "right" ? "right-1 top-1.5 [writing-mode:vertical-rl]" : "left-1.5 top-1"}`}
              >
                {t(`templateEditor.zone.${zone.id}`)}
              </span>
            </div>
          ))}
      </div>

      {/* Editing layer, not clipped: elements can be pushed past the edges. Clicking the empty frame selects the background */}
      <div className="absolute inset-0" onPointerDown={() => !dragging.current && onSelect("background")}>
        {elements.map((element) => {
          const covered = isCovered(element);
          const showHover = hovered === element.key && element.key !== selected;
          return (
            <div
              key={element.key}
              role="button"
              aria-label={element.label}
              aria-pressed={element.key === selected}
              className="absolute"
              style={{ ...px(element.box), cursor: "move" }}
              onPointerDown={(e) => startDrag(e, element, "move")}
              onPointerEnter={() => setHovered(element.key)}
              onPointerLeave={() => setHovered((h) => (h === element.key ? null : h))}
            >
              {(showHover || (covered && element.key !== selected)) && (
                <span
                  className={`absolute inset-0 rounded-[3px] pointer-events-none ${
                    showHover ? "shadow-[0_0_0_1px_rgba(255,255,255,0.7)]" : "shadow-[0_0_0_1px_rgba(245,177,76,0.7)]"
                  }`}
                />
              )}
              {showHover && (
                <span className="absolute -top-[22px] left-0 px-1.5 h-[18px] rounded-[5px] text-[10.5px] font-semibold whitespace-nowrap flex items-center pointer-events-none bg-white/90 text-ground">
                  {element.label}
                </span>
              )}
            </div>
          );
        })}

        {/* The selection: outline, name and handles above every element */}
        {active && (
          <div className="absolute pointer-events-none" style={px(active.box)}>
            <span
              className={`absolute inset-0 rounded-[3px] ${activeCovered ? "shadow-[0_0_0_2px_#F5B14C]" : "shadow-[0_0_0_2px_var(--color-accent)]"}`}
            />
            <span
              className={`absolute -top-[22px] left-0 px-1.5 h-[18px] rounded-[5px] text-[10.5px] font-semibold whitespace-nowrap flex items-center ${
                activeCovered ? "bg-[#F5B14C] text-[#1a1206]" : "bg-accent text-accent-ink"
              }`}
            >
              {active.label}
            </span>
            {HANDLES.map((h) => (
              <span
                key={h}
                className="absolute grid place-items-center pointer-events-auto touch-none"
                style={handleStyle(h)}
                onPointerDown={(e) => startDrag(e, active, h)}
              >
                <span className="w-3 h-3 rounded-[3px] bg-white border-2 border-accent shadow-[0_1px_4px_rgba(0,0,0,0.5)]" />
              </span>
            ))}
          </div>
        )}

        {guides.map((g, i) => (
          <span
            key={i}
            className="absolute bg-accent pointer-events-none shadow-[0_0_6px_var(--color-accent-glow)]"
            style={g.axis === "x" ? { left: g.at * scale, top: 0, width: 1, height } : { top: g.at * scale, left: 0, height: 1, width }}
          />
        ))}
      </div>
    </div>
  );
}
