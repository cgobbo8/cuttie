/* ── Layer types ─────────────────────────────────────────── */

/** Category of the layer — decoupled from its name. */
export type LayerType = "gameplay" | "facecam";

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

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  transform: LayerTransform;
  style: LayerStyle;
  video?: VideoLayerData;
}
