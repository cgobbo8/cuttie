import type { LayerType, LayerTransform, LayerStyle, LayerAnimation, SubtitleData, ShapeData, AssetData, ChatData, TextData } from "./editorTypes";
import { DEFAULT_STYLE } from "./editorTypes";

/* ── Theme layer template ─────────────────────────────────── */

/** A layer definition inside a theme — no clip-specific data (no video src, no subtitle words). */
export interface ThemeLayerTemplate {
  type: LayerType;
  name: string;
  transform: LayerTransform;
  style: LayerStyle;
  /** Facecam source crop (optional — will use auto-detected if absent). */
  videoCrop?: { x: number; y: number; w: number; h: number };
  /** Subtitle settings (words + autoColor are filled at apply time). */
  subtitle?: Omit<SubtitleData, "words" | "autoColor">;
  /** Chat settings (messages are filled at apply time). */
  chat?: Omit<ChatData, "messages">;
  shape?: ShapeData;
  asset?: AssetData;
  text?: Omit<TextData, "content">;
  animations?: LayerAnimation[];
}

export interface EditorTheme {
  id: string;
  name: string;
  layers: ThemeLayerTemplate[];
  builtIn?: boolean;
}

/* ── Built-in themes ──────────────────────────────────────── */

const GAMEPLAY_H = Math.round(1080 * 9 / 16);

export const BUILTIN_THEMES: EditorTheme[] = [
  {
    id: "__gameplay_only",
    name: "Gameplay seul",
    builtIn: true,
    layers: [
      {
        type: "gameplay",
        name: "Gameplay",
        transform: { x: 0, y: Math.round((1920 - GAMEPLAY_H) / 2), width: 1080, height: GAMEPLAY_H },
        style: { ...DEFAULT_STYLE },
      },
    ],
  },
  {
    id: "__classic_vertical",
    name: "Classique",
    builtIn: true,
    layers: [
      {
        type: "gameplay",
        name: "Gameplay",
        transform: { x: 0, y: 660, width: 1080, height: GAMEPLAY_H },
        style: { ...DEFAULT_STYLE },
      },
      {
        type: "facecam",
        name: "Facecam",
        transform: { x: 260, y: 40, width: 560, height: 560 },
        style: { ...DEFAULT_STYLE, borderRadius: 20 },
      },
      {
        type: "subtitles",
        name: "Sous-titres",
        transform: { x: 40, y: 1650, width: 1000, height: 200 },
        style: { ...DEFAULT_STYLE },
        subtitle: {
          fontFamily: "Luckiest Guy",
          fontSize: 75,
          colorMode: "auto",
          customColor: "#6464C8",
          uppercase: true,
        },
      },
    ],
  },
];

/* ── Persistence (localStorage) ───────────────────────────── */

const STORAGE_KEY = "cuttie_themes";
const DEFAULT_THEME_KEY = "cuttie_default_theme";

export function getDefaultThemeId(): string | null {
  return localStorage.getItem(DEFAULT_THEME_KEY);
}

export function setDefaultThemeId(id: string | null) {
  if (id) {
    localStorage.setItem(DEFAULT_THEME_KEY, id);
  } else {
    localStorage.removeItem(DEFAULT_THEME_KEY);
  }
}

export function getDefaultTheme(): EditorTheme | null {
  const id = getDefaultThemeId();
  if (!id) return null;
  return getAllThemes().find((t) => t.id === id) ?? null;
}

export function loadUserThemes(): EditorTheme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EditorTheme[];
  } catch {
    return [];
  }
}

export function saveUserThemes(themes: EditorTheme[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
  } catch { /* quota exceeded */ }
}

export function getAllThemes(): EditorTheme[] {
  return [...BUILTIN_THEMES, ...loadUserThemes()];
}
