import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import "../../lib/i18n";
import type { LiveCompilations, TwitchVod } from "../../lib/api";
import LivePicker from "./LivePicker";

const channel = vi.hoisted(() => ({ vods: [] as unknown[], refresh: vi.fn(async () => {}) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const submitVod = vi.hoisted(() => vi.fn(async (_url: string) => ({ job_id: "new-job" })));

vi.mock("../../lib/ChannelContext", () => ({ useChannel: () => ({ channel: { vods: channel.vods }, refreshChannel: channel.refresh }) }));
vi.mock("../Toast", () => ({ useToast: () => toast }));
vi.mock("../../lib/api", async (original) => ({ ...(await original<typeof import("../../lib/api")>()), submitVod }));

const vod = (id: string, published_at: string, job: Partial<NonNullable<TwitchVod["job"]>> | null = null): TwitchVod => ({
  id, title: `Live ${id}`, duration_seconds: 7200, published_at, view_count: 0, thumbnail_url: null, thumbnail_large_url: null, game: "GTA V", url: `https://twitch.tv/videos/${id}`,
  job: job ? { id: `job-${id}`, status: "DONE", progress: null, clip_count: 0, ...job } : null,
});
const analysed: LiveCompilations = {
  job_id: "job-done", title: "Live done", streamer: null, game: "GTA V", duration: 3600, stream_date: "2026-11-09T20:00:00Z", created_at: null, vod_id: "done", cover_clip: null, clips_freed: false, compilations: [],
};

describe("picking the lives of a compilation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
    vi.clearAllMocks();
    channel.vods = [vod("done", "2026-11-09T20:00:00Z", {}), vod("fresh", "2026-11-12T20:00:00Z"), vod("busy", "2026-11-11T20:00:00Z", { status: "ANALYZING_CLIPS", eta: { start: Date.now() / 1000 - 600, end: Date.now() / 1000 + 600 } })];
  });

  const open = (onAnalysed = vi.fn()) =>
    render(<LivePicker title="De quel live ?" hint="" lives={[analysed]} coverOf={() => null} multiple onPick={vi.fn()} onClose={vi.fn()} onAnalysed={onAnalysed} />);

  it("says what analysing a live costs before launching it, and launches it once confirmed", async () => {
    open();
    // The analysed live can be ticked; the others are listed apart, with the price said twice
    expect(screen.getByRole("checkbox", { name: /Live done/ })).toBeInTheDocument();
    const section = screen.getByRole("heading", { name: "Pas encore analysés" }).closest("section")!;
    expect(section).toHaveTextContent("Ce n'est pas gratuit : ≈ 0,30 $ de crédits OpenRouter par live");
    expect(within(section).queryByText("Live done")).toBeNull();

    // One click only says the price: nothing is launched
    fireEvent.click(within(section).getByRole("button", { name: /Analyser/ }));
    expect(submitVod).not.toHaveBeenCalled();
    expect(section).toHaveTextContent("Analyser ce live prend ≈ 0,30 $ de crédits OpenRouter");
    fireEvent.click(within(section).getByRole("button", { name: "Annuler" }));
    expect(within(section).queryByRole("button", { name: /Lancer l'analyse/ })).toBeNull();

    fireEvent.click(within(section).getByRole("button", { name: /Analyser/ }));
    fireEvent.click(within(section).getByRole("button", { name: "Lancer l'analyse · ≈ 0,30 $" }));
    await waitFor(() => expect(channel.refresh).toHaveBeenCalled());
    expect(submitVod).toHaveBeenCalledTimes(1);
    expect(submitVod).toHaveBeenCalledWith("https://twitch.tv/videos/fresh");
    expect(toast.success).toHaveBeenCalledWith("Analyse lancée (≈ 0,30 $). Le live apparaîtra ici dès qu'elle est finie.");
  });

  it("shows a live being analysed with its progress, and tells when it is ready", () => {
    const onAnalysed = vi.fn();
    const view = open(onAnalysed);
    const row = screen.getByText("Live busy").closest("li")!;
    expect(row).toHaveTextContent(/Analyse en cours · 50 % · reste 10 min/);
    expect(within(row).queryByRole("button")).toBeNull();

    // Its analysis is done: the parent reads its lives again, and the streamer is told
    channel.vods = [vod("done", "2026-11-09T20:00:00Z", {}), vod("fresh", "2026-11-12T20:00:00Z"), vod("busy", "2026-11-11T20:00:00Z", {})];
    view.rerender(<LivePicker title="De quel live ?" hint="" lives={[analysed]} coverOf={() => null} multiple onPick={vi.fn()} onClose={vi.fn()} onAnalysed={onAnalysed} />);
    expect(onAnalysed).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("« Live busy » est analysé : tu peux le choisir.");
    expect(screen.queryByText("Live busy")).toBeNull();
  });
});
