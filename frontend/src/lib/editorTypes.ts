/* ── Layer types ─────────────────────────────────────────── */

/** Category of the layer — decoupled from its name. */
export type LayerType = "gameplay" | "facecam" | "subtitles" | "asset" | "shape" | "chat" | "text" | "widget";

export interface LayerTransform {
  x: number;      // px in canvas space (1080×1920)
  y: number;
  width: number;
  height: number;
  rotation?: number; // degrees, applied around center (default 0)
}

export interface LayerStyle {
  opacity: number;       // 0–1
  blur: number;          // px (CSS blur)
  borderRadius: number;  // px
  fadeIn: number;        // seconds — fade from 0 to opacity at start
  fadeOut: number;       // seconds — fade from opacity to 0 at end
}

export const DEFAULT_STYLE: LayerStyle = { opacity: 1, blur: 0, borderRadius: 0, fadeIn: 0, fadeOut: 0 };

export interface VideoLayerData {
  src: string;
  /** Source-resolution crop rect (facecam only) */
  crop?: { x: number; y: number; w: number; h: number };
}

export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface SpeakerStyle {
  color: string;      // hex — spoken words color (front/highlight)
  bgColor: string;    // hex — unspoken words color (back/dimmed)
}

export interface SubtitleData {
  words: SubtitleWord[];
  fontFamily: string;
  fontSize: number;       // canvas px
  colorMode: "auto" | "custom";
  customColor: string;    // hex (#RRGGBB)
  autoColor: string;      // hex — dominant color from backend
  uppercase: boolean;
  showSpeaker: boolean;   // per-speaker colored subtitles
  speakerStyles?: Record<string, SpeakerStyle>;  // custom per-speaker colors
}

/** Distinct colors assigned to speakers when showSpeaker is enabled. */
export const SPEAKER_COLORS: string[] = [
  "#E879F9", // fuchsia-400
  "#38BDF8", // sky-400
  "#34D399", // emerald-400
  "#FB923C", // orange-400
  "#F472B6", // pink-400
  "#A78BFA", // violet-400
];

/**
 * Build default speaker styles from words.
 * Speaker 1 (streamer) gets the existing subtitle base color.
 * Speaker 2+ get distinct colors from SPEAKER_COLORS palette.
 */
export function buildDefaultSpeakerStyles(
  words: SubtitleWord[],
  baseColor: string = "#6464C8",
): Record<string, SpeakerStyle> {
  const styles: Record<string, SpeakerStyle> = {};
  let idx = 0;
  for (const w of words) {
    if (w.speaker && !(w.speaker in styles)) {
      if (idx === 0) {
        // Speaker 1 (streamer): normal karaoke — white spoken, base color unspoken
        styles[w.speaker] = { color: "#FFFFFF", bgColor: baseColor };
      } else {
        // Speaker 2+: identity color spoken, white unspoken
        styles[w.speaker] = {
          color: SPEAKER_COLORS[(idx - 1) % SPEAKER_COLORS.length],
          bgColor: "#FFFFFF",
        };
      }
      idx++;
    }
  }
  return styles;
}

/** Default subtitle settings — used as fallback when theme has a subtitle layer but no config. */
export const DEFAULT_SUBTITLE_CONFIG: Omit<SubtitleData, "words" | "autoColor"> = {
  fontFamily: "Luckiest Guy",
  fontSize: 75,
  colorMode: "auto",
  customColor: "#6464C8",
  uppercase: true,
  showSpeaker: false,
};

export const SUBTITLE_FONTS = [
  { value: "Luckiest Guy", label: "Luckiest Guy" },
  { value: "Bebas Neue", label: "Bebas Neue" },
  { value: "Impact", label: "Impact" },
  { value: "Arial Black", label: "Arial Black" },
  { value: "Inter", label: "Inter" },
];

export interface ChatMessage {
  author: string;
  text: string;
  timestamp: number; // seconds relative to clip start
}

export interface ChatData {
  messages: ChatMessage[];
  maxVisible: number;   // max messages shown at once
  fontSize: number;     // canvas px
  fontFamily: string;
  showDuration: number; // seconds a message stays visible
}

