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
  it("opens, for each kind of video, the picker a compilation has: the tracks made for it first, each to listen to", () => {
    render(<SoundPrefs kit={{ musics: { chill: "lofi" }, intro: null }} brand={brand} onSave={() => {}} />);
    // What is chosen is said on the field; a kind left to the AI says so
    expect(screen.getByRole("button", { name: "Musique pour : Skill et action" }).textContent).toBe("Au choix de l'IA");
    expect(screen.getByRole("button", { name: "Musique pour : Posé, discussion" }).textContent).toBe("Lofi Upbeat");
    expect(screen.getByRole("button", { name: "Écouter Lofi Upbeat" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Musique pour : Skill et action" }));
    const picker = screen.getByRole("dialog", { name: "Musique pour : Skill et action" });
    // "Up to the AI" in place of "none", then the tracks that suit this kind, then the others under their own kind
    const choices = within(picker).getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed")).map((b) => b.textContent);
    expect(choices[0]).toBe("Au choix de l'IA");
    expect(within(picker).getAllByText(/^(Skill et action|Drôle|Posé, discussion)$/).map((el) => el.textContent)).toEqual(["Skill et action", "Drôle", "Posé, discussion"]);
    expect(within(picker).getByRole("button", { name: "Écouter Drift Phonk" })).toBeTruthy();
    // A favourite has no "presence" of its own: that is a video's setting
    expect(within(picker).queryByRole("group", { name: "Présence sous les passages" })).toBeNull();
  });

  it("saves the whole list of favourites, and the preferred intro", () => {
    const onSave = vi.fn();
    render(<SoundPrefs kit={{ musics: { chill: "lofi", skill: "phonk" }, intro: "rush" }} brand={brand} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Musique pour : Skill et action" }));
    let picker = screen.getByRole("dialog", { name: "Musique pour : Skill et action" });
    fireEvent.click(within(picker).getByText("Drift Phonk II").closest("button")!);
    expect(onSave).toHaveBeenLastCalledWith({ musics: { chill: "lofi", skill: "phonk2" } });
    // Chosen: the picker closes
    expect(screen.queryByRole("dialog")).toBeNull();
    // Back to "up to the AI": the kind has no favourite any more
    fireEvent.click(screen.getByRole("button", { name: "Musique pour : Skill et action" }));
    picker = screen.getByRole("dialog", { name: "Musique pour : Skill et action" });
    fireEvent.click(within(picker).getByRole("button", { name: "Au choix de l'IA" }));
    expect(onSave).toHaveBeenLastCalledWith({ musics: { chill: "lofi" } });

    // The intro: the styles drawn small, as in a compilation, without a title or a sound to set
    expect(screen.getByRole("button", { name: "Intro préférée" }).textContent).toBe("Vitesse");
    fireEvent.click(screen.getByRole("button", { name: "Intro préférée" }));
    let intros = screen.getByRole("dialog", { name: "Intro préférée" });
    expect(within(intros).getAllByRole("button")).toHaveLength(12);
    expect(within(intros).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(intros).getByRole("button", { name: "Stickers" }));
    expect(onSave).toHaveBeenLastCalledWith({ intro: "sticker" });
    fireEvent.click(screen.getByRole("button", { name: "Intro préférée" }));
    intros = screen.getByRole("dialog", { name: "Intro préférée" });
    fireEvent.click(within(intros).getByRole("button", { name: "Aucune" }));
    expect(onSave).toHaveBeenLastCalledWith({ intro: null });
  });

  it("lists the streamer's own musics, lets them correct what each is, remove one, and add another", async () => {
    setMusics([...shipped, mine]);
    api.listMusics.mockResolvedValue([...shipped, mine] as never);
    render(<SoundPrefs kit={{ musics: {}, intro: null }} brand={brand} onSave={() => {}} />);
    // Theirs is offered as a favourite like any other, with the tracks that suit the kind it was given
    fireEvent.click(screen.getByRole("button", { name: "Musique pour : Skill et action" }));
    expect(within(screen.getByRole("dialog")).getByText("Ma boucle")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("Trap nerveuse. Pour les kills.")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

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
