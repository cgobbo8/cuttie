import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { KeyRound, LogOut, Scissors, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import CreatorSelector from "./CreatorSelector";
import { useAuth } from "../lib/AuthContext";
import { useChannel } from "../lib/ChannelContext";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { useSettings } from "../lib/SettingsContext";

const JOB_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-/;

function NavItem({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`h-8 px-3.5 flex items-center rounded-[8px] text-[13.5px] transition-colors duration-200 ${
        active
          ? "bg-white/[0.14] text-white font-[550] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "text-ink-2 hover:text-white hover:bg-white/[0.08]"
      }`}
    >
      {label}
    </Link>
  );
}

export default function TopBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { appInfo, missingKeys } = useSettings();
  const { channel } = useChannel();
  const { isAllMode } = useCreatorWorkspace();
  // Desktop app: single local streamer — no account, workspaces or admin pages
  const isLocalApp = appInfo?.mode === "local" && appInfo.auto_login;

  const items = [
    { to: "/", label: t("sidebar.home"), active: pathname === "/" },
    { to: "/projects", label: t("sidebar.projects"), active: pathname.startsWith("/projects") || JOB_PATH.test(pathname) },
    { to: "/exports", label: t("sidebar.exports"), active: pathname.startsWith("/exports") },
    { to: "/chaine", label: t("sidebar.channel"), active: pathname.startsWith("/chaine") },
    ...(!isLocalApp
      ? [
          { to: "/games", label: t("sidebar.games"), active: pathname.startsWith("/games") },
          ...(isAllMode ? [{ to: "/creators", label: t("sidebar.creators"), active: pathname.startsWith("/creators") }] : []),
          { to: "/workers", label: t("sidebar.workers"), active: pathname.startsWith("/workers") },
        ]
      : []),
  ];

  return (
    <header className="fixed top-4 inset-x-6 z-40 glass-bar rounded-[16px] min-h-14 flex flex-wrap items-center gap-3 pl-3 pr-2 py-1">
      <Link to="/" className="flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-[8px] bg-ink grid place-items-center">
          <Scissors className="w-[15px] h-[15px] text-ground" strokeWidth={2.4} />
        </span>
        <span className="text-[16px] font-[650] tracking-[-0.02em] text-white">Cuttie</span>
      </Link>

      <nav aria-label={t("sidebar.navigation")} className="flex gap-0.5 ml-3 p-[3px] rounded-[11px] bg-white/[0.05]">
        {items.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className="flex-1" />

      {missingKeys.length > 0 && pathname !== "/settings" && (
        <Link to="/settings" className="chip h-8 px-3 bg-amber-300/[0.14] text-amber-200 hover:bg-amber-300/[0.22] transition-colors">
          <KeyRound className="w-3.5 h-3.5" />
          {t("keysBanner.short")}
        </Link>
      )}

      {!isLocalApp && (
        <div className="w-56">
          <CreatorSelector />
        </div>
      )}

      <NavLink
        to="/settings"
        aria-label={t("sidebar.settings")}
        title={t("sidebar.settings")}
        className={({ isActive }) => `btn btn-icon ${isActive ? "bg-white/[0.14] text-white" : "btn-ghost"}`}
      >
        <SlidersHorizontal className="w-[18px] h-[18px]" strokeWidth={1.8} />
      </NavLink>

      {channel && (
        <Link
          to="/chaine"
          className="flex items-center gap-2 h-10 pl-1 pr-3 rounded-[11px] bg-white/[0.06] hover:bg-white/[0.1] transition-colors text-[13.5px] font-[550] text-white"
        >
          {channel.avatar_url ? (
            <img src={channel.avatar_url} alt="" className="w-[30px] h-[30px] rounded-[8px] object-cover bg-white/10" />
          ) : (
            <span className="w-[30px] h-[30px] rounded-[8px] bg-white/10" />
          )}
          {channel.display_name}
        </Link>
      )}

      {user && !isLocalApp && (
        <button
          onClick={async () => {
            await logout();
            navigate("/login", { replace: true });
          }}
          aria-label={t("auth.logout")}
          title={t("auth.logout")}
          className="btn btn-ghost btn-icon text-red-300/80 hover:text-red-200"
        >
          <LogOut className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
      )}
    </header>
  );
}
