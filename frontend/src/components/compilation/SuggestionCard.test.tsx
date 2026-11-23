import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "i18next";
import "../../lib/i18n";
import type { CompilationSummary } from "../../lib/api";
import { TooltipProvider } from "../ui/Tooltip";
import DescribeVideo from "./DescribeVideo";
import SuggestionCard from "./SuggestionCard";

const card: CompilationSummary = {
  id: "comp123456", name: "La malédiction du calme", length: 0, passages: 0, parts: 0, described: true, cover: null, cover_job: null, home: "live", lives: ["live"],
  created_at: "2026-11-15T10:00:00.000Z", updated_at: "2026-11-15T10:00:00.000Z", exported_at: null, render_id: null,
  suggestion: { pitch: "« Calme » revient 25 fois avant que l'hôpital soit débordé.", tags: ["running gag", "gta rp"], kind: "funny", score: 84, moments: 12 },
  waiting: true, target: 65,
};

describe("a sequence the AI proposed", () => {
  it("says it is a stretch of the live in a row, how long it runs there and the video made of it", async () => {
    cleanup();
    await i18n.changeLanguage("fr");
    const mission: CompilationSummary = { ...card, id: "seq1234567", name: "Le yacht et les cochons", target: 180, suggestion: { ...card.suggestion!, moments: 8, span: [11792, 14835] } };
    render(
      <TooltipProvider>
        <MemoryRouter>
          <SuggestionCard jobId="live" compilation={mission} fallback={null} onDismiss={() => {}} />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(screen.getByText("Séquence")).toBeTruthy();
    expect(screen.queryByText("Idée de l'IA")).toBeNull();
    expect(screen.getByText("50:43 d'affilée dans le live (à 3:16:32) · vidéo d'environ 3:00")).toBeTruthy();
  });
});

describe("a video the AI proposed", () => {
  beforeEach(async () => {
    cleanup();
    await i18n.changeLanguage("fr");
    // The conversation keeps its last message in view: not something this page of tests can scroll
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  });

  it("is a card of its own: what the AI noticed, its tags, how promising it is, and one way to have it built", () => {
    const onDismiss = vi.fn();
    render(
      <TooltipProvider>
        <MemoryRouter>
          <SuggestionCard jobId="live" compilation={card} fallback={null} onDismiss={onDismiss} />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(screen.getByText("Idée de l'IA")).toBeTruthy();
    expect(screen.queryByText("Séquence")).toBeNull();
    expect(screen.getByRole("heading", { name: "La malédiction du calme" })).toBeTruthy();
    expect(screen.getByText(/revient 25 fois/)).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((tag) => tag.textContent)).toEqual(["running gag", "gta rp"]);
    expect(screen.getByRole("img", { name: "Indice de viralité : 84/100" })).toBeTruthy();
    // How long the video would be and what the AI saw for it
    expect(screen.getByText("Vidéo d'environ 1:05 · 12 moments repérés")).toBeTruthy();
    // Opening it builds it: the button says what that costs, and goes where the building starts
    const build = screen.getByRole("link", { name: /Construire la vidéo.*0,04 \$/ });
    expect(build.getAttribute("href")).toBe("/live/montage?v=comp123456&build=1");
    // Not interested: asked to its page, the link is not followed
    fireEvent.click(screen.getByRole("button", { name: "Écarter cette idée" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("says what the AI noticed and is built from the request it wrote, or from that request rewritten", () => {
    const onBuild = vi.fn();
    const idea = { pitch: "« Calme » revient 25 fois.", tags: ["running gag"], score: 84, brief: "Fais une vidéo sur le calme.", target: 65 };
    const view = render(<DescribeVideo source="compilation" idea={idea} cost="≈ 0,04 $" working={null} unreadable={false} onBuild={onBuild} onSearch={() => {}} />);
    expect(screen.getByText("« Calme » revient 25 fois.")).toBeTruthy();
    expect(screen.getByText("running gag")).toBeTruthy();
    // Nothing to type: the request is the AI's, with the length it proposed
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Construire la vidéo.*0,04 \$/ }));
    expect(onBuild).toHaveBeenCalledWith("Fais une vidéo sur le calme.", 65);
    // Its request can be rewritten first
    fireEvent.click(screen.getByRole("button", { name: "Modifier la demande" }));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("Fais une vidéo sur le calme.");
    fireEvent.change(box, { target: { value: "Seulement les trois meilleurs." } });
    fireEvent.click(screen.getByRole("button", { name: /Construire la vidéo/ }));
    expect(onBuild).toHaveBeenLastCalledWith("Seulement les trois meilleurs.", 65);

    // Being built: what the AI does shows, the offer is gone
    view.rerender(<DescribeVideo source="compilation" idea={idea} cost="≈ 0,04 $" working={["Regarde ce que l'analyse a noté", "Lit ce qui se dit vers 1:16:53"]} unreadable={false} onBuild={onBuild} onSearch={() => {}} />);
    expect(screen.queryByRole("button", { name: /Construire la vidéo/ })).toBeNull();
    expect(screen.getByText("Lit ce qui se dit vers 1:16:53")).toBeTruthy();
  });

  it("a video with nothing in it is described where it will play, or its passages looked for by hand", () => {
    const onBuild = vi.fn();
    const onSearch = vi.fn();
    const view = render(<DescribeVideo source="sequence" cost="≈ 0,04 $" working={null} unreadable={false} onBuild={onBuild} onSearch={onSearch} />);
    const build = screen.getByRole("button", { name: /Construire la vidéo/ }) as HTMLButtonElement;
    // Nothing described: nothing to build
    expect(build.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  La mission du yacht, du départ à la fuite.  " } });
    fireEvent.click(screen.getByRole("button", { name: "1 min 30" }));
    fireEvent.click(build);
    expect(onBuild).toHaveBeenCalledWith("La mission du yacht, du départ à la fuite.", 90);
    fireEvent.click(screen.getByRole("button", { name: "Chercher à la main" }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    // A live that can't be read: said, and nothing is built
    view.rerender(<DescribeVideo source="sequence" cost={null} working={null} unreadable onBuild={onBuild} onSearch={onSearch} />);
    expect((screen.getByRole("button", { name: /Construire la vidéo/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
