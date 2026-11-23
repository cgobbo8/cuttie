import { useEffect } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { Download, KeyRound, LogOut, Scissors, SlidersHorizontal, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import CreatorSelector from "./CreatorSelector";
import { useAssistant } from "../lib/AssistantContext";
import { useAuth } from "../lib/AuthContext";
import { useChannel } from "../lib/ChannelContext";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { useSettings } from "../lib/SettingsContext";
import { checkForUpdateSoon, updatePending, useUpdateState } from "../lib/desktop";

/** A live and its steps (choose, edit, export) */
const JOB_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-/;
/** The keys that open the assistant, as this machine writes them */
const ASSISTANT_KEYS = typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘J" : "Ctrl J";

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
  const update = useUpdateState();
  const assistant = useAssistant();

  useEffect(() => checkForUpdateSoon(), []);

  const items = [
    { to: "/", label: t("sidebar.home"), active: pathname === "/" },
    // A live and everything made from it; then every video kept, whatever its live (their exported files are with them)
    { to: "/projects", label: t("sidebar.projects"), active: pathname.startsWith("/projects") || JOB_PATH.test(pathname) },
    { to: "/compilations", label: t("sidebar.compilations"), active: pathname.startsWith("/compilations") || pathname.startsWith("/exports") },
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
    <header
      // (the assistant, open, takes its width off the page: the bar stops where the page does)
      style={{ right: "calc(1.5rem + var(--assistant-w, 0px))" }}
      className="fixed top-4 left-6 z-40 glass-bar rounded-[16px] min-h-14 flex flex-wrap items-center gap-3 pl-3 pr-2 py-1 transition-[right] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
    >
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

      {updatePending(update) && pathname !== "/settings" && (
        <Link to="/settings#app" className="chip h-8 px-3 bg-accent-soft text-accent hover:bg-accent/25 transition-colors">
          <Download className="w-3.5 h-3.5" />
          {update.phase === "ready" ? t("sidebar.updateReady") : t("sidebar.update")}
        </Link>
      )}

      {!isLocalApp && (
        <div className="w-56">
          <CreatorSelector />
        </div>
      )}

      <button
        onClick={assistant.toggle}
        aria-pressed={assistant.open}
        title={`${t("assistant.title")} (${ASSISTANT_KEYS})`}
        className={`flex items-center gap-2 h-9 pl-2.5 pr-2 rounded-[10px] text-[13.5px] font-[600] transition-colors ${assistant.open ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent hover:bg-accent/25"}`}
      >
        <Sparkles className="w-4 h-4" strokeWidth={2.2} />
        {t("assistant.title")}
        <kbd className={assistant.open ? "bg-black/15 border-black/10 text-accent-ink" : "bg-white/[0.08] border-white/10 text-ink-2"}>{ASSISTANT_KEYS}</kbd>
      </button>

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
