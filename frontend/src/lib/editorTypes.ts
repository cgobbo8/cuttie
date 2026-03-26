/* ── Layer types ─────────────────────────────────────────── */

/** Category of the layer — decoupled from its name. */
export type LayerType = "gameplay" | "facecam" | "subtitles" | "asset" | "shape";

export interface LayerTransform {
  x: number;      // px in canvas space (1080×1920)
  y: number;
  width: number;
  height: number;
}

export interface LayerStyle {
  opacity: number;       // 0–1
  blur: number;          // px (CSS blur)
  borderRadius: number;  // px
}

export const DEFAULT_STYLE: LayerStyle = { opacity: 1, blur: 0, borderRadius: 0 };

export interface VideoLayerData {
  src: string;
  /** Source-resolution crop rect (facecam only) */
  crop?: { x: number; y: number; w: number; h: number };
}

export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleData {
  words: SubtitleWord[];
  fontFamily: string;
  fontSize: number;       // canvas px
  colorMode: "auto" | "custom";
  customColor: string;    // hex (#RRGGBB)
  autoColor: string;      // hex — dominant color from backend
  uppercase: boolean;
}

export const SUBTITLE_FONTS = [
  { value: "Luckiest Guy", label: "Luckiest Guy" },
  { value: "Bebas Neue", label: "Bebas Neue" },
  { value: "Impact", label: "Impact" },
  { value: "Arial Black", label: "Arial Black" },
  { value: "Inter", label: "Inter" },
];

export interface AssetData {
  /** Data URL (base64) or object URL for the image */
  src: string;
}

export type ShapeType = "rectangle" | "circle";

export interface ShapeData {
  shapeType: ShapeType;
  backgroundColor: string;   // hex or rgba
  backgroundAlpha: number;    // 0–1
  backdropBlur: number;       // px — CSS backdrop-filter: blur()
  boxShadowPreset: string;    // key from BOX_SHADOW_PRESETS
}

export const BOX_SHADOW_PRESETS: Record<string, { label: string; value: string }> = {
  none: { label: "Aucune", value: "none" },
  soft: { label: "Douce", value: "0 4px 20px rgba(0,0,0,0.25)" },
  medium: { label: "Moyenne", value: "0 8px 40px rgba(0,0,0,0.4)" },
  strong: { label: "Forte", value: "0 12px 60px rgba(0,0,0,0.6)" },
  glow: { label: "Glow", value: "0 0 40px rgba(168,85,247,0.5)" },
  neon: { label: "Neon", value: "0 0 20px rgba(168,85,247,0.6), 0 0 60px rgba(168,85,247,0.3)" },
  outline: { label: "Outline", value: "inset 0 0 0 3px rgba(255,255,255,0.3)" },
};

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  transform: LayerTransform;
  style: LayerStyle;
  video?: VideoLayerData;
  subtitle?: SubtitleData;
  asset?: AssetData;
  shape?: ShapeData;
}
