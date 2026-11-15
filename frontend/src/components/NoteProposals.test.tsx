import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../lib/i18n";
import type { NoteProposal } from "../lib/api";
import { NOTE_CHANGED } from "../lib/aiMemory";
import NoteProposals from "./NoteProposals";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("./Toast", () => ({ useToast: () => toast }));

const api = vi.hoisted(() => ({ listNoteProposals: vi.fn(), applyNoteProposal: vi.fn(), ignoreNoteProposal: vi.fn() }));
vi.mock("../lib/api", () => api);

const GAME: NoteProposal = {
  id: "aaaaaaaaaaaa",
  note: "qui",
  note_title: "Qui est Falkarst",
  before: "Son jeu préféré est GTA, il y joue tous les soirs.",
  after: "Son jeu préféré est Crimson Desert, il y joue tous les soirs.",
  why: "Tes cinq derniers lives sont sur Crimson Desert.",
  job: "job-1",
  at: "2026-11-15T10:00:00Z",
};
const DAYS: NoteProposal = { ...GAME, id: "bbbbbbbbbbbb", before: "Il streame du mardi au samedi.", after: "Il streame du lundi au vendredi.", why: "Vu sur trois lives." };

let waiting: NoteProposal[];

beforeEach(() => {
  i18n.changeLanguage("fr");
  waiting = [GAME, DAYS];
  for (const call of Object.values(api)) call.mockReset();
  for (const call of Object.values(toast)) call.mockReset();
  api.listNoteProposals.mockImplementation(async () => waiting);
  api.applyNoteProposal.mockResolvedValue({});
  api.ignoreNoteProposal.mockResolvedValue(undefined);
});
afterEach(cleanup);

const show = () =>
  render(
    <MemoryRouter>
      <NoteProposals />
    </MemoryRouter>,
  );

describe("a note of the streamer's that their lives contradict", () => {
  it("shows nothing when the AI has nothing to ask", async () => {
    waiting = [];
    show();
    await waitFor(() => expect(api.listNoteProposals).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before changing anything: what the AI saw, the sentence as it is, what it would write", async () => {
    show();
    const ask = await screen.findByRole("dialog", { name: "Ta note « Qui est Falkarst » est-elle encore vraie ?" });
    expect(within(ask).getByText("Tes cinq derniers lives sont sur Crimson Desert.")).toBeTruthy();
    expect(ask.textContent).toContain("1 autre ensuite");
    // Only what changes is marked: taken out of the note, put in what it would write
    expect(ask.querySelector("del")?.textContent).toBe("GTA,");
    expect(ask.querySelector("ins")?.textContent).toBe("Crimson Desert,");
    expect(ask.textContent).toContain("Dans ta noteSon jeu préféré est GTA, il y joue tous les soirs.");
    expect(ask.textContent).toContain("Ce qu'elle écriraitSon jeu préféré est Crimson Desert, il y joue tous les soirs.");

    // Accepted: the note is changed, the notes card is told, the next one is asked
    const changed = vi.fn();
    window.addEventListener(NOTE_CHANGED, changed);
    fireEvent.click(within(ask).getByRole("button", { name: "Mettre à jour la note" }));
    await screen.findByText("Vu sur trois lives.");
    window.removeEventListener(NOTE_CHANGED, changed);
    expect(api.applyNoteProposal).toHaveBeenCalledWith("aaaaaaaaaaaa");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Note « Qui est Falkarst » mise à jour");

    // Refused: said to the server, so that the same sentence is not brought up again
    fireEvent.click(screen.getByRole("button", { name: "Laisser comme ça" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.ignoreNoteProposal).toHaveBeenCalledWith("bbbbbbbbbbbb");
    expect(toast.success).toHaveBeenCalledWith("Compris, la note reste comme elle est");
  });

  it("can be put off: closed, it waits for the next time the app is opened", async () => {
    waiting = [GAME];
    show();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Plus tard" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.applyNoteProposal).not.toHaveBeenCalled();
    expect(api.ignoreNoteProposal).not.toHaveBeenCalled();
    // Looked for again (the window comes back to the front): still put off
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(api.listNoteProposals).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so when the note changed in the meantime", async () => {
    waiting = [GAME];
    api.applyNoteProposal.mockRejectedValue(new Error("note_changed"));
    show();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Mettre à jour la note" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ta note a changé entre-temps : rien n'a été modifié"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
