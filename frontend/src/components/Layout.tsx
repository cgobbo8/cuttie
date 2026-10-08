import { Outlet, useLocation } from "react-router";
import TopBar from "./TopBar";
import { AppBackdrop } from "../lib/BackdropContext";

/** Pages that lay out their own full-width hero under the floating top bar */
const FULL_BLEED = new Set(["/", "/chaine"]);

export default function Layout() {
  const { pathname } = useLocation();

  return (
    <div className="relative min-h-dvh">
      <AppBackdrop />
      <TopBar />
      <div className="relative z-[1]">
        {FULL_BLEED.has(pathname) ? (
          <Outlet />
        ) : (
          <main className="max-w-[1320px] mx-auto px-8 pt-[112px] pb-16">
            <Outlet />
          </main>
        )}
      </div>
    </div>
  );
}
