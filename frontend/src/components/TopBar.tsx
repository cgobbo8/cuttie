import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ChevronDown, Clapperboard, Download, FolderDown, Gamepad2, House, KeyRound, LogOut, Palette, Radio, Scissors, Server, SlidersHorizontal, UserRound, Users, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import AssistantMark from "./assistant/Mark";
import CreatorSelector from "./CreatorSelector";
import { useAssistant } from "../lib/AssistantContext";
import { useAuth } from "../lib/AuthContext";
import { useChannel } from "../lib/ChannelContext";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { useSettings } from "../lib/SettingsContext";
import { checkForUpdateSoon, updatePending, useUpdateState } from "../lib/desktop";

/**
 * The app's navigation, floating over every page. Three groups, always in the same order:
 * where you are (the logo, then the four places of the app), what needs you (a key missing, an
 * update), and at the far right what is yours (the channel's menu) then the assistant, which
 * opens right under its button. On a phone the four places move to a bar at the bottom, under
 * the thumb, and the top bar keeps the logo, what needs you and the assistant.
 */

/** A live and its steps (choose, edit, export) */
const JOB_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-/;
/** The keys that open the assistant, as this machine writes them */
const ASSISTANT_KEYS = typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘J" : "Ctrl J";

interface Place {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}

/** One of the app's places, in the top bar (a tablet and up) */
function NavItem({ to, label, icon: Icon, active }: Place) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`h-9 px-3 flex items-center gap-2 rounded-[9px] text-[13.5px] transition-colors duration-200 ${
        active ? "bg-white/[0.14] text-white font-[560] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-ink-2 hover:text-white hover:bg-white/[0.08]"
      }`}
    >
      <Icon className={`w-4 h-4 flex-none ${active ? "text-accent" : ""}`} strokeWidth={2} />
      <span className="hidden @[620px]/bar:inline">{label}</span>
    </Link>
  );
}

