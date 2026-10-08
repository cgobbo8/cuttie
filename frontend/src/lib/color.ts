/** Color helpers for the brand kit accent (the app's single accent color). */

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** WCAG relative luminance (0 = black, 1 = white) */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const INK_DARK: Rgb = [7, 20, 14];
const INK_LIGHT: Rgb = [255, 255, 255];
const GROUND: Rgb = [11, 11, 12];

/** Text color for labels drawn on a `hex` fill */
export function inkOn(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return rgbToHex(INK_DARK);
  return contrast(rgb, INK_DARK) >= contrast(rgb, INK_LIGHT) ? rgbToHex(INK_DARK) : rgbToHex(INK_LIGHT);
}

/**
 * The brand color as used for UI accents on the dark ground: a too-dark color
 * (a navy logo, say) is lifted toward white until it reads clearly.
 */
export function uiAccent(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#3DBE8B";
  let out: Rgb = rgb;
  for (let t = 0.1; contrast(out, GROUND) < 5 && t <= 0.9; t += 0.1) {
    out = rgb.map((v) => v + (255 - v) * t) as Rgb;
  }
  return rgbToHex(out);
}

/** Paint the app with the streamer's brand color */
export function applyAccent(hex: string): void {
  const accent = uiAccent(hex);
  const root = document.documentElement.style;
  root.setProperty("--color-accent", accent);
  root.setProperty("--color-accent-ink", inkOn(accent));
}
