import { describe, expect, it } from "vitest";
import { chatForClip } from "./templateContext";

describe("clip chat", () => {
  it("keeps what viewers said, without commands, bots or links", () => {
    const shown = chatForClip([
      { author: "Chiione_", text: "MOI !", timestamp: 9.6 },
      { author: "venusiabow", text: "!clip", timestamp: 48.6 },
      { author: "StreamElements", text: "Merci pour le follow", timestamp: 50 },
      { author: "Flaytee_", text: "regarde https://example.com", timestamp: 51 },
      { author: "Ellyia", text: "  Il prévient pas aussi  ", timestamp: 61.6 },
      { author: "Antares_10", text: "x".repeat(140), timestamp: 62 },
    ]);
    expect(shown.map((m) => m.author)).toEqual(["Chiione_", "Ellyia", "Antares_10"]);
    expect(shown[1].text).toBe("Il prévient pas aussi");
    // Long messages are cut
    expect(shown[2].text).toHaveLength(90);
    expect(shown[2].text.endsWith("…")).toBe(true);
  });

  it("drops emote names, and messages that were only emotes", () => {
    const shown = chatForClip([
      { author: "johnnyyt19", text: "<3 <3 PansexualPride PansexualPride", timestamp: 1, emotes: ["<3", "PansexualPride"] },
      { author: "EvaAinsworth", text: "OMG j'adore PogChamp", timestamp: 2, emotes: ["PogChamp"] },
      // A chat saved before emotes were kept: the channel's own still go
      { author: "Falkarst", text: "falkarCry falkarWatch falkarYes", timestamp: 3 },
      { author: "Ellyia", text: "trop chou xotrixPedro", timestamp: 4 },
      { author: "alsdpx", text: "<3 <3", timestamp: 5 },
      { author: "venusiabow", text: "PS5 ou iPhone, top10 easy", timestamp: 6 },
    ]);
    expect(shown.map((m) => [m.author, m.text])).toEqual([
      ["EvaAinsworth", "OMG j'adore"],
      ["Ellyia", "trop chou"],
      ["venusiabow", "PS5 ou iPhone, top10 easy"],
    ]);
    expect(shown[0]).not.toHaveProperty("emotes");
  });
});
