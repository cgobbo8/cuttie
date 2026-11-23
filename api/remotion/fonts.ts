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
  { family: "Rammetto One", file: "rammetto-one-400.woff2", weight: "400" },
  { family: "Mr Dafoe", file: "mr-dafoe-400.woff2", weight: "400" },
  { family: "Geist Variable", file: "Geist-Variable.woff2", weight: "100 900" },
];

/** How long one font may take to load before it is tried again, then given up (ms) */
const FONT_WAIT = 20000;

export function loadClipFonts(): void {
  const handle = delayRender("Loading clip fonts");
  // A font that never answers no longer holds the render: seen on a real export of 4 min 30, stopped after
  // ten minutes of waiting for one. Tried twice, then the render goes on without it (its text in a fallback font).
  const load = (family: string, file: string, weight: string) =>
    Promise.race([
      new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { style: "normal", weight }).load(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`${family} did not load in ${FONT_WAIT / 1000} s`)), FONT_WAIT)),
    ]);
  Promise.all(
    CLIP_FONTS.map(async ({ family, file, weight }) => {
      const face = await load(family, file, weight).catch(() => load(family, file, weight));
      document.fonts.add(face);
    }),
  )
    .catch((err) => console.error("Clip fonts failed to load", err))
    .finally(() => continueRender(handle));
}
