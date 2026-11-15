import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../lib/i18n";
import type { AiNote } from "../lib/api";
import AiNotes from "./AiNotes";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("./Toast", () => ({ useToast: () => toast }));

const api = vi.hoisted(() => ({ listNotes: vi.fn(), createNote: vi.fn(), saveNote: vi.fn(), deleteNote: vi.fn(), listJobs: vi.fn() }));
vi.mock("../lib/api", () => api);

const note = (id: string, title: string, games: string[], body: string): AiNote => ({ id, title, games, body, updated_at: "2026-11-15T20:00:00.000Z" });
const GTA = note("gta-v-rp", "GTA V RP sur FlashFA", ["Grand Theft Auto V"], "## Qui est qui\n- Maurice : soignant au SAMC.");
const WHO = note("qui", "Qui est Falkarst", [], "Streamer français.");

/** What the server holds, as the calls change it */
let kept: AiNote[];

beforeEach(() => {
  i18n.changeLanguage("fr");
  kept = [GTA, WHO];
  for (const call of Object.values(api)) call.mockReset();
  for (const call of Object.values(toast)) call.mockReset();
  api.listNotes.mockImplementation(async () => ({ notes: kept, max: 12, max_chars: 4000 }));
  api.listJobs.mockResolvedValue({ data: [{ vod_game: "Grand Theft Auto V" }, { vod_game: "Grand Theft Auto V" }, { vod_game: "Fortnite" }, { vod_game: null }], meta: {} });
  api.createNote.mockImplementation(async (fields) => {
    const made = note(`n${kept.length}`, fields.title, fields.games, fields.body);
    kept = [...kept, made];
    return made;
  });
  api.saveNote.mockImplementation(async (id, fields) => {
    kept = kept.map((n) => (n.id === id ? { ...n, ...fields } : n));
    return kept.find((n) => n.id === id);
  });
  api.deleteNote.mockImplementation(async (id) => {
    kept = kept.filter((n) => n.id !== id);
  });
});
afterEach(cleanup);

