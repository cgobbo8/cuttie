import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../../lib/i18n";
import AiCutButton from "./AiCutButton";
import { TooltipProvider } from "../ui/Tooltip";
import type { CutTarget } from "../../lib/cutTarget";

beforeEach(() => {
  i18n.changeLanguage("fr");
});
afterEach(cleanup);

function button(more: Partial<Parameters<typeof AiCutButton>[0]> = {}) {
  const onCut = vi.fn();
  const onTarget = vi.fn<(target: CutTarget) => void>();
  render(
    <TooltipProvider>
      <AiCutButton busy={false} disabled={false} target={null} onTarget={onTarget} onCut={onCut} {...more} />
    </TooltipProvider>,
  );
  return { onCut, onTarget };
}

describe("the one control for what the AI does to a clip's cut", () => {
  it("cuts on its button, and says the length it aims for", () => {
    const { onCut } = button({ target: 60 });
    fireEvent.click(screen.getByRole("button", { name: "Montage IA" }));
    expect(onCut).toHaveBeenCalledTimes(1);
    // What hangs from it says the length, for the eye and for a screen reader
    expect(screen.getByRole("button", { name: "Durée visée : 1 min" }).textContent).toBe("1 min");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the lengths in its menu, free first", () => {
    const { onTarget } = button();
    fireEvent.click(screen.getByRole("button", { name: "Durée visée : Libre" }));
    const choices = screen.getAllByRole("menuitemradio");
    expect(choices.map((c) => c.textContent)).toEqual(["Libre45 s – 1 min 30", "30 s", "45 s", "1 min", "1 min 30"]);
    expect(choices[0].getAttribute("aria-checked")).toBe("true");
    // A choice closes the menu
    fireEvent.click(choices[4]);
    expect(onTarget).toHaveBeenCalledWith(90);
    expect(screen.queryByRole("menu")).toBeNull();
    // Escape and a click elsewhere too
    fireEvent.click(screen.getByRole("button", { name: "Durée visée : Libre" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("takes the advised cut back from the same menu, only when the clip is cut otherwise", () => {
    button();
    fireEvent.click(screen.getByRole("button", { name: "Durée visée : Libre" }));
    expect(screen.queryByRole("menuitem")).toBeNull();
    cleanup();

    const onReset = vi.fn();
    button({ onReset });
    fireEvent.click(screen.getByRole("button", { name: "Durée visée : Libre" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Revenir à la coupe conseillée" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("cannot cut a clip that has no words yet, nor twice at once, but its length can still be chosen", () => {
    const { onCut, onTarget } = button({ disabled: true });
    const cut = screen.getByRole("button", { name: "Montage IA" }) as HTMLButtonElement;
    expect(cut.disabled).toBe(true);
    fireEvent.click(cut);
    expect(onCut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Durée visée : Libre" }));
    fireEvent.click(screen.getAllByRole("menuitemradio")[1]);
    expect(onTarget).toHaveBeenCalledWith(30);
    cleanup();
    button({ busy: true });
    expect((screen.getByRole("button", { name: "Montage IA" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
