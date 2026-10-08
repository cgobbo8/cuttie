/**
 * Helpers for the widget kit. This folder is copied as is to
 * api/remotion/widgets/kit by scripts/sync-remotion.mjs: no editor-only imports.
 */
import type { CSSProperties, ReactNode } from "react";
import WidgetImg from "./WidgetImg";

export interface KitWidgetProps {
  props: Record<string, unknown>;
  width: number;
  height: number;
  /** Clip time, seconds */
  currentTime?: number;
}

export const FONT = '"Geist Variable", "Geist", system-ui, sans-serif';

export function text(props: Record<string, unknown>, key: string, fallback = ""): string {
  const value = props[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function num(props: Record<string, unknown>, key: string, fallback = 0): number {
  const value = Number(props[key]);
  return Number.isFinite(value) ? value : fallback;
}

/** Seconds since the widget showed up */
export function since(props: Record<string, unknown>, currentTime = 0): number {
  return currentTime - num(props, "appearAt", 0);
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

/** Brand colors passed by the template (with neutral fallbacks) */
export function brand(props: Record<string, unknown>) {
  return {
    accent: text(props, "accent", "#3DBE8B"),
    highlight: text(props, "highlight", "#FFD21F"),
    dark: text(props, "dark", "#111317"),
    light: text(props, "light", "#F5F5F2"),
  };
}

/** Text color readable on a background color */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0C0C0E" : "#FFFFFF";
}

export const GLASS: CSSProperties = {
  background: "rgba(12, 12, 14, 0.74)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 14px 34px rgba(0,0,0,0.45)",
};

function Svg({ size, children, style }: { size: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flex: "none", ...style }}>
      {children}
    </svg>
  );
}

export function TwitchGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg size={size}>
      <path
        fill={color}
        d="M4.3 2 2.5 6.6v13.2h4.6V22h2.5l2.2-2.2h3.6L20.6 15V2H4.3Zm14.6 12.2-2.9 2.9h-4.5l-2.2 2.2v-2.2H5.3V3.8h13.6v10.4ZM16 7.1h-1.8v5.1H16V7.1Zm-4.7 0H9.5v5.1h1.8V7.1Z"
      />
    </Svg>
  );
}

export function TikTokGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg size={size}>
      <path
        fill={color}
        d="M16.6 5.8a4.3 4.3 0 0 1-1.1-2.8h-3.2v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.6a5.8 5.8 0 0 0-.8-.1 5.9 5.9 0 1 0 5.9 5.9V9.1a7.4 7.4 0 0 0 4.3 1.4V7.3c-1.3 0-2.5-.5-3.3-1.5Z"
      />
    </Svg>
  );
}

export function YouTubeGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg size={size}>
      <path
        fill={color}
        d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z"
      />
    </Svg>
  );
}

export function InstagramGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="18" height="18" rx="5.5" fill="none" stroke={color} strokeWidth="2.2" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke={color} strokeWidth="2.2" />
      <circle cx="17.4" cy="6.6" r="1.3" fill={color} />
    </Svg>
  );
}

export function HeartGlyph({ size, color, filled = true }: { size: number; color: string; filled?: boolean }) {
  return (
    <Svg size={size}>
      <path
        d="M12 20.6s-7.6-4.6-9.4-9.3C1.3 8 3.4 4.6 6.9 4.6c2 0 3.5 1 5.1 3 1.6-2 3.1-3 5.1-3 3.5 0 5.6 3.4 4.3 6.7-1.8 4.7-9.4 9.3-9.4 9.3Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={filled ? 0 : 2.2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CursorGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <path d="M5 2.5 19.5 13l-6.3 1.3-3 5.7L5 2.5Z" fill="#FFFFFF" stroke="#0C0C0E" strokeWidth="1.6" strokeLinejoin="round" />
    </Svg>
  );
}

/** The channel's logo in a rounded square or a circle */
export function Avatar({ src, size, light, round = false, style }: { src: string; size: number; light: string; round?: boolean; style?: CSSProperties }) {
  return (
    <div style={{ width: size, height: size, flex: "none", borderRadius: round ? "50%" : "26%", overflow: "hidden", background: light, ...style }}>
      {src && <WidgetImg src={src} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
    </div>
  );
}
