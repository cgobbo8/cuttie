import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../../lib/i18n";
import IntroPicker, { introSoundUrl, type HookMenu, type IntroBrand } from "./IntroPicker";

const brand: IntroBrand = { name: "Falkarst", logo: null, colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" }, font: "Anton" };

beforeEach(() => i18n.changeLanguage("fr"));
afterEach(cleanup);

describe("the intro picker", () => {
  const jingles = ["Impact", "Bandes", "Glitch", "Néon", "Vitesse", "Stickers", "Duel", "Arcade", "Flash info", "Éclats", "Décompte", "Mèche"];
  const kinds = () => within(screen.getByRole("group", { name: "Ce qui ouvre la vidéo" }));

  it("chooses first what the video opens with, then its graphics among twelve", () => {
    const onChange = vi.fn();
    const { rerender } = render(<IntroPicker value={null} brand={brand} name="De calme à débordés" onChange={onChange} onClose={() => {}} />);
    // Nothing, or a jingle: no hook where there is no video made of passages to take its moment from (a clip alone)
    expect(kinds().getAllByRole("button").map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["Aucune", "true"],
      ["Intro classique", "false"],
    ]);
    // The twelve jingles, three full rows of four (each one is drawn small with the channel's own name and title: the drawing is not what the button is called)
    for (const name of jingles) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2 + 12);
    // No intro: nothing to name or to hear yet
    expect(screen.queryByPlaceholderText("De calme à débordés")).toBeNull();
    // A click on a jingle chooses it; "Intro classique" alone takes the first one
    fireEvent.click(screen.getByRole("button", { name: "Glitch" }));
    expect(onChange).toHaveBeenLastCalledWith({ style: "glitch" });
    fireEvent.click(kinds().getByRole("button", { name: "Intro classique" }));
    expect(onChange).toHaveBeenLastCalledWith({ style: "slam" });
    rerender(<IntroPicker value={{ style: "glitch" }} brand={brand} name="De calme à débordés" onChange={onChange} onClose={() => {}} />);
    expect(kinds().getByRole("button", { name: "Intro classique" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Glitch" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(kinds().getByRole("button", { name: "Aucune" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("changes the style without losing the title and the sound, names the intro, changes or cuts its sound", () => {
    const onChange = vi.fn();
    render(<IntroPicker value={{ style: "slam", title: "Le calme", sound: "drum" }} brand={brand} name="De calme à débordés" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Néon" }));
    expect(onChange).toHaveBeenLastCalledWith({ style: "neon", title: "Le calme", sound: "drum" });

    // Its own sound is offered first, by name; the one chosen is marked
    expect(screen.getByRole("button", { name: "Impact (celui du style)" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Tambours" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Sans son" }));
    expect(onChange).toHaveBeenLastCalledWith({ style: "slam", title: "Le calme", sound: "none" });
    fireEvent.click(screen.getByRole("button", { name: "Impact (celui du style)" }));
    expect(onChange).toHaveBeenLastCalledWith({ style: "slam", title: "Le calme" });

    // The title: the video's name unless it has its own; emptied, it is the video's again
    const title = screen.getByPlaceholderText("De calme à débordés") as HTMLInputElement;
    expect(title.value).toBe("Le calme");
    fireEvent.change(title, { target: { value: "  Ça dérape  " } });
    fireEvent.blur(title);
    expect(onChange).toHaveBeenLastCalledWith({ style: "slam", sound: "drum", title: "Ça dérape" });
    fireEvent.change(title, { target: { value: "" } });
    fireEvent.blur(title);
    expect(onChange).toHaveBeenLastCalledWith({ style: "slam", sound: "drum" });

    // The channel's follow button: there unless switched off
    const follow = screen.getByRole("switch", { name: "Bouton « Suivre » de la chaîne" });
    expect(follow.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(follow);
    expect(onChange).toHaveBeenLastCalledWith({ style: "slam", title: "Le calme", sound: "drum", follow: false });

    fireEvent.click(kinds().getByRole("button", { name: "Aucune" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(introSoundUrl("boom")).toBe("/sounds/intro-boom.mp3");
  });

  it("offers the hook where the video has passages, with twelve looks of its own, and lets its moment be chosen and trimmed", () => {
    const onChange = vi.fn();
    const onPlay = vi.fn();
    const passages = [
      { id: "b", number: 2, text: "Regarde sous l'escalier", start: 200, end: 204 },
      { id: "c", number: 3, text: "Il est en craquage", start: 300, end: 312 },
    ];
    const menu = (moment: HookMenu["moment"], named = false): HookMenu => ({ passages, moment, named, onPlay });
    const { rerender } = render(<IntroPicker value={{ style: "neon", title: "Le calme", sound: "drum" }} brand={brand} name="La garde de trop" onChange={onChange} onClose={() => {}} hook={menu(null)} />);
    // Three kinds here; from a jingle to the hook, the graphics stay the same: the hook is framed like the jingle it replaces
    expect(kinds().getAllByRole("button").map((button) => button.textContent)).toEqual(["Aucune", "Intro classique", "Hook"]);
    fireEvent.click(kinds().getByRole("button", { name: "Hook" }));
    // (its title stays; a hook plays no sound of its own)
    expect(onChange).toHaveBeenLastCalledWith({ style: "hook", look: "neon", title: "Le calme" });

    // The hook chosen: the same twelve names, now its looks; another one, or back to a jingle with the same graphics
    rerender(<IntroPicker value={{ style: "hook", look: "neon" }} brand={brand} name="La garde de trop" onChange={onChange} onClose={() => {}} hook={menu({ item: "c", start: 307, end: 312, auto: true }, true)} />);
    expect(kinds().getByRole("button", { name: "Hook" }).getAttribute("aria-pressed")).toBe("true");
    for (const name of jingles) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Néon" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Arcade" }));
    expect(onChange).toHaveBeenLastCalledWith({ style: "hook", look: "arcade" });
    fireEvent.click(kinds().getByRole("button", { name: "Intro classique" }));
    expect(onChange).toHaveBeenLastCalledWith({ style: "neon" });

    // Chosen: what it is, the passages it can play (never the first), the one the app took, no sound to set
    expect(screen.getByText(/Le meilleur moment de la vidéo joue d'abord/)).toBeTruthy();
    const rows = screen.getAllByRole("radio");
    expect(rows.map((row) => row.textContent)).toEqual(["Automatique : celui que l'IA a nommé · passage 3", "2Regarde sous l'escalier4 s", "3Il est en craquage12 s"]);
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(screen.queryByText("Son")).toBeNull();
    expect(screen.getByText("5,0 s sur 12,0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voir le hook" }));
    expect(onPlay).toHaveBeenCalledOnce();

    // Another passage: all of a short one
    fireEvent.click(rows[1]);
    expect(onChange).toHaveBeenLastCalledWith({ style: "hook", look: "neon", hook: { item: "b", start: 200, end: 204 } });
    // Trimmed with its handles (here from the keyboard): the streamer's own cut of the passage it plays
    fireEvent.keyDown(screen.getByRole("slider", { name: "Début du hook" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ style: "hook", look: "neon", hook: { item: "c", start: 307.1, end: 312 } });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Fin du hook" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith({ style: "hook", look: "neon", hook: { item: "c", start: 307, end: 311.9 } });
    // Never under a second and a half
    rerender(<IntroPicker value={{ style: "hook", hook: { item: "b", start: 200, end: 201.5 } }} brand={brand} name="La garde de trop" onChange={onChange} onClose={() => {}} hook={menu({ item: "b", start: 200, end: 201.5, auto: false })} />);
    expect(screen.getAllByRole("radio").map((row) => row.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(screen.getAllByRole("radio")[0].textContent).toBe("Automatique : le meilleur passage");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Début du hook" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ style: "hook", hook: { item: "b", start: 200, end: 201.5 } });
    // Back to the app's choice: the streamer's is forgotten
    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(onChange).toHaveBeenLastCalledWith({ style: "hook" });

    // A video of one passage has nothing to open on: said, not hidden
    rerender(<IntroPicker value={{ style: "hook" }} brand={brand} name="La garde de trop" onChange={onChange} onClose={() => {}} hook={{ passages: [], moment: null }} />);
    expect(screen.getByText(/Il faut au moins deux passages/)).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