/** ...and in the bar at the bottom of a phone */
function TabItem({ to, label, icon: Icon, active }: Place) {
  return (
    <Link to={to} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center justify-center gap-[3px] rounded-[12px] text-[10.5px] font-[560] transition-colors ${active ? "text-white" : "text-ink-3 active:text-white"}`}>
      {active && <span aria-hidden className="absolute top-0 h-[3px] w-6 rounded-b-full bg-accent shadow-[0_0_10px_var(--color-accent-glow)]" />}
      <Icon className={`w-[19px] h-[19px] ${active ? "text-accent" : ""}`} strokeWidth={2} />
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

  // The channel's menu: closed by a click elsewhere, Escape, or going to another page
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  const places: Place[] = [
    { to: "/", label: t("sidebar.home"), icon: House, active: pathname === "/" },
    // A live and everything made from it; then every video kept, whatever its live (their exported files are with them)
    { to: "/projects", label: t("sidebar.projects"), icon: Radio, active: pathname.startsWith("/projects") || JOB_PATH.test(pathname) },
    { to: "/compilations", label: t("sidebar.compilations"), icon: Clapperboard, active: pathname.startsWith("/compilations") || pathname.startsWith("/exports") },
    { to: "/chaine", label: t("sidebar.channel"), icon: Palette, active: pathname.startsWith("/chaine") },
  ];
  // What is reached from the channel's menu: the app's settings, the exported files, and what a shared install adds
  const more: Place[] = [
    { to: "/settings", label: t("sidebar.settings"), icon: SlidersHorizontal, active: pathname.startsWith("/settings") },
    { to: "/exports", label: t("videos.files"), icon: FolderDown, active: pathname.startsWith("/exports") },
    ...(!isLocalApp
      ? [
          { to: "/games", label: t("sidebar.games"), icon: Gamepad2, active: pathname.startsWith("/games") },
          ...(isAllMode ? [{ to: "/creators", label: t("sidebar.creators"), icon: Users, active: pathname.startsWith("/creators") }] : []),
          { to: "/workers", label: t("sidebar.workers"), icon: Server, active: pathname.startsWith("/workers") },
        ]
      : []),
  ];
  const needsKeys = missingKeys.length > 0 && pathname !== "/settings";
  const hasUpdate = updatePending(update) && pathname !== "/settings";

  return (
    <>
      <header
        // (the assistant, open beside the page, takes its width off it: the bar stops where the page does, and
        // shows what its own width has room for: names first, then the wordmark, then the hints)
        style={{ right: "calc(var(--bar-inset) + var(--assistant-w, 0px))" }}
        className="@container/bar fixed z-40 top-3 left-3 [--bar-inset:0.75rem] md:top-4 md:left-6 md:[--bar-inset:1.5rem] glass-bar rounded-[16px] h-14 flex items-center gap-2 md:gap-3 pl-2.5 pr-1.5 md:pl-3 transition-[right] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        {/* Where you are */}
        <Link to="/" aria-label="Cuttie" className="flex-none flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[9px] bg-ink grid place-items-center">
            <Scissors className="w-4 h-4 text-ground" strokeWidth={2.4} />
          </span>
          {/* (on a phone the places are at the bottom: there is room for the name; else when the bar is wide) */}
          <span className="md:hidden text-[16px] font-[650] tracking-[-0.02em] text-white">Cuttie</span>
          <span className="hidden @[940px]/bar:inline text-[16px] font-[650] tracking-[-0.02em] text-white">Cuttie</span>
        </Link>

        <nav aria-label={t("sidebar.navigation")} className="hidden md:flex gap-0.5 p-[3px] rounded-[12px] bg-white/[0.05]">
          {places.map((place) => (
            <NavItem key={place.to} {...place} />
          ))}
        </nav>

        <div className="flex-1 min-w-0" />

        {/* What needs you */}
        {needsKeys && (
          <Link to="/settings" title={t("keysBanner.short")} aria-label={t("keysBanner.short")} className="flex-none h-9 px-2.5 flex items-center gap-1.5 rounded-[10px] text-[12.5px] font-[560] bg-amber-300/[0.14] text-amber-200 hover:bg-amber-300/[0.22] transition-colors">
            <KeyRound className="w-4 h-4" />
            <span className="hidden @[1040px]/bar:inline">{t("keysBanner.short")}</span>
          </Link>
        )}
        {hasUpdate && (
          <Link to="/settings#app" title={update.phase === "ready" ? t("sidebar.updateReady") : t("sidebar.update")} aria-label={update.phase === "ready" ? t("sidebar.updateReady") : t("sidebar.update")} className="flex-none h-9 px-2.5 flex items-center gap-1.5 rounded-[10px] text-[12.5px] font-[560] bg-accent-soft text-accent hover:bg-accent/25 transition-colors">
            <Download className="w-4 h-4" />
            <span className="hidden @[1040px]/bar:inline">{update.phase === "ready" ? t("sidebar.updateReady") : t("sidebar.update")}</span>
          </Link>
        )}

        {!isLocalApp && (
          <div className="hidden @[1180px]/bar:block w-52">
            <CreatorSelector />
          </div>
        )}

        {/* What is yours: the channel, and what goes with it */}
        <div ref={menuRef} className="relative flex-none">
          <button
            onClick={() => setMenu((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={channel?.display_name ?? t("sidebar.settings")}
            className={`flex items-center gap-2 h-10 px-1 rounded-[11px] text-[13.5px] font-[550] text-white transition-colors ${menu ? "bg-white/[0.14]" : "bg-white/[0.06] hover:bg-white/[0.1]"}`}
          >
            {channel?.avatar_url ? (
              <img src={channel.avatar_url} alt="" className="w-8 h-8 rounded-[8px] object-cover bg-white/10" />
            ) : (
              <span className="w-8 h-8 rounded-[8px] bg-white/10 grid place-items-center text-ink-2">
                <UserRound className="w-4 h-4" />
              </span>
            )}
            <span className="hidden @[780px]/bar:inline max-w-[130px] truncate">{channel?.display_name ?? t("sidebar.settings")}</span>
            <ChevronDown className={`hidden @[780px]/bar:block w-3.5 h-3.5 mr-1 text-ink-3 transition-transform ${menu ? "rotate-180" : ""}`} />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 top-[calc(100%+8px)] w-[232px] p-1.5 rounded-[14px] bg-[#17171a] border border-white/[0.12] shadow-[0_24px_50px_-18px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.07)] animate-fade-in">
              {channel && (
                <Link to="/chaine" role="menuitem" className="flex items-center gap-2.5 p-2 rounded-[10px] hover:bg-white/[0.07] transition-colors">
                  {channel.avatar_url ? <img src={channel.avatar_url} alt="" className="w-9 h-9 rounded-[9px] object-cover bg-white/10" /> : <span className="w-9 h-9 rounded-[9px] bg-white/10" />}
                  <span className="min-w-0">
                    <b className="block truncate text-[13.5px] font-[600] text-white">{channel.display_name}</b>
                    <span className="block truncate text-[11.5px] text-ink-3">{t("sidebar.channel")}</span>
                  </span>
                </Link>
              )}
              {channel && <div aria-hidden className="my-1 h-px bg-white/[0.08]" />}
              {more.map(({ to, label, icon: Icon, active }) => (
                <Link key={to} to={to} role="menuitem" aria-current={active ? "page" : undefined} className={`flex items-center gap-2.5 h-9 px-2 rounded-[9px] text-[13px] transition-colors ${active ? "bg-white/[0.1] text-white" : "text-ink-2 hover:text-white hover:bg-white/[0.07]"}`}>
                  <Icon className="w-4 h-4 flex-none" strokeWidth={1.9} />
                  <span className="flex-1 truncate">{label}</span>
                  {to === "/settings" && missingKeys.length > 0 && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-300" />}
                </Link>
              ))}
              {!isLocalApp && (
                <div className="@[1180px]/bar:hidden mt-1 pt-1.5 border-t border-white/[0.08]">
                  <CreatorSelector />
                </div>
              )}
              {user && !isLocalApp && (
                <>
                  <div aria-hidden className="my-1 h-px bg-white/[0.08]" />
                  <button
                    role="menuitem"
                    onClick={async () => {
                      await logout();
                      navigate("/login", { replace: true });
                    }}
                    className="w-full flex items-center gap-2.5 h-9 px-2 rounded-[9px] text-[13px] text-red-300/90 hover:text-red-200 hover:bg-red-400/[0.08] transition-colors"
                  >
                    <LogOut className="w-4 h-4" strokeWidth={1.9} /> {t("auth.logout")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* The assistant, last: its panel opens right under it */}
        <span aria-hidden className="hidden md:block flex-none w-px h-6 bg-white/[0.12]" />
        <button
          onClick={assistant.toggle}
          aria-pressed={assistant.open}
          aria-label={t("assistant.title")}
          title={`${t("assistant.title")} (${ASSISTANT_KEYS})`}
          className={`flex-none flex items-center gap-2 h-10 px-2 rounded-[11px] text-[13.5px] font-[600] transition-colors ${assistant.open ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent hover:bg-accent/25"}`}
        >
          <AssistantMark size={24} className={assistant.open ? "is-inverted" : ""} />
          <span className="hidden @[440px]/bar:inline @[440px]/bar:pr-1">{t("assistant.title")}</span>
          {/* (in a wrapper: the stylesheet's own rule for keys would show it at every width) */}
          <span className="hidden @[1040px]/bar:inline-flex">
            <kbd className={assistant.open ? "bg-black/15 border-black/10 text-accent-ink" : "bg-white/[0.08] border-white/10 text-ink-2"}>{ASSISTANT_KEYS}</kbd>
          </span>
        </button>
      </header>

      {/* A phone: the four places at the bottom, under the thumb */}
      <nav aria-label={t("sidebar.navigation")} className="md:hidden fixed z-40 left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] h-[60px] px-1.5 glass-bar rounded-[18px] grid grid-cols-4 gap-1">
        {places.map((place) => (
          <TabItem key={place.to} {...place} />
        ))}
      </nav>
    </>
  );
}
