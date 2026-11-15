import { describe, expect, it } from "vitest";
import { changedWords, eventParts, isEmptyMemory, liveDay, memoryLines, readingOutcome } from "./aiMemory";

describe("what the AI remembers, as the window shows it", () => {
  it("shows a section as lines, without the dash that starts each", () => {
    expect(memoryLines("- Cody : collègue de Maurice\n\n•  Blue : une recrue \nUne ligne nue")).toEqual(["Cody : collègue de Maurice", "Blue : une recrue", "Une ligne nue"]);
    expect(memoryLines("  \n")).toEqual([]);
  });

  it("is empty until a section is written or a live is read", () => {
    const sections = { who: "", games: " ", people: "", stories: "", tastes: "" };
    expect(isEmptyMemory({ sections, lives: [] })).toBe(true);
    expect(isEmptyMemory({ sections: { ...sections, tastes: "- Aime les vidéos courtes" }, lives: [] })).toBe(false);
    expect(isEmptyMemory({ sections, lives: [{ job: "a" } as never] })).toBe(false);
  });

  it("tells an event's time from what happened", () => {
    expect(eventParts("[1:12:40] Maurice s'engueule avec Cody")).toEqual({ at: "1:12:40", text: "Maurice s'engueule avec Cody" });
    expect(eventParts(" [12:05] Arrivée de Blue ")).toEqual({ at: "12:05", text: "Arrivée de Blue" });
    // No time, or brackets that are not one: all of it is what happened
    expect(eventParts("Il change de jeu")).toEqual({ at: null, text: "Il change de jeu" });
    expect(eventParts("[SAMC] Garde de nuit")).toEqual({ at: null, text: "[SAMC] Garde de nuit" });
  });

  it("writes the day of a live in the app's language", () => {
    expect(liveDay("2026-11-09", "fr")).toBe("9 nov. 2026");
    expect(liveDay("2026-11-09T20:00:00Z", "en")).toBe("Nov 9, 2026");
    expect(liveDay("", "fr")).toBe("");
    expect(liveDay(null, "fr")).toBe("");
  });

  it("finds what a correction changes in a sentence, between words", () => {
    expect(changedWords("Son jeu préféré est GTA, il y joue tous les soirs.", "Son jeu préféré est Crimson Desert, il y joue tous les soirs.")).toEqual({
      head: "Son jeu préféré est ",
      was: "GTA,",
      now: "Crimson Desert,",
      tail: " il y joue tous les soirs.",
    });
    // Nothing in common: all of it changes
    expect(changedWords("Avant.", "Après, tout autre.")).toEqual({ head: "", was: "Avant.", now: "Après, tout autre.", tail: "" });
    // Words added at the end, or taken out
    expect(changedWords("Il streame le soir", "Il streame le soir et le dimanche")).toEqual({ head: "Il streame le soir", was: "", now: " et le dimanche", tail: "" });
    expect(changedWords("Il joue à GTA tous les soirs", "Il joue à GTA")).toEqual({ head: "Il joue à GTA", was: " tous les soirs", now: "", tail: "" });
  });

  it("says how reading the earlier lives ended", () => {
    const at = "2026-11-15T10:00:00Z";
    expect(readingOutcome({ read: 7, failed: 0, cost: 0.07, at })).toEqual({ key: "done", ok: true });
    expect(readingOutcome({ read: 5, failed: 2, cost: 0.05, at })).toEqual({ key: "partial", ok: true });
    expect(readingOutcome({ read: 0, failed: 3, cost: 0, at })).toEqual({ key: "nothing", ok: false });
    expect(readingOutcome({ read: 2, failed: 0, cost: 0.02, stopped: "asked", at })).toEqual({ key: "stopped", ok: true });
    expect(readingOutcome({ read: 1, failed: 0, cost: 0.01, stopped: "credits", at })).toEqual({ key: "credits", ok: false });
    expect(readingOutcome({ read: 0, failed: 0, cost: 0, stopped: "unreachable", at })).toEqual({ key: "unreachable", ok: false });
  });
});
