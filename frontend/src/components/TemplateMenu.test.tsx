import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../lib/i18n";
import TemplateMenu from "./TemplateMenu";

afterEach(cleanup);

const templates = [
  { key: "mine", name: "Mes fails" },
  { key: "empile", name: "Empilé" },
  { key: "signature", name: "Signature" },
];

describe("the menu of templates", () => {
  it("lists the templates by name, marks the chosen one, and tells which is picked", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<TemplateMenu value="empile" templates={templates} label="Modèle par défaut" onPick={onPick} onClose={onClose} />);
    const menu = screen.getByRole("dialog", { name: "Modèle par défaut" });
    expect(menu).toBeTruthy();
    expect(screen.getAllByRole("button").map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["Mes fails", "false"],
      ["Empilé", "true"],
      ["Signature", "false"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Signature" }));
    expect(onPick).toHaveBeenCalledWith("signature");
    // Escape, or a press anywhere else, closes it
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(menu);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("offers a first choice that is no template of its own, where there is one", () => {
    const onPick = vi.fn();
    render(<TemplateMenu value={null} templates={templates} fallback="Modèle par défaut" onPick={onPick} onClose={() => {}} />);
    const first = screen.getAllByRole("button")[0];
    expect([first.textContent, first.getAttribute("aria-pressed")]).toEqual(["Modèle par défaut", "true"]);
    fireEvent.click(first);
    expect(onPick).toHaveBeenCalledWith(null);
  });
});
