import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "i18next";
import "../../lib/i18n";
import type { CompilationSummary } from "../../lib/api";
import ModeSwitch from "../project/ModeSwitch";
import { TooltipProvider } from "../ui/Tooltip";
import PlanTalk, { type Proposal } from "./PlanTalk";
import SuggestionCard from "./SuggestionCard";

const card: CompilationSummary = {
  id: "comp123456", name: "La malédiction du calme", length: 0, passages: 0, parts: 0, described: true, cover: null, cover_job: null, home: "live", lives: ["live"],
  created_at: "2026-11-15T10:00:00.000Z", updated_at: "2026-11-15T10:00:00.000Z", exported_at: null, render_id: null,
  suggestion: { pitch: "« Calme » revient 25 fois avant que l'hôpital soit débordé.", tags: ["running gag", "gta rp"], kind: "funny", score: 84, moments: 12 },
  waiting: true, target: 65,
};

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
    expect(screen.getByRole("heading", { name: "La malédiction du calme" })).toBeTruthy();
    expect(screen.getByText(/revient 25 fois/)).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((tag) => tag.textContent)).toEqual(["running gag", "gta rp"]);
    expect(screen.getByRole("img", { name: "Indice de viralité : 84/100" })).toBeTruthy();
    // How long the video would be and what the AI saw for it
    expect(screen.getByText("Vidéo d'environ 1:05 · 12 moments repérés")).toBeTruthy();
    // Opening it builds it: the button says what that costs, and goes where the building starts
    const build = screen.getByRole("link", { name: /Construire la vidéo.*0,04 \$/ });
    expect(build.getAttribute("href")).toBe("/live/compilation?c=comp123456&build=1");
    // Not interested: asked to its page, the link is not followed
    fireEvent.click(screen.getByRole("button", { name: "Écarter cette idée" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("opens on the request the AI wrote and on what it noticed, and is built when asked", () => {
    const proposal: Proposal = { pitch: "« Calme » revient 25 fois.", tags: ["running gag"], score: 84, cost: "≈ 0,04 $", disabled: false, onBuild: vi.fn(), onEdit: vi.fn() };
    const talk = (more: Partial<Parameters<typeof PlanTalk>[0]> = {}) => (
      <TooltipProvider>
        <PlanTalk brief="Fais une vidéo sur le calme." byAi turns={[]} pending={null} trail={[]} value="" onValue={() => {}} onSend={() => {}} disabled={false} cost="≈ 0,04 $" onAnother={() => {}} {...more} />
      </TooltipProvider>
    );
    const view = render(talk({ proposal }));
    // The first message is the AI's, written in the streamer's place, and says so
    expect(screen.getByText("Demande écrite par l'IA à ta place")).toBeTruthy();
    expect(screen.getByText("Fais une vidéo sur le calme.")).toBeTruthy();
    expect(screen.getByText(/Ce que j'ai remarqué dans ton live/).parentElement!.textContent).toContain("« Calme » revient 25 fois.");
    expect(screen.getByText(/L'IA cherche les passages et monte la vidéo : ≈ 0,04 \$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Construire la vidéo/ }));
    expect(proposal.onBuild).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Modifier la demande d'abord" }));
    expect(proposal.onEdit).toHaveBeenCalledTimes(1);
    // Nothing to change on a video that does not exist yet
    expect(screen.queryByRole("textbox")).toBeNull();

    // Being built: what the AI does shows, the offer is gone
    view.rerender(talk({ planning: true, trail: ["Lit ce qui se dit vers 1:16:53"] }));
    expect(screen.queryByRole("button", { name: /Construire la vidéo/ })).toBeNull();
    expect(screen.getByText("Lit ce qui se dit vers 1:16:53")).toBeTruthy();
    // Built: the conversation goes on like any other, still saying whose idea it was
    view.rerender(talk({ answer: "Deux parties : le calme, puis la tempête.", passages: 12 }));
    expect(screen.getByText("Demande écrite par l'IA à ta place")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
    // A video the streamer described says nothing of the kind
    view.rerender(talk({ byAi: false, answer: "Voilà." }));
    expect(screen.queryByText("Demande écrite par l'IA à ta place")).toBeNull();
  });

  it("is counted next to Compilations in a project", () => {
    const view = render(
      <MemoryRouter>
        <ModeSwitch jobId="live" current="clips" suggested={4} />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Compilations/ });
    expect(link.textContent).toContain("4");
    expect(screen.getByLabelText("4 compilations proposées par l'IA à découvrir")).toBeTruthy();
    // None waiting: no badge
    view.rerender(
      <MemoryRouter>
        <ModeSwitch jobId="live" current="clips" suggested={0} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/proposées par l'IA/)).toBeNull();
  });
});
