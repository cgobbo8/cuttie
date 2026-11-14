import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import "../../lib/i18n";
import fr from "../../lib/i18n/fr.json";
import en from "../../lib/i18n/en.json";
import es from "../../lib/i18n/es.json";
import CompilationGuide from "./CompilationGuide";

describe("the Compilation screen's first-visit guide", () => {
  it("walks through its four steps and ends where the screen begins", async () => {
    await i18n.changeLanguage("fr");
    const onClose = vi.fn();
    render(<CompilationGuide open onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Cherche dans tout le live");
    // The real buttons' names are in the text: what it explains is what the screen shows
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining("« Chercher les mots »"));
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining("« Demander à l'IA »"));
    expect(screen.queryByRole("button", { name: "Retour" })).toBeNull();
    // Enter goes on: the main button has the focus
    expect(screen.getByRole("button", { name: "Suivant" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(dialog).toHaveAccessibleName("L'IA cherche comme un monteur");
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining("2 à 3 minutes"));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(dialog).toHaveAccessibleName("Elle te dit ce qu'elle a trouvé");
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining("« ≈ proche »"));
    fireEvent.click(screen.getByRole("button", { name: "Retour" }));
    expect(dialog).toHaveAccessibleName("L'IA cherche comme un monteur");
    // The arrows work too
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(dialog).toHaveAccessibleName("Construis ta vidéo");
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining("« Décrire la vidéo »"));
    // The last step has one way out
    expect(screen.queryByRole("button", { name: "Passer" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "C'est parti" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can be skipped at any time, and shows nothing when closed", async () => {
    await i18n.changeLanguage("fr");
    const onClose = vi.fn();
    const { rerender } = render(<CompilationGuide open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Passer" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<CompilationGuide open={false} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Opened again ("how it works"), it starts over
    rerender(<CompilationGuide open onClose={onClose} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Cherche dans tout le live");
  });

  it("is written in the three languages, with the same pieces", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];
    const french = keys(fr.compilation.guide).sort();
    expect(french.length).toBeGreaterThan(30);
    expect(keys(en.compilation.guide).sort()).toEqual(french);
    expect(keys(es.compilation.guide).sort()).toEqual(french);
    // The steps the AI shows in the second picture have their words in each language
    for (const lang of [fr, en, es]) {
      for (const step of ["best_moments", "search_speech", "chat_peaks", "find_sounds", "listen"]) expect(lang.compilation.step).toHaveProperty(step);
      expect(lang.compilation.sound).toHaveProperty("scream");
    }
  });
});
