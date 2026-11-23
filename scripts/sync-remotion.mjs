#!/usr/bin/env node
/**
 * Keeps the server renderer (api/remotion) in step with the editor:
 * - clip fonts: the frontend's @fontsource files -> api/public/fonts
 * - widget kit: frontend/src/components/editor/widgets/kit/* -> api/remotion/widgets/kit,
 *   copied as is (only WidgetImg.tsx differs on each side: Remotion's <Img> on the
 *   server makes frames wait for images). The older widgets next to it are
 *   maintained by hand on each side.
 * - transitions between the pieces of a montage: frontend/src/lib/transitions.ts ->
 *   api/remotion/transitions.ts, copied as is.
 * - intros of a compilation: frontend/src/lib/intro/* -> api/remotion/intro, copied as is,
 *   and their sounds frontend/public/sounds/*.mp3 -> api/public/sounds (the export mixes
 *   them in; they are made by scripts/make-intro-sounds.py).
 * - background music: frontend/src/lib/music/curve.ts -> api/remotion/music (the level of the
 *   music over the video) and catalogue.json -> api/public/musics (what the tracks are). The
 *   tracks themselves are put in api/public/musics by scripts/make-musics.py.
 *
 * Run after adding a font or touching a widget: node scripts/sync-remotion.mjs
 * (frontend/src/lib/remotionSync.test.ts fails when they drift apart).
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** [@fontsource package, weight] — mirrors api/remotion/fonts.ts */
export const CLIP_FONTS = [
  ["luckiest-guy", 400],
  ["bangers", 400],
  ["anton", 400],
  ["bebas-neue", 400],
  ["montserrat", 900],
  ["poppins", 800],
  ["permanent-marker", 400],
  ["archivo-black", 400],
  ["rammetto-one", 400],
  ["mr-dafoe", 400],
];

/** The one kit file that differs on each side */
export const WIDGET_SIDE_FILES = new Set(["WidgetImg.tsx"]);

const fontsDir = path.join(root, "api/public/fonts");
mkdirSync(fontsDir, { recursive: true });
for (const [pkg, weight] of CLIP_FONTS) {
  const src = path.join(root, `frontend/node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-normal.woff2`);
  copyFileSync(src, path.join(fontsDir, `${pkg}-${weight}.woff2`));
}

const from = path.join(root, "frontend/src/components/editor/widgets/kit");
const to = path.join(root, "api/remotion/widgets/kit");
mkdirSync(to, { recursive: true });
let widgets = 0;
for (const file of readdirSync(from)) {
  if (!/\.tsx?$/.test(file) || WIDGET_SIDE_FILES.has(file)) continue;
  copyFileSync(path.join(from, file), path.join(to, file));
  widgets++;
}

copyFileSync(path.join(root, "frontend/src/lib/transitions.ts"), path.join(root, "api/remotion/transitions.ts"));
// What moves a piece's picture while it plays (zoom, punch, shake): the same maths in the preview and the export
copyFileSync(path.join(root, "frontend/src/lib/effects.ts"), path.join(root, "api/remotion/effects.ts"));

/** Every file of a folder that matches, copied as is */
function mirror(source, target, keep) {
  mkdirSync(path.join(root, target), { recursive: true });
  const files = readdirSync(path.join(root, source)).filter((file) => keep.test(file));
  for (const file of files) copyFileSync(path.join(root, source, file), path.join(root, target, file));
  return files.length;
}
// The tests of the intros stay with the editor
const intros = mirror("frontend/src/lib/intro", "api/remotion/intro", /^(?!.*\.test\.).*\.tsx?$/);
const sounds = mirror("frontend/public/sounds", "api/public/sounds", /\.mp3$/);
// Background music: the curve the preview plays is the one the export mixes; the catalogue says what the tracks are
mirror("frontend/src/lib/music", "api/remotion/music", /^curve\.ts$/);
mirror("frontend/src/lib/music", "api/public/musics", /^catalogue\.json$/);

console.log(`Synced ${CLIP_FONTS.length} fonts, ${widgets} widgets, the transitions, ${intros} intro files and ${sounds} sounds into api/`);
