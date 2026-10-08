import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The server renderer must draw exactly what the editor shows (scripts/sync-remotion.mjs) */
const root = path.resolve(__dirname, "../../..");
const kit = (side: string) => path.join(root, side === "front" ? "frontend/src/components/editor/widgets/kit" : "api/remotion/widgets/kit");

describe("editor and server renderer stay in sync", () => {
  it("has the same widget kit on both sides", () => {
    const files = readdirSync(kit("front")).filter((f) => f !== "WidgetImg.tsx");
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const server = path.join(kit("api"), file);
      expect(existsSync(server), `${file} missing on the server: run node scripts/sync-remotion.mjs`).toBe(true);
      expect(readFileSync(server, "utf-8"), `${file} differs: run node scripts/sync-remotion.mjs`).toBe(readFileSync(path.join(kit("front"), file), "utf-8"));
    }
  });

  it("ships every clip font to the server", () => {
    const fonts = readFileSync(path.join(root, "api/remotion/fonts.ts"), "utf-8");
    for (const file of fonts.match(/[\w-]+\.woff2/g) ?? []) {
      expect(existsSync(path.join(root, "api/public/fonts", file)), file).toBe(true);
    }
  });
});
