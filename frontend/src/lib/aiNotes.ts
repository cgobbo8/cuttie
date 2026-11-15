/**
 * The notes the streamer writes for the AI (page « Ma chaîne »): what it should know about them,
 * the people around them and their games. Pure logic of the card: reading a note's file, the
 * notes to start from, what the list says of each. The server keeps them as Markdown files
 * (api/app/services/notes.ts) and the worker gives them to the AI (backend/app/services/notes.py).
 */

import type { TFunction } from "i18next";
import type { AiNote } from "./api";

/** What a note is made of, before it has a file */
export interface NoteDraft {
  /** The note it changes (absent: a new one) */
  id?: string;
  title: string;
  /** The games it is about (as Twitch names them); none: every live */
  games: string[];
  body: string;
}

/**
 * A note's file as a draft: the lines between a first `---` and the next are `key: value`
 * (`title`, `games` separated by commas); a file without them is all text, titled by its name.
 */
export function parseNote(text: string, fallback = ""): NoteDraft {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let title = fallback;
  let games: string[] = [];
  let body = lines.join("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const key = line.slice(0, colon).trim().toLowerCase();
        const value = line
          .slice(colon + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (key === "title" && value) title = value;
        else if (key === "games")
          games = value
            .split(",")
            .map((game) => game.trim())
            .filter(Boolean);
      }
      body = lines.slice(end + 1).join("\n");
    }
  }
  return { title: title.trim(), games, body: body.trim() };
}

/** A title from a file's name: "gta-v-rp.md" -> "Gta v rp" */
export function titleFromFile(name: string): string {
  const words = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * The notes one can start from when there are none: who they are, their main game (`game`: the
 * one most of their lives are on, when known), the names the transcription gets wrong. Each is
 * a title and a few headings to fill in: an empty page says nothing of what helps the AI.
 */
export function starterNotes(t: TFunction, game: string | null): NoteDraft[] {
  return [
    { title: t("notes.starter.who.title"), games: [], body: t("notes.starter.who.body") },
    ...(game ? [{ title: t("notes.starter.game.title", { game }), games: [game], body: t("notes.starter.game.body") }] : []),
    { title: t("notes.starter.names.title"), games: [], body: t("notes.starter.names.body") },
  ];
}

/** The games most of the lives are on, the most played first */
export function mainGames(games: (string | null | undefined)[], most = 6): string[] {
  const count = new Map<string, number>();
  for (const game of games) if (game?.trim()) count.set(game.trim(), (count.get(game.trim()) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, most)
    .map(([game]) => game);
}

/** For which lives a note is given to the AI, in words */
export function whenUsed(note: Pick<AiNote, "games">, t: TFunction): string {
  return note.games.length > 0 ? note.games.join(", ") : t("notes.always");
}
