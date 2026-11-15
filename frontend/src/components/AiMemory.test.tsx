import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../lib/i18n";
import type { AiMemory, MemoryLive } from "../lib/api";
import MemoryButton from "./AiMemory";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("./Toast", () => ({ useToast: () => toast }));

const api = vi.hoisted(() => ({
  MEMORY_SECTIONS: ["who", "games", "people", "stories", "tastes"],
  getMemory: vi.fn(),
  saveMemory: vi.fn(),
  clearMemory: vi.fn(),
  readLivesIntoMemory: vi.fn(),
  stopReadingLives: vi.fn(),
}));
vi.mock("../lib/api", () => api);

const live = (job: string, title: string, date: string, more: Partial<MemoryLive> = {}): MemoryLive => ({
  job,
  title,
  game: "Grand Theft Auto V",
  date,
  duration: 21600,
  summary: `Résumé de « ${title} ».`,
  events: ["[1:12:40] Maurice s'engueule avec Cody", "Première rencontre avec Blue"],
  people: [{ name: "Cody", who: "collègue de Maurice" }],
  said: ["Marre des gardes de nuit"],
  games: ["Grand Theft Auto V"],
  source: "transcript",
  read_at: "2026-11-15T10:00:00Z",
  cost: 0.008,
  ...more,
});
const EMPTY: AiMemory = { sections: { who: "", games: "", people: "", stories: "", tastes: "" }, updated_at: null, paused: false, lives: [], unread: [], cost: 0, reading: null, last: null, proposals: [] };
const FULL: AiMemory = {
  ...EMPTY,
  sections: { who: "- Streamer français, RP posé", games: "- GTA V RP sur FlashFA", people: "- Cody : collègue de Maurice, en froid depuis le 9/11\n- Blue : une recrue", stories: "", tastes: "- N'aime pas les longs passages (15/11/2026)" },
  updated_at: "2026-11-15T10:00:00Z",
  lives: [live("b", "Le lendemain", "2026-11-10", { source: "analysis" }), live("a", "L'examen de Blue", "2026-11-09")],
};

/** What the server holds, as the calls change it */
let kept: AiMemory;

