import type { TranscriptWord } from "./api";

/* ── Layer types ─────────────────────────────────────────── */

export type LayerType = "video" | "text";

export interface LayerTransform {
  x: number;      // px in canvas space (1080×1920)
  y: number;
  width: number;
  height: number;
}

export interface VideoCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VideoLayerData {
  src: string;
  crop?: VideoCrop;       // crop region in source video pixels
  borderRadius?: number;
  blur?: number;          // CSS blur sigma
  brightness?: number;    // 0-1 scale
}

export interface TextLayerData {
  words: TranscriptWord[];
  fontSize: number;
  fontFamily: string;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  uppercase: boolean;
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  transform: LayerTransform;
  video?: VideoLayerData;
  text?: TextLayerData;
}

/* ── Edit environment (from backend) ─────────────────────── */

export interface EditEnvironment {
  clip_width: number;
  clip_height: number;
  facecam: { x: number; y: number; w: number; h: number } | null;
  game_crop: { x: number; y: number; w: number; h: number };
  layout: {
    canvas_w: number;
    canvas_h: number;
    game_h: number;
    game_y: number;
    cam_size: number;
    cam_margin_top: number;
    cam_border_radius: number;
    blur_sigma: number;
    game_margin_bottom: number;
  };
  words: { word: string; start: number; end: number }[];
}
