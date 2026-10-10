import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("app.css", () => {
  it("writes backdrop-filter alone: with its -webkit- twin, the production minifier keeps only the twin and Chromium shows no blur", () => {
    const css = readFileSync(path.resolve(__dirname, "app.css"), "utf-8");
    expect(css).toMatch(/backdrop-filter:/);
    expect(css).not.toMatch(/-webkit-backdrop-filter/);
  });
});
