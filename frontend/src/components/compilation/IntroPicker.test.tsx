import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../../lib/i18n";
import IntroPicker, { introSoundUrl, type IntroBrand } from "./IntroPicker";

const brand: IntroBrand = { name: "Falkarst", logo: null, colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" }, font: "Anton" };

beforeEach(() => i18n.changeLanguage("fr"));
afterEach(cleanup);

describe("the intro picker", () => {
  it("offers no intro and the five styles, and says which is chosen", () => {
    const onChange = vi.fn();
    render(<IntroPicker value={null} brand={brand} name="De calme à débordés" onChange={onChange} onClose={() => {}} />);
    // (each one is drawn small with the channel's own name and title: the drawing is not what the button is called)
    for (const name of ["Aucune", "Impact", "Bandes", "Glitch", "Néon", "Carton"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Aucune" }).getAttribute("aria-pressed")).toBe("true");
    // No intro: nothing to name or to hear yet
    expect(screen.queryByPlaceholderText("De calme à débordés")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Glitch" }));
    expect(onChange).toHaveBeenCalledWith({ style: "glitch" });
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

    fireEvent.click(screen.getByRole("button", { name: "Aucune" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(introSoundUrl("boom")).toBe("/sounds/intro-boom.mp3");
  });
});