describe("the notes the streamer writes for the AI", () => {
  it("lists the notes with the lives each is for, and opens one to change it", async () => {
    render(<AiNotes />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(["GTA V RP sur FlashFAGrand Theft Auto V · 44 caractères", "Qui est FalkarstTous les lives · 18 caractères"]);

    fireEvent.click(within(rows[0]).getByRole("button"));
    const editor = screen.getByRole("dialog", { name: "Modifier la note" });
    expect((within(editor).getByLabelText("Titre") as HTMLInputElement).value).toBe("GTA V RP sur FlashFA");
    const text = within(editor).getByLabelText(/Ce que l'IA doit savoir/) as HTMLTextAreaElement;
    expect(text.value).toBe(GTA.body);
    expect(within(editor).getByText("44 / 4 000")).toBeTruthy();
    // It is for some games: the streamer's own are offered, this note's one is on
    expect(within(editor).getByRole("button", { name: "Certains jeux" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(editor).getByRole("button", { name: "Grand Theft Auto V" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(editor).getByRole("button", { name: "Fortnite" }).getAttribute("aria-pressed")).toBe("false");

    // Changed and saved: the same note, told to the streamer
    fireEvent.change(text, { target: { value: "  Maurice est Master Paramedic.  " } });
    fireEvent.click(within(editor).getByRole("button", { name: "Fortnite" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.saveNote).toHaveBeenCalledWith("gta-v-rp", { title: "GTA V RP sur FlashFA", games: ["Grand Theft Auto V", "Fortnite"], body: "Maurice est Master Paramedic." });
    expect(toast.success).toHaveBeenCalledWith("Note enregistrée : l'IA la lira dès sa prochaine question.");
    expect((await screen.findAllByRole("listitem"))[0].textContent).toContain("Grand Theft Auto V, Fortnite");
  });

  it("writes a new note for every live or for some games, and never saves one that says nothing", async () => {
    render(<AiNotes />);
    await screen.findAllByRole("listitem");
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle note" }));
    const editor = screen.getByRole("dialog", { name: "Nouvelle note" });
    const save = within(editor).getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement;
    // Nothing to delete, nothing to save yet
    expect(within(editor).queryByRole("button", { name: "Supprimer" })).toBeNull();
    expect(save.disabled).toBe(true);
    fireEvent.change(within(editor).getByLabelText("Titre"), { target: { value: " Mes running gags " } });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(editor).getByLabelText(/Ce que l'IA doit savoir/), { target: { value: "- « C'est calme » : ça finit toujours mal." } });
    expect(save.disabled).toBe(false);

    // For some games: one at least must be named; another game than theirs can be typed
    fireEvent.click(within(editor).getByRole("button", { name: "Certains jeux" }));
    expect(save.disabled).toBe(true);
    const other = within(editor).getByLabelText("Autre jeu, comme Twitch l'écrit");
    fireEvent.change(other, { target: { value: " Red Dead, Redemption 2 " } });
    fireEvent.keyDown(other, { key: "Enter" });
    expect(within(editor).getByRole("button", { name: "Red Dead Redemption 2" }).getAttribute("aria-pressed")).toBe("true");
    expect(save.disabled).toBe(false);
    // Back to every live: the games picked are not kept
    fireEvent.click(within(editor).getByRole("button", { name: "Tous les lives" }));
    fireEvent.click(save);
    await waitFor(() => expect(api.createNote).toHaveBeenCalledWith({ title: "Mes running gags", games: [], body: "- « C'est calme » : ça finit toujours mal." }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));

    // The server refuses (a dozen notes at most): said, and the note stays open to be kept elsewhere
    api.createNote.mockRejectedValueOnce(new Error("too many notes"));
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle note" }));
    const again = screen.getByRole("dialog", { name: "Nouvelle note" });
    fireEvent.change(within(again).getByLabelText("Titre"), { target: { value: "Une de trop" } });
    fireEvent.change(within(again).getByLabelText(/Ce que l'IA doit savoir/), { target: { value: "x" } });
    fireEvent.click(within(again).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("12 notes au plus : supprimes-en une pour en ajouter."));
    expect(screen.getByRole("dialog", { name: "Nouvelle note" })).toBeTruthy();
  });

  it("asks before removing a note", async () => {
    render(<AiNotes />);
    fireEvent.click(within((await screen.findAllByRole("listitem"))[1]).getByRole("button"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Modifier la note" })).getByRole("button", { name: "Supprimer" }));
    const sure = screen.getByRole("alertdialog");
    expect(within(sure).getByText("L'IA ne lira plus « Qui est Falkarst », et son texte sera perdu.")).toBeTruthy();
    expect(api.deleteNote).not.toHaveBeenCalled();
    fireEvent.click(within(sure).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(api.deleteNote).toHaveBeenCalledWith("qui");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Note supprimée");
  });

  it("starts from a few headings when nothing is written, and brings in notes written elsewhere", async () => {
    kept = [];
    render(<AiNotes />);
    // Three notes to start from, one about the game most of their lives are on
    expect(await screen.findByText("Rien pour l'instant. Pars d'un de ces modèles, ou écris la tienne.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Grand Theft Auto V : ce qu'il faut savoir" }));
    const editor = screen.getByRole("dialog", { name: "Nouvelle note" });
    expect((within(editor).getByLabelText("Titre") as HTMLInputElement).value).toBe("Grand Theft Auto V : ce qu'il faut savoir");
    expect((within(editor).getByLabelText(/Ce que l'IA doit savoir/) as HTMLTextAreaElement).value).toContain("## Les personnages, et qui les joue");
    expect(within(editor).getByRole("button", { name: "Grand Theft Auto V" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.createNote).not.toHaveBeenCalled();

    // Files: one with its heading, one that is plain text (titled by its name), one that says nothing
    const file = (name: string, text: string) => Object.assign(new File([text], name, { type: "text/markdown" }), { text: async () => text });
    const files = [file("gta-v-rp.md", "---\ntitle: GTA V RP sur FlashFA\ngames: Grand Theft Auto V\n---\n- Maurice : soignant."), file("mes_gags.txt", "- C'est calme."), file("vide.md", "   ")];
    fireEvent.change(screen.getByLabelText("Importer un fichier", { selector: "input" }), { target: { files } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 notes importées"));
    expect(api.createNote.mock.calls.map(([fields]) => fields)).toEqual([
      { title: "GTA V RP sur FlashFA", games: ["Grand Theft Auto V"], body: "- Maurice : soignant." },
      { title: "Mes gags", games: [], body: "- C'est calme." },
    ]);
    expect(toast.error).toHaveBeenCalledWith("1 fichier n'a pas pu être lu.");
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
  });
});