beforeEach(() => {
  i18n.changeLanguage("fr");
  kept = FULL;
  for (const call of [api.getMemory, api.saveMemory, api.clearMemory, api.readLivesIntoMemory, api.stopReadingLives]) call.mockReset();
  for (const call of Object.values(toast)) call.mockReset();
  api.getMemory.mockImplementation(async () => kept);
  api.saveMemory.mockImplementation(async (patch) => {
    kept = { ...kept, sections: { ...kept.sections, ...patch.sections }, paused: patch.paused ?? kept.paused };
    return { sections: kept.sections, updated_at: kept.updated_at, paused: kept.paused };
  });
  api.clearMemory.mockImplementation(async () => {
    kept = { ...EMPTY, unread: [{ id: "a", title: "L'examen de Blue", date: "2026-11-09", game: "Grand Theft Auto V", duration: 21600 }], cost: 0.01 };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = async () => {
  render(<MemoryButton />);
  fireEvent.click(await screen.findByRole("button", { name: /Mémoire/ }));
  return screen.findByRole("dialog", { name: "Mémoire de l'IA" });
};

describe("what the AI remembers of the streamer", () => {
  it("says on its button how many lives the AI read, and shows what it knows in five sections", async () => {
    render(<MemoryButton />);
    // The count comes with the memory
    await waitFor(() => expect(screen.getByRole("button", { name: /Mémoire/ }).textContent).toBe(" Mémoire2"));
    fireEvent.click(screen.getByRole("button", { name: /Mémoire/ }));
    const window = await screen.findByRole("dialog", { name: "Mémoire de l'IA" });
    expect(within(window).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Qui tu es", "Tes jeux", "Les gens autour de toi", "Ce qui se passe d'un live à l'autre", "Tes goûts pour tes vidéos"]);
    // Each line without its dash; a section that holds nothing says so
    expect(within(window).getByText("Cody : collègue de Maurice, en froid depuis le 9/11")).toBeTruthy();
    expect(within(window).getByText("N'aime pas les longs passages (15/11/2026)")).toBeTruthy();
    expect(within(window).getAllByText("Rien pour l'instant")).toHaveLength(1);
    // Nothing waits to be read: no offer to read
    expect(within(window).queryByRole("button", { name: /Les lire|Le lire/ })).toBeNull();
  });

  it("shows what was noted of each live it read, the latest first", async () => {
    const window = await open();
    fireEvent.click(within(window).getByRole("tab", { name: "2 lives lus" }));
    const lives = within(window).getAllByRole("article");
    expect(lives.map((article) => within(article).getByRole("heading").textContent)).toEqual(["Le lendemain", "L'examen de Blue"]);
    // The day and the game; a live read without its transcript says so
    expect(lives[0].textContent).toContain("10 nov. 2026 · Grand Theft Auto V · lu sans son transcript");
    expect(lives[1].textContent).toContain("9 nov. 2026 · Grand Theft Auto V");
    expect(lives[1].textContent).not.toContain("sans son transcript");
    // What happened, with its time when it has one; who was there (who they are on hover); what the streamer said
    expect(within(lives[1]).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1:12:40Maurice s'engueule avec Cody", "·Première rencontre avec Blue"]);
    expect(within(lives[1]).getByText("Cody").getAttribute("title")).toBe("collègue de Maurice");
    expect(lives[1].textContent).toContain("Tu as dit : Marre des gardes de nuit");
  });

  it("lets the streamer correct a section", async () => {
    const window = await open();
    fireEvent.click(within(window).getByRole("button", { name: "Corriger « Les gens autour de toi »" }));
    const text = within(window).getByRole("textbox", { name: "Les gens autour de toi" }) as HTMLTextAreaElement;
    expect(text.value).toBe(FULL.sections.people);
    fireEvent.change(text, { target: { value: "- Cody : son meilleur ami" } });
    fireEvent.click(within(window).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(window).queryByRole("textbox")).toBeNull());
    expect(api.saveMemory).toHaveBeenCalledWith({ sections: { people: "- Cody : son meilleur ami" } });
    expect(toast.success).toHaveBeenCalledWith("Mémoire corrigée");
    expect(within(window).getByText("Cody : son meilleur ami")).toBeTruthy();
    // Given up: nothing is saved
    fireEvent.click(within(window).getByRole("button", { name: "Corriger « Tes jeux »" }));
    fireEvent.click(within(window).getByRole("button", { name: "Annuler" }));
    expect(api.saveMemory).toHaveBeenCalledTimes(1);
  });

  it("has the AI read the lives analysed before only when asked, the price on the button, and follows it", async () => {
    kept = { ...EMPTY, unread: [1, 2, 3].map((n) => ({ id: `j${n}`, title: `Live ${n}`, date: "2026-11-09", game: "GTA", duration: 21600 })), cost: 0.03 };
    const window = await open();
    expect(within(window).getByText("3 lives analysés qu'elle n'a pas encore lus")).toBeTruthy();
    expect(within(window).getByText("L'IA n'a encore rien retenu : fais-lui lire tes lives déjà analysés.")).toBeTruthy();
    // Nothing was read, nothing is spent, until the button is pressed
    expect(api.readLivesIntoMemory).not.toHaveBeenCalled();
    const reading = { total: 3, done: 0, title: "Live 1", cost: 0, failed: 0, stopping: false };
    api.readLivesIntoMemory.mockImplementation(async () => {
      kept = { ...kept, reading };
      return reading;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(window).getByRole("button", { name: "Les lire · ≈ 0,03 $" }));
    const status = await within(window).findByRole("status");
    expect(status.textContent).toContain("Lecture de « Live 1 »");
    expect(status.textContent).toContain("1 / 3");

    // It asks where the reading is; asked to stop, it says it stops after this live
    kept = { ...kept, reading: { ...reading, done: 1, title: "Live 2" } };
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(within(window).getByRole("status").textContent).toContain("Lecture de « Live 2 »2 / 3");
    api.stopReadingLives.mockResolvedValue(undefined);
    fireEvent.click(within(window).getByRole("button", { name: "Arrêter" }));
    await waitFor(() => expect(within(window).getByRole("status").textContent).toContain("Arrêt après ce live…"));

    // Done: the memory is there, and how it went is said once
    kept = { ...FULL, last: { read: 2, failed: 0, cost: 0.018, stopped: "asked", at: "2026-11-15T10:05:00Z" } };
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await waitFor(() => expect(within(window).queryByRole("status")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Lecture arrêtée après 2 lives");
    expect(within(window).getByText("Qui tu es")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("says why the reading stopped when the credits ran out", async () => {
    kept = { ...FULL, unread: [{ id: "j1", title: "Live 1", date: null, game: null, duration: 3600 }], cost: 0.01 };
    const window = await open();
    const reading = { total: 1, done: 0, title: "Live 1", cost: 0, failed: 0, stopping: false };
    api.readLivesIntoMemory.mockImplementation(async () => {
      kept = { ...kept, reading };
      return reading;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(window).getByRole("button", { name: "Le lire · ≈ 0,01 $" }));
    await within(window).findByRole("status");
    kept = { ...kept, reading: null, last: { read: 0, failed: 0, cost: 0, stopped: "credits", at: "2026-11-15T10:05:00Z" } };
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Plus de crédits OpenRouter : la lecture s'est arrêtée"));
  });

  it("stops the AI from reading each new live, and wipes the memory after asking", async () => {
    const window = await open();
    const auto = within(window).getByRole("switch", { name: "Lire chaque live une fois analysé" });
    expect(auto.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(auto);
    await waitFor(() => expect(auto.getAttribute("aria-checked")).toBe("false"));
    expect(api.saveMemory).toHaveBeenCalledWith({ paused: true });
    expect(toast.success).toHaveBeenCalledWith("L'IA ne lira plus tes lives toute seule");

    fireEvent.click(within(window).getByRole("button", { name: "Effacer la mémoire" }));
    const confirm = screen.getByRole("alertdialog", { name: "Effacer la mémoire de l'IA ?" });
    expect(api.clearMemory).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Effacer la mémoire" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mémoire effacée"));
    // Nothing left; the lives can be read again
    expect(within(window).getByText("1 live analysé qu'elle n'a pas encore lu")).toBeTruthy();
    expect((within(window).getByRole("button", { name: "Effacer la mémoire" }) as HTMLButtonElement).disabled).toBe(true);
    // Closed with its cross
    fireEvent.click(within(window).getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
