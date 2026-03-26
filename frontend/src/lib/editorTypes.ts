/* ── Layer types ─────────────────────────────────────────── */

export type LayerType = "video";

export interface LayerTransform {
  x: number;      // px in canvas space (1080×1920)
  y: number;
  width: number;
  height: number;
}

export interface VideoLayerData {
  src: string;
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  transform: LayerTransform;
  video?: VideoLayerData;
}