export interface AssetData {
  /** Data URL (base64) or object URL for the image */
  src: string;
  /** Whether GIF should loop (default true). false = play once then freeze on last frame. */
  gifLoop?: boolean;
  /** Server-set: presigned URL to a WebM (VP9+alpha) converted from the GIF */
  gifVideoSrc?: string;
}

export type ShapeType = "rectangle" | "circle";

export interface ShapeData {
  shapeType: ShapeType;
  backgroundColor: string;   // hex or rgba
  backgroundAlpha: number;    // 0–1
  backdropBlur: number;       // px — CSS backdrop-filter: blur()
  boxShadowPreset: string;    // key from BOX_SHADOW_PRESETS
}

export interface TextData {
  content: string;
  fontFamily: string;
  fontSize: number;       // canvas px
  color: string;          // hex (#RRGGBB)
  fontWeight: "normal" | "bold";
  textAlign: "left" | "center" | "right";
  uppercase: boolean;
  lineHeight: number;     // multiplier (1.0 = tight, 1.5 = normal)
}

export interface WidgetData {
  widgetId: string;                   // references widget registry (e.g. "twitch-subscribe")
  props: Record<string, unknown>;     // serializable custom props
}

export const TEXT_FONTS = [
  { value: "Inter", label: "Inter" },
  { value: "Luckiest Guy", label: "Luckiest Guy" },
  { value: "Bebas Neue", label: "Bebas Neue" },
  { value: "Impact", label: "Impact" },
  { value: "Arial Black", label: "Arial Black" },
  { value: "Georgia", label: "Georgia" },
  { value: "Courier New", label: "Courier New" },
];

export const BOX_SHADOW_PRESETS: Record<string, { label: string; value: string }> = {
  none: { label: "Aucune", value: "none" },
  soft: { label: "Douce", value: "0 4px 20px rgba(0,0,0,0.25)" },
  medium: { label: "Moyenne", value: "0 8px 40px rgba(0,0,0,0.4)" },
  strong: { label: "Forte", value: "0 12px 60px rgba(0,0,0,0.6)" },
  glow: { label: "Glow", value: "0 0 40px rgba(168,85,247,0.5)" },
  neon: { label: "Neon", value: "0 0 20px rgba(168,85,247,0.6), 0 0 60px rgba(168,85,247,0.3)" },
  outline: { label: "Outline", value: "inset 0 0 0 3px rgba(255,255,255,0.3)" },
};

/* ── Animation system ──────────────────────────────────── */

export type AnimationCategory = "in" | "out";

export type AnimationType =
  | "fadeIn" | "fadeOut"
  | "scaleIn" | "scaleOut"
  | "bounceIn" | "bounceOut"
  | "slideInLeft" | "slideInRight" | "slideInTop" | "slideInBottom"
  | "slideOutLeft" | "slideOutRight" | "slideOutTop" | "slideOutBottom";

export type EasingPreset =
  | "linear"
  | "easeIn" | "easeOut" | "easeInOut"
  | "easeIn.power3" | "easeOut.power3" | "easeInOut.power3"
  | "easeIn.power4" | "easeOut.power4" | "easeInOut.power4"
  | "bounce" | "elastic";

/* ── Keyframe system ─────────────────────────────────────── */

/** Properties captured in a keyframe snapshot */
export type KeyframableProperty = "x" | "y" | "width" | "height" | "rotation" | "opacity" | "scale" | "borderRadius" | "blur";

/** A snapshot of all layer properties at a specific time */
export interface KeyframeSnapshot {
  id: string;
  time: number;         // seconds
  easing: EasingPreset; // easing curve to the NEXT keyframe
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  scale: number;
  borderRadius: number;
  blur: number;
}

export interface LayerAnimation {
  id: string;
  type: AnimationType;
  time: number;      // seconds — when the animation starts
  duration: number;   // seconds
  easing: EasingPreset;
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
  subtitle?: SubtitleData;
  asset?: AssetData;
  shape?: ShapeData;
  chat?: ChatData;
  text?: TextData;
  widget?: WidgetData;
  animations?: LayerAnimation[];
  keyframes?: KeyframeSnapshot[];
}
