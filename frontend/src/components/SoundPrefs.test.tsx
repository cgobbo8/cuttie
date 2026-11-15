import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../lib/i18n";
import { setMusics } from "../lib/music/library";
import { MUSICS, type MusicTrack } from "../lib/music/mix";
import SoundPrefs from "./SoundPrefs";

const api = vi.hoisted(() => ({ addMusic: vi.fn(), updateMusic: vi.fn(async () => ({})), deleteMusic: vi.fn(async () => {}), listMusics: vi.fn(async () => []) }));
vi.mock("../lib/api", () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("./Toast", () => ({ useToast: () => toast }));

const shipped = MUSICS.filter((track) => ["phonk", "phonk2", "lofi", "chiptune"].includes(track.id));
const mine: MusicTrack = { id: "u1234abcd", name: "Ma boucle", author: "", genre: "trap", kinds: ["skill"], bpm: 140, seconds: 95, start: 4, lufs: -9, about: "Hard trap.", description: "Trap nerveuse. Pour les kills.", own: true };

const brand = { name: "Falkarst", logo: null, colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" }, font: "Anton" };

beforeEach(async () => {
  await i18n.changeLanguage("fr");
  setMusics(shipped);
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("the sound preferences of the brand kit", () => {
  it("offers, for each kind of video, the tracks that are here: those made for it first", async () => {
    render(<SoundPrefs kit={{ musics: { chill: "lofi" }, intro: null }} brand={brand} onSave={() => {}} />);
    const skill = (await screen.findByLabelText("Musique pour : Skill et action")) as HTMLSelectElement;
    await waitFor(() => expect(skill.options.length).toBeGreaterThan(1));
    expect([...skill.options].map((o) => o.textContent)).toEqual(["Au choix de l'IA", "Drift Phonk", "Drift Phonk II", "──────", "Pixel Chiptune", "Lofi Upbeat"]);
    expect(skill.value).toBe("");
    expect((screen.getByLabelText("Musique pour : Posé, discussion") as HTMLSelectElement).value).toBe("lofi");
    // The one chosen can be listened to; a kind left to the AI has nothing to play
    expect(screen.getByRole("button", { name: "Écouter Lofi Upbeat" })).toBeTruthy();
    expect(screen.getAllByRole("button").filter((b) => (b as HTMLButtonElement).disabled)).toHaveLength(4);
  });

  it("saves the whole list of favourites, and the preferred intro", async () => {
    const onSave = vi.fn();
    render(<SoundPrefs kit={{ musics: { chill: "lofi", skill: "phonk" }, intro: "rush" }} brand={brand} onSave={onSave} />);
    const skill = (await screen.findByLabelText("Musique pour : Skill et action")) as HTMLSelectElement;
    await waitFor(() => expect(skill.value).toBe("phonk"));
    fireEvent.change(skill, { target: { value: "phonk2" } });
    expect(onSave).toHaveBeenLastCalledWith({ musics: { chill: "lofi", skill: "phonk2" } });
    // Back to "up to the AI": the kind has no favourite any more
    fireEvent.change(skill, { target: { value: "" } });
    expect(onSave).toHaveBeenLastCalledWith({ musics: { chill: "lofi" } });

    const intro = screen.getByLabelText("Intro préférée") as HTMLSelectElement;
    expect(intro.value).toBe("rush");
    expect([...intro.options].map((o) => o.textContent)).toEqual(["Aucune", "Impact", "Bandes", "Glitch", "Néon", "Vitesse", "Stickers", "Duel"]);
    fireEvent.change(intro, { target: { value: "sticker" } });
    expect(onSave).toHaveBeenLastCalledWith({ intro: "sticker" });
    fireEvent.change(intro, { target: { value: "" } });
    expect(onSave).toHaveBeenLastCalledWith({ intro: null });
  });

  it("lists the streamer's own musics, lets them correct what each is, remove one, and add another", async () => {
    setMusics([...shipped, mine]);
    api.listMusics.mockResolvedValue([...shipped, mine] as never);
    render(<SoundPrefs kit={{ musics: {}, intro: null }} brand={brand} onSave={() => {}} />);
    // Theirs is offered as a favourite like any other, under the kind it suits
    expect([...(screen.getByLabelText("Musique pour : Skill et action") as HTMLSelectElement).options].map((o) => o.textContent)).toContain("Ma boucle");

    // What it is, in their words: changed when they leave the field
    const description = screen.getByLabelText("Ce qu'est cette musique (l'IA le lit pour choisir)") as HTMLTextAreaElement;
    expect(description.value).toBe("Trap nerveuse. Pour les kills.");
    fireEvent.change(description, { target: { value: "Pour les fails, en fait." } });
    fireEvent.blur(description);
    expect(api.updateMusic).toHaveBeenLastCalledWith("u1234abcd", { description: "Pour les fails, en fait." });
    // The kinds of video it suits: one more, one less
    const kinds = screen.getByRole("group", { name: "Types de vidéo auxquels elle va" });
    expect(within(kinds).getByRole("button", { name: "Skill et action" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(kinds).getByRole("button", { name: "Drôle" }));
    expect(api.updateMusic).toHaveBeenLastCalledWith("u1234abcd", { kinds: ["skill", "funny"] });
    const name = screen.getByLabelText("Nom de la musique") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Ma trap" } });
    fireEvent.blur(name);
    expect(api.updateMusic).toHaveBeenLastCalledWith("u1234abcd", { name: "Ma trap" });
    fireEvent.click(screen.getByRole("button", { name: "Retirer Ma boucle" }));
    await waitFor(() => expect(api.deleteMusic).toHaveBeenCalledWith("u1234abcd"));

    // A file added: the AI listens, and the streamer is told to read what it wrote (or to write it when it could not)
    const file = new File(["sound"], "nouvelle.mp3", { type: "audio/mpeg" });
    api.addMusic.mockResolvedValueOnce({ music: { ...mine, id: "u2", name: "Nouvelle" }, heard: true, why: null });
    fireEvent.change(screen.getByLabelText("Ajouter une musique", { selector: "input" }), { target: { files: [file] } });
    await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith("« Nouvelle » ajoutée. Relis ce que l'IA en dit."));
    expect(api.addMusic).toHaveBeenCalledWith(file, "fr");
    api.addMusic.mockResolvedValueOnce({ music: { ...mine, id: "u3", name: "Sourde" }, heard: false, why: "credits" });
    fireEvent.change(screen.getByLabelText("Ajouter une musique", { selector: "input" }), { target: { files: [file] } });
    await waitFor(() => expect(toast.info).toHaveBeenLastCalledWith("« Sourde » ajoutée. Plus de crédits pour que l'IA l'écoute : écris sa description."));
  });
});
