import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import AssistantPanel from "./AssistantPanel";
import NoteProposals from "./NoteProposals";
import TopBar from "./TopBar";
import { ASSISTANT_WIDTH, AssistantProvider, useAssistant } from "../lib/AssistantContext";
import { AppBackdrop } from "../lib/BackdropContext";

/** Pages that lay out their own full-width hero under the floating top bar */
const FULL_BLEED = new Set(["/", "/chaine"]);

export default function Layout() {
  return (
    <AssistantProvider>
      <Shell />
    </AssistantProvider>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const { pushes } = useAssistant();

  // A new page starts at the top (the router keeps the previous page's scroll)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="relative min-h-dvh">
      <AppBackdrop />
      <TopBar />
      {/* The assistant, open, takes its width off the page: the two are side by side (on a narrow window it covers the page instead) */}
      <div className="relative z-[1] transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ paddingRight: pushes ? ASSISTANT_WIDTH : 0 }}>
        {FULL_BLEED.has(pathname) ? (
          <Outlet />
        ) : (
          <main className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-[88px] md:pt-[112px] pb-28 md:pb-16">
            <Outlet />
          </main>
        )}
      </div>
      <AssistantPanel />
      {/* A note of the streamer's that their lives contradict: the AI asks before anything changes */}
      <NoteProposals />
    </div>
  );
}
