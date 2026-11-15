import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import "../../lib/i18n";
import type { Compilation, CompilationItem } from "../../lib/api";
import { MUSICS } from "../../lib/music/mix";
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
function Harness({ start, onSelect = vi.fn(), playing = null, onEdit }: { start: Compilation; onSelect?: (item: CompilationItem) => void; playing?: string | null; onEdit?: () => void }) {
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
        onEdit={onEdit}
      />
      <output data-testid="order">{compilation.sections.map((s) => s.items.map((i) => i.id).join("")).join("|")}</output>
      <output data-testid="transitions">{JSON.stringify([compilation.transition ?? null, ...compilation.sections.flatMap((s) => s.items.map((i) => i.transition ?? null))])}</output>
    </>
  );
}

// What the panel needs and these tests don't look at
const base = {
  storyboards: {},
  home: "job",
  activeSection: "one",
  selectedItem: null,
  cutting: new Set<string>(),
  templates: [],
  onActivate: vi.fn(),
  onSelect: vi.fn(),
  onExport: vi.fn(),
  exporting: false,
  onDelete: vi.fn(),
  templateName: (key: string) => key,
  looking: false,
  looksNote: "",
  onLooks: vi.fn(),
  onSameLook: vi.fn(),
};

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

    fireEvent.click(screen.getByRole("button", { name: "Transitions : Coupe nette" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Transition entre tous les passages" })).getByRole("button", { name: "Zoom" }));
    expect(transitions()).toEqual(["zoom", null, null, null, null]);
    // Its row says what it is set to
    expect(screen.getByRole("button", { name: "Transitions : Zoom" })).toBeInTheDocument();

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

  it("opens the whole video in the layer editor, and says what the editor does not carry", () => {
    const onEdit = vi.fn();
    const view = render(<Harness start={video()} onEdit={onEdit} />);
    const lost = /L'éditeur ne reprend ni l'intro, ni la musique, ni les transitions/;
    // Plain cuts and one template: nothing to lose, nothing said
    expect(screen.queryByText(lost)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir dans l'éditeur" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Transitions : Coupe nette" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Zoom" }));
    expect(screen.getByText(lost)).toBeInTheDocument();
    view.unmount();

    // No passage: nothing to open
    render(<Harness start={{ ...video(), sections: [{ id: "one", title: "", query: "", items: [] }] }} onEdit={onEdit} />);
    expect(screen.getByRole("button", { name: "Ouvrir dans l'éditeur" })).toBeDisabled();
  });

  it("marks the passage the whole video is on", () => {
    render(<Harness start={video()} playing="b" />);
    expect(row("b")).toHaveAttribute("aria-current", "true");
    expect(row("a")).not.toHaveAttribute("aria-current");
  });

  it("has one button for the AI to choose how the video looks and sounds, and says what it answered", () => {
    const onSound = vi.fn();
    const onLooks = vi.fn();
    const brand = { name: "Falkarst", logo: null, colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" }, font: "Anton" };
    const phonk = MUSICS.filter((track) => track.id === "phonk");
    const { rerender } = render(<CompilationPanel {...base} compilation={video()} onChange={() => {}} brand={brand} musics={phonk} onSound={onSound} onLooks={onLooks} />);
    // No paragraph to read before it is asked: what it does is said on hover
    expect(screen.queryByText(/Elle regarde/)).toBeNull();
    const ask = screen.getByRole("button", { name: /Laisser l'IA choisir/ });
    expect(ask.getAttribute("title")).toMatch(/le modèle de chaque passage, la transition, l'intro et la musique/);
    fireEvent.click(ask);
    // Both at once: the templates of the passages, the music and the intro
    expect([onSound.mock.calls.length, onLooks.mock.calls.length]).toEqual([1, 1]);
    // While it thinks (about either) the button waits
    rerender(<CompilationPanel {...base} compilation={video()} onChange={() => {}} brand={brand} musics={phonk} onSound={onSound} onLooks={onLooks} sounding />);
    expect((screen.getByRole("button", { name: /L'IA choisit/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<CompilationPanel {...base} compilation={video()} onChange={() => {}} brand={brand} musics={phonk} onSound={onSound} onLooks={onLooks} looking />);
    expect((screen.getByRole("button", { name: /L'IA choisit/ }) as HTMLButtonElement).disabled).toBe(true);
    // What it said of its choices, under the list
    rerender(
      <CompilationPanel {...base} compilation={{ ...video(), music: { track: "phonk" } }} onChange={() => {}} brand={brand} musics={phonk} onSound={onSound} onLooks={onLooks} soundNote="Une vidéo de skill : Drift Phonk." looksNote="Empilé partout." />,
    );
    expect(screen.getByText("Une vidéo de skill : Drift Phonk. Empilé partout.")).toBeTruthy();
    // The music it has is named on its row
    expect(screen.getByRole("button", { name: "Musique : Drift Phonk" })).toBeTruthy();
    // Without a music or an intro to choose here (no track on this machine, no channel), it still chooses the templates
    onSound.mockClear();
    onLooks.mockClear();
    rerender(<CompilationPanel {...base} compilation={video()} onChange={() => {}} onSound={onSound} onLooks={onLooks} />);
    fireEvent.click(screen.getByRole("button", { name: /Laisser l'IA choisir/ }));
    expect([onSound.mock.calls.length, onLooks.mock.calls.length]).toEqual([0, 1]);
  });

  it("sets every setting of the video from one list of like rows", () => {
    const onChange = vi.fn();
    const onSameLook = vi.fn();
    const brand = { name: "Falkarst", logo: null, colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" }, font: "Anton" };
    const templates = [
      { key: "mine", name: "Mes fails" },
      { key: "stacked", name: "Empilé" },
    ];
    const start = { ...video(), template: "stacked", intro: { style: "slam" } };
    const { rerender } = render(<CompilationPanel {...base} compilation={start} onChange={onChange} brand={brand} musics={MUSICS.filter((track) => track.id === "phonk")} templates={templates} templateName={(key) => templates.find((tpl) => tpl.key === key)?.name ?? key} onSameLook={onSameLook} />);
    // Each row: what it is and what it is set to (an intro says what it adds to the video)
    for (const name of ["Modèle : Empilé", "Transitions : Coupe nette", "Intro : Impact · +1,6 s", "Musique : Aucune"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Titres des parties" })).toHaveAttribute("aria-checked", "true");

    // The template: a menu of its own, the channel's default first
    fireEvent.click(screen.getByRole("button", { name: "Modèle : Empilé" }));
    const menu = screen.getByRole("dialog", { name: "Modèle" });
    expect(within(menu).getAllByRole("button").map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["Modèle par défaut", "false"],
      ["Mes fails", "false"],
      ["Empilé", "true"],
    ]);
    fireEvent.click(within(menu).getByRole("button", { name: "Mes fails" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...start, template: "mine" });
    expect(screen.queryByRole("dialog", { name: "Modèle" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Modèle : Empilé" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Modèle" })).getByRole("button", { name: "Modèle par défaut" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...start, template: null });

    // Without titles, the line written over the first seconds is asked for, in the list
    fireEvent.click(screen.getByRole("switch", { name: "Titres des parties" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...start, titles: false });
    expect(screen.queryByPlaceholderText("Accroche de la vidéo")).toBeNull();
    const withOwn = { ...start, titles: false, template: null, sections: [{ ...start.sections[0], items: [start.sections[0].items[0], { ...start.sections[0].items[1], template: "mine" }] }] };
    rerender(<CompilationPanel {...base} compilation={withOwn} onChange={onChange} brand={brand} templates={templates} templateName={(key) => templates.find((tpl) => tpl.key === key)?.name ?? key} onSameLook={onSameLook} />);
    expect(screen.getByPlaceholderText("Accroche de la vidéo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modèle : Modèle par défaut" })).toBeInTheDocument();
    // Passages with a template of their own: said under the row, with the way back
    expect(screen.getByText("1 passage a le sien")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Même modèle partout" }));
    expect(onSameLook).toHaveBeenCalledTimes(1);
    // No track on this machine: no music to set
    expect(screen.queryByRole("button", { name: /^Musique/ })).toBeNull();
  });
});
