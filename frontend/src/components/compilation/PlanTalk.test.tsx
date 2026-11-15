import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import "../../lib/i18n";
import PlanTalk, { type TalkTurn } from "./PlanTalk";

beforeEach(() => {
  i18n.changeLanguage("fr");
  // (the thread keeps its newest message in view)
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

const talk = (turns: TalkTurn[]) =>
  render(
    <PlanTalk brief="Une vidéo d'une minute sur les moments calmes." answer="Deux parties." passages={12} turns={turns} pending={null} trail={[]} value="" onValue={() => {}} onSend={() => {}} disabled={false} cost="≈ 0,04 $" onAnother={() => {}} />,
  );

describe("the conversation about a video the AI planned", () => {
  it("writes under the AI's answer what it keeps of the streamer's tastes for their next videos", () => {
    talk([
      { ask: "Raccourcis le passage de 22 secondes. J'aime pas les passages de plus de 10 secondes.", note: "J'ai raccourci cinq passages.", recut: 5, remembered: ["N'aime pas les passages de plus de 10 secondes."] },
      { ask: "Retire le dernier.", note: "Retiré.", removed: 1 },
    ]);
    const thread = screen.getByRole("log");
    expect(within(thread).getByText("Retenu pour tes prochaines vidéos : N'aime pas les passages de plus de 10 secondes.")).toBeTruthy();
    // Only on the turn it was said in
    expect(within(thread).getAllByText(/Retenu pour tes prochaines vidéos/)).toHaveLength(1);
  });
});
