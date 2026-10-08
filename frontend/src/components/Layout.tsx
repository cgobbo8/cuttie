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
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {showKeysBanner && (
            <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06]">
              <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm text-amber-200 flex-1">{t("keysBanner.text")}</span>
              <Link
                to="/settings"
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-400 text-black hover:bg-amber-300 transition-colors"
              >
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
