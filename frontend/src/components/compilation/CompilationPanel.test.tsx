import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import "../../lib/i18n";
import type { Compilation, CompilationItem } from "../../lib/api";
import CompilationPanel from "./CompilationPanel";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("../Toast", () => ({ useToast: () => toast }));

const item = (id: string, at: number): CompilationItem => ({ id, start: at, end: at + 4, text: `passage ${id}`, why: "", sources: ["voice"] });
const video = (): Compilation => ({
  id: "comp",
  name: "Ma compilation",
  sections: [
    { id: "one", title: "Calme", query: "", items: [item("a", 10), item("b", 20), item("c", 30)] },
    { id: "two", title: "Débordés", query: "", items: [item("d", 40)] },
  ],
  template: null,
  titles: true,
  hook: "",
  target: null,
  created_at: "",
  updated_at: "",
});

/** The panel over a compilation it can change, as the page holds it */
function Harness({ start, onSelect = vi.fn(), playing = null }: { start: Compilation; onSelect?: (item: CompilationItem) => void; playing?: string | null }) {
  const [compilation, setCompilation] = useState(start);
  return (
    <>
      <CompilationPanel
        compilation={compilation}
        storyboards={{}}
        home="job"
        activeSection="one"
        selectedItem={null}
        cutting={new Set()}
        templates={[]}
        onActivate={vi.fn()}
        onSelect={onSelect}
        onChange={setCompilation}
        onExport={vi.fn()}
        exporting={false}
        onDelete={vi.fn()}
        templateName={(key) => key}
        looking={false}
        looksNote=""
        onLooks={vi.fn()}
        onSameLook={vi.fn()}
        playing={playing}
      />
      <output data-testid="order">{compilation.sections.map((s) => s.items.map((i) => i.id).join("")).join("|")}</output>
      <output data-testid="transitions">{JSON.stringify([compilation.transition ?? null, ...compilation.sections.flatMap((s) => s.items.map((i) => i.transition ?? null))])}</output>
    </>
  );
}

const row = (id: string) => screen.getByText(`passage ${id}`).closest("li")!;
const box = (id: string) => within(row(id)).getByRole("checkbox", { name: "Sélectionner ce passage" });
const order = () => screen.getByTestId("order").textContent;
const transitions = () => JSON.parse(screen.getByTestId("transitions").textContent!);

describe("the passages of a compilation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
    vi.clearAllMocks();
  });

  it("opens a passage on a plain click, and picks it with its box or with Ctrl", () => {
    const onSelect = vi.fn();
    render(<Harness start={video()} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("passage a"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(screen.queryByRole("toolbar")).toBeNull();

    fireEvent.click(box("a"));
    fireEvent.click(screen.getByText("passage c"), { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(box("a")).toHaveAttribute("aria-checked", "true");
    expect(box("c")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("toolbar")).toHaveTextContent("2 sélectionnés");
  });

  it("picks every passage up to the one clicked with Shift, across parts", () => {
    render(<Harness start={video()} />);
    fireEvent.click(box("b"));
    fireEvent.click(box("d"), { shiftKey: true });
    expect(["a", "b", "c", "d"].map((id) => box(id).getAttribute("aria-checked"))).toEqual(["false", "true", "true", "true"]);
    expect(screen.getByRole("toolbar")).toHaveTextContent("3 sélectionnés");
  });

  it("moves the picked passages together, one place at a time", () => {
    render(<Harness start={video()} />);
    fireEvent.click(box("b"));
    fireEvent.click(box("c"));
    const bar = screen.getByRole("toolbar");
    fireEvent.click(within(bar).getByRole("button", { name: "Monter" }));
    expect(order()).toBe("bca|d");
    fireEvent.click(within(bar).getByRole("button", { name: "Descendre" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Descendre" }));
    // Past the end of their part: into the next one, still in their order
    expect(order()).toBe("a|bcd");
  });

  it("puts the picked passages in another part, or in a new one", () => {
    render(<Harness start={video()} />);
    fireEvent.click(box("a"));
    fireEvent.click(box("c"));
    fireEvent.click(screen.getByRole("button", { name: "Déplacer vers" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Débordés/ }));
    expect(order()).toBe("b|dac");
    expect(toast.success).toHaveBeenCalledWith("2 passages déplacés dans « Débordés »");
    // They stay picked: on to a part of their own
    fireEvent.click(screen.getByRole("button", { name: "Déplacer vers" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Nouvelle partie" }));
    expect(order()).toBe("b|d|ac");
    expect(toast.success).toHaveBeenLastCalledWith("2 passages déplacés dans « Partie 3 »");
  });

  it("takes the picked passages out together, and forgets them", () => {
    render(<Harness start={video()} />);
    fireEvent.click(box("a"));
    fireEvent.click(box("d"));
    fireEvent.click(screen.getByRole("button", { name: "Retirer les passages sélectionnés" }));
    expect(order()).toBe("bc|");
    expect(toast.success).toHaveBeenCalledWith("2 passages retirés");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("clears what is picked", () => {
    render(<Harness start={video()} />);
    fireEvent.click(box("a"));
    fireEvent.click(screen.getByRole("button", { name: "Tout désélectionner" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    fireEvent.click(box("b"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("gives the whole video a transition, and lets a passage come in its own way", () => {
    render(<Harness start={video()} />);
    // Nothing comes before the first passage: no transition to choose there
    expect(within(row("a")).queryByRole("button", { name: "Transition avant ce passage" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Coupe nette" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Transition entre tous les passages" })).getByRole("button", { name: "Zoom" }));
    expect(transitions()).toEqual(["zoom", null, null, null, null]);

    fireEvent.click(within(row("c")).getByRole("button", { name: "Transition avant ce passage" }));
    const picker = screen.getByRole("dialog", { name: "Transition avant ce passage" });
    // It follows the video until told otherwise
    expect(within(picker).getByRole("button", { name: "Comme la vidéo" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(picker).getByRole("button", { name: "Flash" }));
    expect(transitions()).toEqual(["zoom", null, null, "flash", null]);
    // Said between the two passages, and counted under the video's transition
    expect(screen.getByRole("button", { name: "Flash" })).toBeInTheDocument();
    expect(screen.getByText("1 passage a la sienne")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "La même partout" }));
    expect(transitions()).toEqual(["zoom", null, null, null, null]);
  });

  it("gives the picked passages one transition", () => {
    render(<Harness start={video()} />);
    fireEvent.click(box("b"));
    fireEvent.click(box("d"));
    fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Transition" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Glissé" }));
    expect(transitions()).toEqual([null, null, "slide", null, "slide"]);
    expect(toast.success).toHaveBeenCalledWith("Glissé : 2 passages");
  });

  it("marks the passage the whole video is on", () => {
    render(<Harness start={video()} playing="b" />);
    expect(row("b")).toHaveAttribute("aria-current", "true");
    expect(row("a")).not.toHaveAttribute("aria-current");
  });
});
