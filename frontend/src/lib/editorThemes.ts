import type { LayerType, LayerTransform, LayerStyle, LayerAnimation, KeyframeSnapshot, SubtitleData, ShapeData, AssetData, ChatData, TextData } from "./editorTypes";
import { DEFAULT_STYLE, DEFAULT_SUBTITLE_CONFIG } from "./editorTypes";
import { listThemes, createTheme, updateTheme, deleteTheme, toggleThemeDefault, type ThemeResponse } from "./api";

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
  keyframes?: KeyframeSnapshot[];
}

export interface EditorTheme {
  id: number | string; // number for DB themes, string for built-in
  name: string;
  layers: ThemeLayerTemplate[];
  builtIn?: boolean;
  isDefault?: boolean;
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
        subtitle: { ...DEFAULT_SUBTITLE_CONFIG },
      },
    ],
  },
];

/* ── API-backed persistence ──────────────────────────────── */

function fromApiTheme(t: ThemeResponse): EditorTheme {
  return {
    id: t.id,
    name: t.name,
    layers: t.layers as ThemeLayerTemplate[],
    builtIn: false,
    isDefault: t.is_default,
  };
}

/** Fetch all themes: built-in + user themes from API */
export async function fetchAllThemes(): Promise<EditorTheme[]> {
  const apiThemes = await listThemes();
  const userThemes = apiThemes.map(fromApiTheme);
  return [...BUILTIN_THEMES, ...userThemes];
}

/** Fetch only user themes from API */
export async function fetchUserThemes(): Promise<EditorTheme[]> {
  const apiThemes = await listThemes();
  return apiThemes.map(fromApiTheme);
}

/** Get the default theme (user-set default, or null) */
export async function fetchDefaultTheme(): Promise<EditorTheme | null> {
  const apiThemes = await listThemes();
  const defaultTheme = apiThemes.find((t) => t.is_default);
  if (defaultTheme) return fromApiTheme(defaultTheme);
  return null;
}

/** Save current layers as a new user theme */
export async function saveTheme(name: string, layers: ThemeLayerTemplate[], isDefault?: boolean): Promise<EditorTheme> {
  const created = await createTheme(name, layers, isDefault);
  return fromApiTheme(created);
}

/** Update an existing user theme */
export async function patchTheme(id: number, data: { name?: string; layers?: ThemeLayerTemplate[]; is_default?: boolean }): Promise<EditorTheme> {
  const updated = await updateTheme(id, data);
  return fromApiTheme(updated);
}

/** Delete a user theme */
export async function removeTheme(id: number): Promise<void> {
  await deleteTheme(id);
}

/** Toggle default status on a user theme */
export async function toggleDefault(id: number): Promise<{ is_default: boolean }> {
  return toggleThemeDefault(id);
}
