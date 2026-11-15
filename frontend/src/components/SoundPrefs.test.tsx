import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../lib/i18n";
import SoundPrefs from "./SoundPrefs";

vi.mock("../lib/api", () => ({ listMusics: vi.fn(async () => ["phonk", "phonk2", "lofi", "chiptune"]) }));

const brand = { name: "Falkarst", logo: null, colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" }, font: "Anton" };

beforeEach(() => i18n.changeLanguage("fr"));
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
});
