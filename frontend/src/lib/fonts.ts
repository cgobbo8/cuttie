/**
 * Fonts offered for subtitles and hook lines. All bundled (no network): the
 * app works offline and exports look exactly like the preview. The server
 * renderer loads the same files (api/remotion/fonts.ts, scripts/sync-remotion.mjs).
 */
export const FONTS = [
  { id: "luckiest", family: "Luckiest Guy", label: "Luckiest Guy" },
  { id: "bangers", family: "Bangers", label: "Bangers" },
  { id: "anton", family: "Anton", label: "Anton" },
  { id: "bebas", family: "Bebas Neue", label: "Bebas Neue" },
  { id: "montserrat", family: "Montserrat", label: "Montserrat" },
  { id: "poppins", family: "Poppins", label: "Poppins" },
  { id: "marker", family: "Permanent Marker", label: "Marker" },
  { id: "archivo", family: "Archivo Black", label: "Archivo" },
  { id: "geist", family: "Geist Variable", label: "Geist" },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export function fontFamily(id: string): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).family;
}
