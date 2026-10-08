import { continueRender, delayRender, staticFile } from "remotion";

/**
 * Clip fonts for the headless renderer: the same files as the editor
 * (copied by scripts/sync-remotion.mjs). Frames wait until they are loaded.
 */
const CLIP_FONTS: { family: string; file: string; weight: string }[] = [
  { family: "Luckiest Guy", file: "luckiest-guy-400.woff2", weight: "400" },
  { family: "Bangers", file: "bangers-400.woff2", weight: "400" },
  { family: "Anton", file: "anton-400.woff2", weight: "400" },
  { family: "Bebas Neue", file: "bebas-neue-400.woff2", weight: "400" },
  { family: "Montserrat", file: "montserrat-900.woff2", weight: "900" },
  { family: "Poppins", file: "poppins-800.woff2", weight: "800" },
  { family: "Permanent Marker", file: "permanent-marker-400.woff2", weight: "400" },
  { family: "Archivo Black", file: "archivo-black-400.woff2", weight: "400" },
  { family: "Geist Variable", file: "Geist-Variable.woff2", weight: "100 900" },
];

export function loadClipFonts(): void {
  const handle = delayRender("Loading clip fonts");
  Promise.all(
    CLIP_FONTS.map(async ({ family, file, weight }) => {
      const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { style: "normal", weight });
      document.fonts.add(await face.load());
    }),
  )
    .catch((err) => console.error("Clip fonts failed to load", err))
    .finally(() => continueRender(handle));
}
