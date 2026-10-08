import { Link, Outlet, useLocation } from "react-router";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import { useSettings } from "../lib/SettingsContext";

export default function Layout() {
  const { t } = useTranslation();
  const { missingKeys } = useSettings();
  const { pathname } = useLocation();
  const showKeysBanner = missingKeys.length > 0 && pathname !== "/settings";

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto px-10 py-10">
          {showKeysBanner && (
            <div className="mb-8 flex items-center gap-3 pl-4 pr-2 py-2 rounded-full border border-amber-400/20 bg-amber-400/[0.07] backdrop-blur-xl animate-rise">
              <KeyRound className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="text-[14px] text-amber-100/90 flex-1">{t("keysBanner.text")}</span>
              <Link to="/settings" className="btn btn-sm bg-amber-300 text-black hover:bg-amber-200">
                {t("keysBanner.action")}
              </Link>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
