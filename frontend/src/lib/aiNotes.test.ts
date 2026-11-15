import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { mainGames, parseNote, starterNotes, titleFromFile, whenUsed } from "./aiNotes";

const t = ((key: string, values?: Record<string, unknown>) => (values?.game ? `${key}:${values.game}` : key)) as unknown as TFunction;

describe("the notes the streamer writes for the AI", () => {
  it("reads a note's file: a heading of title and games, then the note", () => {
    const read = parseNote('---\r\ntitle: "GTA V RP sur FlashFA"\r\ngames: Grand Theft Auto V, GTA ,\r\ncolour: red\r\n---\r\n\r\n## Qui est qui\r\n- Maurice\r\n', "gta");
    expect(read).toEqual({ title: "GTA V RP sur FlashFA", games: ["Grand Theft Auto V", "GTA"], body: "## Qui est qui\n- Maurice" });
    // No heading: all of it is the note, titled by what the caller knows (its file's name)
    expect(parseNote("Juste du texte.\n", "Mes notes")).toEqual({ title: "Mes notes", games: [], body: "Juste du texte." });
    // A heading that never closes is part of the note; one without a title keeps the caller's
    expect(parseNote("---\ntitle: X\nle reste", "nom")).toEqual({ title: "nom", games: [], body: "---\ntitle: X\nle reste" });
    expect(parseNote("---\ngames: Fortnite\n---\ncorps", "nom")).toEqual({ title: "nom", games: ["Fortnite"], body: "corps" });
    expect(parseNote("", "")).toEqual({ title: "", games: [], body: "" });
  });

  it("titles an imported file by its name", () => {
    expect(titleFromFile("gta-v-rp.md")).toBe("Gta v rp");
    expect(titleFromFile("Qui_est_Falkarst.markdown")).toBe("Qui est Falkarst");
    expect(titleFromFile(".md")).toBe("");
  });

  it("offers notes to start from, one about the game most lives are on", () => {
    const games = mainGames(["Grand Theft Auto V", null, "Fortnite", " Grand Theft Auto V ", "", undefined, "Grand Theft Auto V", "Fortnite", "Chess"]);
    // The most played first
    expect(games).toEqual(["Grand Theft Auto V", "Fortnite", "Chess"]);
    expect(mainGames(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    const starters = starterNotes(t, games[0]);
    expect(starters.map((note) => [note.title, note.games])).toEqual([
      ["notes.starter.who.title", []],
      ["notes.starter.game.title:Grand Theft Auto V", ["Grand Theft Auto V"]],
      ["notes.starter.names.title", []],
    ]);
    // No live analysed yet: no game to write about
    expect(starterNotes(t, null).map((note) => note.title)).toEqual(["notes.starter.who.title", "notes.starter.names.title"]);
  });

  it("says for which lives a note is used", () => {
    expect(whenUsed({ games: [] }, t)).toBe("notes.always");
    expect(whenUsed({ games: ["Grand Theft Auto V", "Fortnite"] }, t)).toBe("Grand Theft Auto V, Fortnite");
  });
});
