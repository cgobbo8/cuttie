import { describe, expect, it } from "vitest";
import { keyLooksRight, parseTwitchLogin } from "./twitch";

describe("parseTwitchLogin", () => {
  it("reads a login however it is typed or pasted", () => {
    for (const input of ["falkarst", " Falkarst ", "@Falkarst", "twitch.tv/falkarst", "https://www.twitch.tv/Falkarst", "https://m.twitch.tv/falkarst/videos?filter=archives"]) {
      expect(parseTwitchLogin(input)).toEqual({ kind: "login", login: "falkarst" });
    }
  });

  it("tells a video link from a channel", () => {
    expect(parseTwitchLogin("https://www.twitch.tv/videos/2894505469")).toEqual({ kind: "vod" });
  });

  it("rejects what can't be a login", () => {
    expect(parseTwitchLogin("")).toEqual({ kind: "empty" });
    expect(parseTwitchLogin("   ")).toEqual({ kind: "empty" });
    expect(parseTwitchLogin("not a login")).toEqual({ kind: "invalid" });
    expect(parseTwitchLogin("a")).toEqual({ kind: "invalid" });
    expect(parseTwitchLogin("x".repeat(26))).toEqual({ kind: "invalid" });
  });
});

describe("keyLooksRight", () => {
  it("checks the provider's prefix", () => {
    expect(keyLooksRight("groq_api_key", "gsk_abc")).toBe(true);
    expect(keyLooksRight("groq_api_key", "sk-or-abc")).toBe(false);
    expect(keyLooksRight("openrouter_api_key", " sk-or-v1-abc")).toBe(true);
  });
});
