#!/usr/bin/env node
/**
 * Keeps the server renderer (api/remotion) in step with the editor:
 * - clip fonts: the frontend's @fontsource files -> api/public/fonts
 * - widget kit: frontend/src/components/editor/widgets/kit/* -> api/remotion/widgets/kit,
 *   copied as is (only WidgetImg.tsx differs on each side: Remotion's <Img> on the
 *   server makes frames wait for images). The older widgets next to it are
 *   maintained by hand on each side.
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

console.log(`Synced ${CLIP_FONTS.length} fonts and ${widgets} widgets into api/`);
